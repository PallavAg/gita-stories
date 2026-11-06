import "server-only";
import { randomUUID } from "node:crypto";
import type { ClassInfo, Job, JobMode, JobsState, JobStep } from "@/lib/types";
import { fullLabel } from "@/lib/names";
import { getClassInfo } from "./library";
import { findStories, readTranscript, saveStories, transcribe } from "./pipeline";
import { dataPath, readJson, writeJson } from "./store";

// In-process queue. State is mirrored to stories/jobs.json so history survives restarts; jobs that were
// running or queued when the server stopped come back as "interrupted" and can be retried.

const FILE = dataPath("jobs.json");
// xAI's limits are high (Grok: 7,200 requests and 50M tokens a minute on the starting tier); transcription is the
// tighter one and is throttled separately in xai.ts, so many classes can run at once.
export const DEFAULT_CONCURRENCY = 8;
export const MAX_CONCURRENCY = 20;
const MAX_HISTORY = 500;

type Runner = { state: JobsState; controllers: Map<string, AbortController>; loaded: Promise<void>; saveTimer: NodeJS.Timeout | null };

// Survive Next's dev-mode module reloads.
const g = globalThis as unknown as { __storyJobs?: Runner };

function runner(): Runner {
  if (!g.__storyJobs) {
    const r: Runner = { state: { jobs: [], concurrency: DEFAULT_CONCURRENCY, paused: false, totals: { stt: 0, llm: 0, runs: 0 } }, controllers: new Map(), loaded: Promise.resolve(), saveTimer: null };
    r.loaded = (async () => {
      const saved = await readJson<JobsState>(FILE).catch(() => null);
      if (saved) {
        for (const j of saved.jobs) {
          if (j.status === "running" || j.status === "queued") {
            j.status = "interrupted";
            j.error = j.error ?? "The server stopped before this job finished.";
            j.finishedAt = j.finishedAt ?? new Date().toISOString();
          }
        }
        r.state = { ...r.state, ...saved };
      }
    })();
    g.__storyJobs = r;
  }
  return g.__storyJobs;
}

function persist(r: Runner) {
  if (r.saveTimer) return;
  r.saveTimer = setTimeout(() => {
    r.saveTimer = null;
    r.state.jobs = r.state.jobs.slice(0, MAX_HISTORY);
    writeJson(FILE, r.state).catch((err) => console.error("Couldn't save jobs.json", err));
  }, 300);
}

export async function getState(): Promise<JobsState> {
  const r = runner();
  await r.loaded;
  return r.state;
}

function setStep(r: Runner, job: Job, step: JobStep, detail: string | null = null) {
  job.step = step;
  job.stepDetail = detail;
  job.stepStartedAt = new Date().toISOString();
  job.progress = 0;
  persist(r);
}

async function execute(r: Runner, job: Job, info: ClassInfo, signal: AbortSignal) {
  const onRetry = (msg: string) => {
    job.stepDetail = msg;
    persist(r);
  };
  let transcript = job.mode === "stories" ? await readTranscript(info.id) : null;
  if (!transcript) {
    setStep(r, job, "transcribing");
    const res = await transcribe(info, signal, (detail, fraction) => {
      if (fraction !== undefined && job.step !== "filling") setStep(r, job, "filling");
      job.stepDetail = detail;
      if (fraction !== undefined) job.progress = fraction;
      persist(r);
    }, onRetry);
    transcript = res.transcript;
    job.cost.stt = res.cost;
    r.state.totals.stt += res.cost;
  }
  setStep(r, job, "finding", "Grok is reading the transcript");
  const found = await findStories(info, transcript, signal, onRetry);
  job.cost.llm = found.costUsd;
  r.state.totals.llm += found.costUsd;
  setStep(r, job, "saving");
  const saved = await saveStories(info, found);
  job.result = { found: saved.found, added: saved.added, kept: saved.kept };
}

function pump() {
  const r = runner();
  if (r.state.paused) return;
  const running = r.state.jobs.filter((j) => j.status === "running").length;
  const next = r.state.jobs.filter((j) => j.status === "queued").reverse().slice(0, Math.max(0, r.state.concurrency - running));
  for (const job of next) start(r, job);
}

