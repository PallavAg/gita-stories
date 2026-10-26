import "server-only";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { groupLines } from "@/lib/transcript";
import type { ClassInfo, ClassRecord, Story, Word } from "@/lib/types";
import { FFMPEG, LLM_MODEL, STT_MODEL, STT_USD_PER_HOUR } from "./config";
import { audioFile } from "./library";
import { newStory, readJson, transcriptPath, updateRecord, writeJson } from "./store";
import { chatJson, speechToText, withRetry } from "./xai";

export type Transcript = {
  model: string;
  createdAt: string;
  language: string;
  duration: number;
  gaps: { found: number; filledWords: number };
  words: Word[];
};

type Progress = (detail: string, fraction?: number) => void;

/** gaps in the transcript at least this long get re-transcribed on their own */
const GAP_SECONDS = 4;
const GAP_CONCURRENCY = 6;

export const readTranscript = (classId: string) => readJson<Transcript>(transcriptPath(classId));

function clip(file: string, start: number, end: number, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      FFMPEG,
      ["-v", "error", "-ss", start.toFixed(2), "-t", (end - start).toFixed(2), "-i", file, "-c", "copy", "-f", "mp3", "-"],
      { encoding: "buffer", maxBuffer: 64 * 1024 * 1024, signal },
      (err, stdout, stderr) => (err ? reject(new Error(`ffmpeg couldn't cut the audio: ${stderr.toString() || err.message}`)) : resolve(stdout)),
    );
  });
}

/**
 * Speech-to-text for a whole class. xAI's transcription of long files silently skips stretches of speech
 * (up to ~13% in testing), so every gap of GAP_SECONDS+ is cut out and transcribed again on its own.
 * Clip speaker numbers don't match the full file's, so recovered words get speaker null.
 */
export async function transcribe(info: ClassInfo, signal: AbortSignal, progress: Progress, onRetry: (m: string) => void) {
  const file = audioFile(info.collection, info.rel);
  const audio = await readFile(file).catch(() => {
    throw new Error(`Audio file not found: ${path.basename(file)}`);
  });
  progress("Uploading and transcribing the whole class");
  const full = await withRetry(() => speechToText(audio, path.basename(file), signal), signal, onRetry);

  let words: Word[] = full.words.map((w) => [w.start, w.end, w.text, w.speaker ?? null]);
  const gaps: [number, number][] = [];
  for (let i = 1; i < words.length; i++) if (words[i][0] - words[i - 1][1] >= GAP_SECONDS) gaps.push([words[i - 1][1], words[i][0]]);

  let done = 0;
  const filled: Word[] = [];
  progress(`Re-transcribing ${gaps.length} skipped stretches`, 0);
  for (let i = 0; i < gaps.length; i += GAP_CONCURRENCY) {
    await Promise.all(
      gaps.slice(i, i + GAP_CONCURRENCY).map(async ([g0, g1]) => {
        const start = Math.max(g0 - 0.5, 0);
        const res = await withRetry(async () => speechToText(await clip(file, start, g1 + 0.5, signal), "gap.mp3", signal), signal, onRetry);
        for (const w of res.words) {
          const s = w.start + start, e = w.end + start;
          if (s >= g0 && e <= g1 + 0.2) filled.push([s, e, w.text, null]);
        }
        done++;
        progress(`Re-transcribing skipped stretches (${done} of ${gaps.length})`, done / gaps.length);
      }),
    );
  }
  words = [...words, ...filled].sort((a, b) => a[0] - b[0]);

  const transcript: Transcript = {
    model: STT_MODEL,
    createdAt: new Date().toISOString(),
    language: full.language,
    duration: full.duration,
    gaps: { found: gaps.length, filledWords: filled.length },
    words,
  };
  await writeJson(transcriptPath(info.id), transcript, false);
  const sttCost = ((full.duration + gaps.reduce((t, [a, b]) => t + (b - a) + 1, 0)) / 3600) * STT_USD_PER_HOUR;
  return { transcript, cost: sttCost };
}

// ---------- story finding ----------

export const PROMPT_VERSION = 3;

export const PROMPT = `You are given a timestamped transcript of a Bhagavad Gita class (Hindi/English, with Sanskrit chanting). \
Speaker labels (S0, S1, ...) come from automatic diarization and may be imperfect; \
S? marks speech recovered separately whose speaker is unknown (infer it from the surrounding lines). \
The main teacher is a man named Rohit; work out which speaker label(s) are him from the content \
(he leads the explanation, uses masculine Hindi verb forms, others ask questions or read).

Find every STORY Rohit tells: a narrative with specific characters and a sequence of events that happened \
(or happen in the tale), such as a tale from the Puranas, Ramayana or Mahabharata, a saint's life incident, \
a personal or historical anecdote, or a parable. Examples: a retired captain drops his eggs when someone shouts \
"attention"; Buddha walks on unmoved while villagers abuse him.

These are NOT stories, so leave them out:
- examples and analogies that illustrate a point with a general or hypothetical case, even if vivid \
(e.g. "a football player doesn't notice his injury until the match ends", "a river goes around mountains \
until it reaches the sea", "when you cut jackfruit your hands get sticky");
- general explanation, definitions, or brief one-line references to a story;
- stories told by anyone other than Rohit.
If you are unsure whether something is a story or an example, leave it out.

For each story give:
- start / end: the line timestamps (MM:SS or H:MM:SS) of the first and last line of the story. \
Include the lead-in sentence that introduces the story and its closing moral.
- title: a short English title.
- chapter / verse: the Gita shloka being explained when the story was told, i.e. the most recent shloka \
chanted or announced before the story (chapter as a number like "2", verse like "60" or "60-61"). \
The class title, if given, says which shlokas the class covers. Use empty strings if unclear.
- evidence: a few words quoted from the transcript showing which shloka it was.
- summary: one or two sentences in English.
- speaker: the speaker label(s) telling it.`;

