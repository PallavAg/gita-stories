import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ClassRecord, Story } from "@/lib/types";
import { DATA_DIR } from "./config";

// Everything the app saves lives under <project>/stories:
//   transcripts/<classId>.json   raw speech-to-text output (words with times and speakers)
//   classes/<classId>.json       stories for that class, including your edits
//   jobs.json                    AI run history and queue settings
//   media-index.json             cached audio durations

export const transcriptPath = (classId: string) => path.join(DATA_DIR, "transcripts", `${classId}.json`);
export const recordPath = (classId: string) => path.join(DATA_DIR, "classes", `${classId}.json`);
export const dataPath = (name: string) => path.join(DATA_DIR, name);

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Could not read ${path.relative(DATA_DIR, file)}: ${(err as Error).message}`);
  }
}

/** write via a temp file + rename so a crash never leaves a half-written file */
export async function writeJson(file: string, data: unknown, pretty = true) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, pretty ? 1 : undefined));
  await rename(tmp, file);
}

export function emptyRecord(classId: string): ClassRecord {
  return { classId, stories: [], ai: null, updatedAt: new Date().toISOString() };
}

export async function readRecord(classId: string): Promise<ClassRecord> {
  return (await readJson<ClassRecord>(recordPath(classId))) ?? emptyRecord(classId);
}

// Serialize writes per class so a save from the browser and an AI run finishing can't clobber each other.
const locks = new Map<string, Promise<unknown>>();
export async function updateRecord(classId: string, fn: (record: ClassRecord) => ClassRecord | Promise<ClassRecord>) {
  const prev = locks.get(classId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    const record = await fn(await readRecord(classId));
    record.updatedAt = new Date().toISOString();
    await writeJson(recordPath(classId), record);
    return record;
  });
  locks.set(classId, next);
  return next;
}

export function newStory(fields: Partial<Story> & Pick<Story, "start" | "end">): Story {
  const now = new Date().toISOString();
  return {
    id: randomUUID().slice(0, 8),
    title: "",
    chapter: "",
    verse: "",
    summary: "",
    transcriptOverride: null,
    status: "suggested",
    origin: "manual",
    ai: null,
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
}
