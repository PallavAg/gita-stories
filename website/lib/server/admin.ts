import "server-only";
import { execFile } from "node:child_process";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ClassRecord, DataStats } from "@/lib/types";
import { DATA_DIR, ROOT } from "./config";
import { getState, resetQueue } from "./jobs";
import { dataPath, readJson, recordPath, transcriptPath, updateRecord } from "./store";

// Reset/delete actions for the Settings page. Nothing is destroyed outright: deleted files are moved to
// stories/.deleted/<time>/ (same layout as stories/), so moving them back restores them.

const run = promisify(execFile);
const DELETED = path.join(DATA_DIR, ".deleted");

async function files(dir: string, ext = ".json"): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await files(p, ext)));
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

const exists = (p: string) => stat(p).then(() => true, () => false);

/** move files under stories/ into one stories/.deleted/<time>/ batch, keeping their relative paths */
async function moveToDeleted(paths: string[], label: string) {
  const present = (await Promise.all(paths.map(async (p) => ((await exists(p)) ? p : null)))).filter((p): p is string => !!p);
  if (!present.length) return { moved: 0, where: null };
  const batch = path.join(DELETED, `${new Date().toISOString().replace(/[:.]/g, "-")} ${label}`);
  for (const p of present) {
    const dest = path.join(batch, path.relative(DATA_DIR, p));
    await mkdir(path.dirname(dest), { recursive: true });
    await rename(p, dest);
  }
  return { moved: present.length, where: path.relative(ROOT, batch) };
}

async function assertIdle(classId?: string) {
  const busy = (await getState()).jobs.filter((j) => (j.status === "running" || j.status === "queued") && (!classId || j.classId === classId));
  if (busy.length) throw new Error(classId ? "An AI run for this class is in progress. Cancel it or wait for it to finish first." : `${busy.length} AI ${busy.length === 1 ? "run is" : "runs are"} in progress. Cancel or wait for them first.`);
}

export async function dataStats(): Promise<DataStats> {
  const [transcripts, records, deleted, version] = await Promise.all([
    files(path.join(DATA_DIR, "transcripts")),
    files(path.join(DATA_DIR, "classes")),
    readdir(DELETED).catch(() => []),
    run("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).then((r) => r.stdout.trim(), () => null),
  ]);
  const stories = { suggested: 0, approved: 0, rejected: 0 };
  let classesWithStories = 0;
  for (const f of records) {
    const r = await readJson<ClassRecord>(f).catch(() => null);
    if (!r?.stories.length) continue;
    classesWithStories++;
    for (const s of r.stories) stories[s.status]++;
  }
  return { dataDir: path.relative(path.dirname(ROOT), DATA_DIR), transcripts: transcripts.length, classesWithStories, stories, deletedBatches: deleted.filter((d) => !d.startsWith(".")).length, version };
}

/** drop unreviewed AI suggestions and the AI-run marker, keeping approved, rejected and hand-added stories */
export async function resetSuggestions(classId?: string) {
  await assertIdle(classId);
  const ids = classId ? [classId] : (await files(path.join(DATA_DIR, "classes"))).map((f) => path.relative(path.join(DATA_DIR, "classes"), f).slice(0, -5));
  let removed = 0;
  for (const id of ids) {
    if (!(await exists(recordPath(id)))) continue;
    await updateRecord(id, (rec) => {
      const keep = rec.stories.filter((s) => s.status !== "suggested" || s.origin === "manual");
      removed += rec.stories.length - keep.length;
      return { ...rec, stories: keep, ai: null };
    });
  }
  return { message: `Removed ${removed} unreviewed AI ${removed === 1 ? "suggestion" : "suggestions"}.` };
}

export async function deleteStories(classId?: string) {
  await assertIdle(classId);
  const targets = classId ? [recordPath(classId)] : await files(path.join(DATA_DIR, "classes"));
  const { moved, where } = await moveToDeleted(targets, classId ? "stories (one class)" : "all stories");
  return { message: moved ? `Moved ${moved} story ${moved === 1 ? "file" : "files"} to ${where}.` : "There were no stories to delete." };
}

export async function deleteTranscripts(classId?: string) {
  await assertIdle(classId);
  let targets: string[];
  if (classId) {
    const historyDir = path.dirname(path.join(DATA_DIR, "transcripts", ".history", `${classId}.json`));
    const base = path.basename(classId);
    const old = (await readdir(historyDir).catch(() => [])).filter((f) => f.startsWith(`${base}.`)).map((f) => path.join(historyDir, f));
    targets = [transcriptPath(classId), ...old];
  } else {
    targets = [...(await files(path.join(DATA_DIR, "transcripts"))), ...(await allIn(path.join(DATA_DIR, "transcripts", ".history")))];
  }
  const { moved, where } = await moveToDeleted(targets, classId ? "transcript (one class)" : "all transcripts");
  return { message: moved ? `Moved ${moved} transcript ${moved === 1 ? "file" : "files"} to ${where}.` : "There were no transcripts to delete." };
}

async function allIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await allIn(p)));
    else out.push(p);
  }
  return out;
}

/** forget cached recording lengths; they're measured again on the next library load */
export async function rebuildMediaIndex() {
  await rm(dataPath("media-index.json"), { force: true });
  return { message: "Recording lengths will be measured again on the next library load." };
}

/**
 * Start over: every story, transcript (with older versions), the run history and the settings go into one
 * stories/.deleted batch. Cached recording lengths are kept, since they're just measurements of the files.
 */
export async function resetAll() {
  await assertIdle();
  const targets = [
    ...(await files(path.join(DATA_DIR, "classes"))),
    ...(await files(path.join(DATA_DIR, "transcripts"))),
    ...(await allIn(path.join(DATA_DIR, "transcripts", ".history"))),
    dataPath("jobs.json"),
    dataPath("settings.json"),
  ];
  const { moved, where } = await moveToDeleted(targets, "reset all");
  await resetQueue(); // the queue lives in memory too; clear it so it doesn't write the old history back
  return { message: moved ? `Everything was reset. ${moved} files were moved to ${where}.` : "There was nothing to reset." };
}