const SCHEMA = {
  type: "object",
  properties: {
    rohit_speakers: { type: "array", items: { type: "string" } },
    stories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          start: { type: "string" },
          end: { type: "string" },
          title: { type: "string" },
          chapter: { type: "string" },
          verse: { type: "string" },
          evidence: { type: "string" },
          summary: { type: "string" },
          speaker: { type: "string" },
        },
        required: ["start", "end", "title", "chapter", "verse", "evidence", "summary", "speaker"],
        additionalProperties: false,
      },
    },
  },
  required: ["rohit_speakers", "stories"],
  additionalProperties: false,
};

type AiStory = { start: string; end: string; title: string; chapter: string; verse: string; evidence: string; summary: string; speaker: string };

export function ts(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function parseTs(t: string): number | null {
  const parts = t.trim().replace(/^\[|\]$/g, "").split(":").map(Number);
  if (!parts.length || parts.some((p) => !Number.isFinite(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export async function findStories(info: ClassInfo, transcript: Transcript, signal: AbortSignal, onRetry: (m: string) => void) {
  const lines = groupLines(transcript.words);
  const body = lines.map((l) => `[${ts(l.start)}] S${l.spk ?? "?"}: ${l.text.join(" ")}`).join("\n");
  const user = `Class title: ${info.title}${info.group ? ` (${info.group})` : ""}\n\nTranscript:\n${body}`;
  const { parsed, costUsd } = await withRetry(() => chatJson(PROMPT, user, SCHEMA, signal), signal, onRetry);

  // The model only sees line start times: snap its start/end to the matching line, and stretch the end to that line's end.
  const byStart = new Map(lines.map((l) => [ts(l.start), l]));
  const nearest = (sec: number) => lines.reduce((best, l) => (Math.abs(l.start - sec) < Math.abs(best.start - sec) ? l : best), lines[0]);
  const stories = (parsed.stories as AiStory[]).flatMap((s) => {
    const a = parseTs(s.start), b = parseTs(s.end);
    if (a == null || b == null || !lines.length) return [];
    const first = byStart.get(s.start.trim()) ?? nearest(a);
    const last = byStart.get(s.end.trim()) ?? nearest(b);
    const start = Math.round(first.start * 10) / 10;
    const end = Math.round(Math.max(last.end, first.end) * 10) / 10;
    return [{ ...s, startSec: start, endSec: end }];
  });
  return { stories, rohitSpeakers: (parsed.rohit_speakers as string[]) ?? [], costUsd };
}

const overlap = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start)) / Math.max(1, Math.min(a.end - a.start, b.end - b.start));

/**
 * Put a new AI result into the class record without losing review work: stories you approved, rejected or added
 * by hand are kept, earlier unreviewed AI suggestions are replaced, and new suggestions that mostly overlap a
 * kept story are dropped (so a rejected story doesn't come back).
 */
export async function saveStories(info: ClassInfo, result: Awaited<ReturnType<typeof findStories>>) {
  let added = 0, kept = 0;
  const record = await updateRecord(info.id, (rec: ClassRecord) => {
    const keep = rec.stories.filter((s) => s.status !== "suggested" || s.origin === "manual");
    kept = keep.length;
    const fresh: Story[] = result.stories
      .filter((s) => !keep.some((k) => overlap(k, { start: s.startSec, end: s.endSec }) > 0.5))
      .map((s) =>
        newStory({
          start: s.startSec,
          end: s.endSec,
          title: s.title,
          chapter: s.chapter,
          verse: s.verse,
          summary: s.summary,
          origin: "ai",
          ai: { start: s.startSec, end: s.endSec, title: s.title, chapter: s.chapter, verse: s.verse, evidence: s.evidence, speaker: s.speaker },
        }),
      );
    added = fresh.length;
    return {
      ...rec,
      stories: [...keep, ...fresh].sort((x, y) => x.start - y.start),
      ai: { model: LLM_MODEL, ranAt: new Date().toISOString(), rohitSpeakers: result.rohitSpeakers, costUsd: result.costUsd, promptVersion: PROMPT_VERSION },
    };
  });
  return { record, found: result.stories.length, added, kept };
}