function start(r: Runner, job: Job) {
  const controller = new AbortController();
  r.controllers.set(job.id, controller);
  job.status = "running";
  job.startedAt = new Date().toISOString();
  persist(r);
  (async () => {
    try {
      const info = await getClassInfo(job.classId);
      if (!info) throw new Error("This class's audio file is no longer in the library.");
      job.duration = info.duration;
      await execute(r, job, info, controller.signal);
      job.status = "done";
      job.step = "done";
      job.stepDetail = null;
      job.progress = 1;
      r.state.totals.runs++;
    } catch (err) {
      if (controller.signal.aborted) {
        job.status = "canceled";
        job.error = null;
      } else {
        job.status = "failed";
        job.errorStep = job.step;
        job.error = (err as Error).message || String(err);
        console.error(`Job ${job.id} (${job.title}) failed during ${job.step}:`, err);
      }
    } finally {
      job.finishedAt = new Date().toISOString();
      r.controllers.delete(job.id);
      persist(r);
      pump();
    }
  })();
}

export async function enqueue(classIds: string[], mode: JobMode) {
  const r = runner();
  await r.loaded;
  const busy = new Set(r.state.jobs.filter((j) => j.status === "queued" || j.status === "running").map((j) => j.classId));
  const created: Job[] = [];
  for (const classId of classIds) {
    if (busy.has(classId)) continue;
    const info = await getClassInfo(classId);
    if (!info) throw new Error(`Unknown class: ${classId}`);
    const now = new Date().toISOString();
    created.push({
      id: randomUUID().slice(0, 8),
      classId,
      title: fullLabel(info.display),
      // "stories only" needs a transcript; fall back to a full run without one
      mode: mode === "stories" && !info.transcribed ? "full" : mode,
      status: "queued",
      step: "queued",
      stepDetail: null,
      progress: 0,
      duration: info.duration,
      createdAt: now,
      startedAt: null,
      stepStartedAt: null,
      finishedAt: null,
      error: null,
      errorStep: null,
      cost: { stt: 0, llm: 0 },
      result: null,
    });
  }
  r.state.jobs.unshift(...created.reverse());
  persist(r);
  pump();
  return { created: created.length, skipped: classIds.length - created.length };
}

export async function cancel(jobId: string | "all") {
  const r = runner();
  await r.loaded;
  for (const job of r.state.jobs) {
    if (jobId !== "all" && job.id !== jobId) continue;
    if (job.status === "queued") {
      job.status = "canceled";
      job.finishedAt = new Date().toISOString();
    } else if (job.status === "running") r.controllers.get(job.id)?.abort();
  }
  persist(r);
}

export async function retry(jobId: string) {
  const r = runner();
  await r.loaded;
  const job = r.state.jobs.find((j) => j.id === jobId);
  if (!job) throw new Error("Job not found");
  // if the transcript got saved before the failure, don't pay for it again
  const transcribed = !!(await readTranscript(job.classId));
  return enqueue([job.classId], transcribed ? "stories" : job.mode);
}

export async function updateSettings(s: { concurrency?: number; paused?: boolean }) {
  const r = runner();
  await r.loaded;
  if (s.concurrency !== undefined) r.state.concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, Math.round(s.concurrency)));
  if (s.paused !== undefined) r.state.paused = s.paused;
  persist(r);
  pump();
}

/** forget finished runs and the spending totals (running and queued jobs stay) */
export async function clearHistory() {
  const r = runner();
  await r.loaded;
  r.state.jobs = r.state.jobs.filter((j) => j.status === "queued" || j.status === "running");
  r.state.totals = { stt: 0, llm: 0, runs: 0 };
  persist(r);
}

/** back to a fresh queue: no history, no totals, default speed, not paused */
export async function resetQueue() {
  await clearHistory();
  const r = runner();
  r.state.concurrency = DEFAULT_CONCURRENCY;
  r.state.paused = false;
  persist(r);
}
