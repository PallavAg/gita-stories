import "server-only";
import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ClassInfo, ClassRecord, ClassStatus, CollectionInfo, CollectionKey } from "@/lib/types";
import { COLLECTIONS, DATA_DIR, FFPROBE, ROOT } from "./config";
import { dataPath, readJson, writeJson } from "./store";

const run = promisify(execFile);

type MediaIndex = Record<string, { size: number; mtimeMs: number; duration: number | null }>;

async function walk(dir: string, ext: string, prefix = ""): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), ext, rel)));
    else if (e.name.toLowerCase().endsWith(ext)) out.push(rel.slice(0, -ext.length));
  }
  return out;
}

export function parseName(rel: string) {
  const base = rel.split("/").pop()!;
  const num = base.match(/^(\d+)\s*-?\s*/);
  const title = base
    .slice(num ? num[0].length : 0)
    .replace(/\s*\[[\w-]{11}\]$/, "")
    .replace(/\.mp4$/i, "")
    .replace(/\.$/, "")
    .trim();
  return { number: num ? Number(num[1]) : null, title: title || base, group: rel.includes("/") ? rel.split("/")[0] : null };
}

export function audioFile(collection: CollectionKey, rel: string) {
  return path.join(ROOT, COLLECTIONS[collection].audioDir, `${rel}.mp3`);
}

export function videoFile(collection: CollectionKey, rel: string) {
  const dir = COLLECTIONS[collection].videoDir;
  return dir ? path.join(ROOT, dir, `${rel}.mp4`) : null;
}

/** split "sunday/01 - foo" into its collection and relative path, rejecting anything that escapes the folders */
export function parseClassId(id: string): { collection: CollectionKey; rel: string } | null {
  const slash = id.indexOf("/");
  if (slash < 0) return null;
  const collection = id.slice(0, slash) as CollectionKey;
  const rel = id.slice(slash + 1);
  if (!(collection in COLLECTIONS) || !rel || rel.split("/").some((p) => p === ".." || p === "." || p === "")) return null;
  return { collection, rel };
}

async function probe(file: string): Promise<number | null> {
  try {
    const { stdout } = await run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    const d = parseFloat(stdout);
    return Number.isFinite(d) ? d : null;
  } catch {
    return null;
  }
}

let indexing: Promise<MediaIndex> | null = null;

/** audio durations, probed once with ffprobe and cached in stories/media-index.json */
async function durations(files: string[]): Promise<MediaIndex> {
  if (indexing) return indexing;
  indexing = (async () => {
    const index = (await readJson<MediaIndex>(dataPath("media-index.json"))) ?? {};
    const todo: { key: string; file: string; size: number; mtimeMs: number }[] = [];
    await Promise.all(
      files.map(async (file) => {
        const key = path.relative(ROOT, file);
        const s = await stat(file).catch(() => null);
        if (!s) return;
        const hit = index[key];
        if (!hit || hit.size !== s.size || hit.mtimeMs !== s.mtimeMs) todo.push({ key, file, size: s.size, mtimeMs: s.mtimeMs });
      }),
    );
    for (let i = 0; i < todo.length; i += 24) {
      await Promise.all(
        todo.slice(i, i + 24).map(async (t) => {
          index[t.key] = { size: t.size, mtimeMs: t.mtimeMs, duration: await probe(t.file) };
        }),
      );
    }
    if (todo.length) await writeJson(dataPath("media-index.json"), index, false);
    return index;
  })();
  try {
    return await indexing;
  } finally {
    indexing = null;
  }
}

function statusOf(transcribed: boolean, record: ClassRecord | null): ClassStatus {
  if (record?.ai || record?.stories.length) {
    return record.stories.some((s) => s.status === "suggested") ? "review" : "reviewed";
  }
  return transcribed ? "transcribed" : "new";
}

export async function listLibrary(): Promise<CollectionInfo[]> {
  const out: CollectionInfo[] = [];
  const all: { collection: CollectionKey; rel: string }[] = [];
  for (const key of Object.keys(COLLECTIONS) as CollectionKey[]) {
    for (const rel of await walk(path.join(ROOT, COLLECTIONS[key].audioDir), ".mp3")) all.push({ collection: key, rel });
  }
  const index = await durations(all.map((c) => audioFile(c.collection, c.rel)));

  for (const key of Object.keys(COLLECTIONS) as CollectionKey[]) {
    const cfg = COLLECTIONS[key];
    const videos = new Set(cfg.videoDir ? await walk(path.join(ROOT, cfg.videoDir), ".mp4") : []);
    const transcripts = new Set(await walk(path.join(DATA_DIR, "transcripts", key), ".json"));
    const recordRels = await walk(path.join(DATA_DIR, "classes", key), ".json");
    const records = new Map<string, ClassRecord>();
    await Promise.all(
      recordRels.map(async (rel) => {
        const r = await readJson<ClassRecord>(path.join(DATA_DIR, "classes", key, `${rel}.json`)).catch(() => null);
        if (r) records.set(rel, r);
      }),
    );

    const classes: ClassInfo[] = all
      .filter((c) => c.collection === key)
      .map(({ rel }) => {
        const record = records.get(rel) ?? null;
        const transcribed = transcripts.has(rel);
        const counts = { suggested: 0, approved: 0, rejected: 0 };
        record?.stories.forEach((s) => counts[s.status]++);
        return {
          id: `${key}/${rel}`,
          collection: key,
          rel,
          ...parseName(rel),
          duration: index[path.relative(ROOT, audioFile(key, rel))]?.duration ?? null,
          hasVideo: videos.has(rel),
          transcribed,
          aiRanAt: record?.ai?.ranAt ?? null,
          counts,
          status: statusOf(transcribed, record),
        };
      })
      .sort((a, b) => (a.group ?? "").localeCompare(b.group ?? "", undefined, { numeric: true }) || (a.number ?? 1e9) - (b.number ?? 1e9) || a.rel.localeCompare(b.rel));

    out.push({ key, label: cfg.label, hasVideo: !!cfg.videoDir, classes });
  }
  return out;
}

export async function getClassInfo(id: string): Promise<ClassInfo | null> {
  const parsed = parseClassId(id);
  if (!parsed) return null;
  const lib = await listLibrary();
  return lib.find((c) => c.key === parsed.collection)?.classes.find((c) => c.rel === parsed.rel) ?? null;
}
