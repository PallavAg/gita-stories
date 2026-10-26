import "server-only";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { UpdateResult, UpdateStatus } from "@/lib/types";
import { ROOT } from "./config";

// Self-update: `git pull` the project from GitHub, and reinstall packages when they changed.
// Saved stories live in stories/, which git ignores, so a pull never touches them.

const run = promisify(execFile);
const GIT = existsSync("/usr/bin/git") ? "/usr/bin/git" : "git";
// npm sits next to the node binary running this server, even when PATH doesn't include it
const NPM = [path.join(path.dirname(process.execPath), "npm"), "/opt/homebrew/bin/npm", "/usr/local/bin/npm"].find((p) => existsSync(p)) ?? "npm";

async function git(args: string[], timeout = 30_000) {
  try {
    const { stdout } = await run(GIT, args, { cwd: ROOT, timeout });
    return stdout.trim();
  } catch (err) {
    const e = err as { stderr?: string; message: string; killed?: boolean };
    if (e.killed) throw new Error(`git ${args[0]} timed out — check your internet connection`);
    throw new Error((e.stderr || e.message).trim());
  }
}

/** files npm may rewrite on its own; local changes to them are thrown away before pulling */
const REGENERATED = ["website/package-lock.json"];

/** files with uncommitted changes that a pull could overwrite (untracked files don't block a fast-forward) */
async function localChanges() {
  return (await git(["status", "--porcelain", "--untracked-files=no"])).split("\n").filter(Boolean).map((l) => l.slice(3));
}

export async function updateStatus(fetch = true): Promise<UpdateStatus> {
  const upstream = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).catch(() => null);
  const current = await git(["log", "-1", "--format=%h|%s|%cI"]);
  const [sha, subject, date] = current.split("|");
  if (!upstream) return { configured: false, upstream: null, current: { sha, subject, date }, behind: 0, ahead: 0, incoming: [], localChanges: [], checkedAt: new Date().toISOString(), fetchError: null };

  let fetchError: string | null = null;
  if (fetch) await git(["fetch", "--quiet", upstream.split("/")[0]]).catch((err) => (fetchError = `Couldn't reach GitHub: ${(err as Error).message}`));
  const [behind, ahead] = (await git(["rev-list", "--left-right", "--count", "@{u}...HEAD"])).split(/\s+/).map(Number);
  const incoming = behind
    ? (await git(["log", "HEAD..@{u}", "--format=%h|%s|%cI", "-n", "20"])).split("\n").filter(Boolean).map((l) => {
        const [s, subj, d] = l.split("|");
        return { sha: s, subject: subj, date: d };
      })
    : [];
  return { configured: true, upstream, current: { sha, subject, date }, behind, ahead, incoming, localChanges: await localChanges(), checkedAt: new Date().toISOString(), fetchError };
}

let busy = false;

export async function pullUpdate(): Promise<UpdateResult> {
  if (busy) throw new Error("An update is already running");
  busy = true;
  try {
    const edited = await localChanges();
    const regenerated = edited.filter((f) => REGENERATED.includes(f));
    if (regenerated.length) await git(["checkout", "--", ...regenerated]);
    const status = await updateStatus(true);
    if (!status.configured) throw new Error("This folder isn't linked to a GitHub repo, so there's nothing to pull from.");
    if (status.fetchError) throw new Error(status.fetchError);
    if (status.localChanges.length)
      throw new Error(`Some project files were edited on this computer, and updating could overwrite them: ${status.localChanges.slice(0, 5).join(", ")}${status.localChanges.length > 5 ? "…" : ""}. Commit or undo those edits first.`);
    if (!status.behind) return { updated: false, from: status.current.sha, to: status.current.sha, commits: [], installed: false, restartNeeded: false, log: "Already up to date." };

    const from = await git(["rev-parse", "HEAD"]);
    let log: string;
    try {
      log = await git(["pull", "--ff-only"], 120_000);
    } catch (err) {
      const msg = (err as Error).message;
      throw new Error(/diverg|fast-forward/i.test(msg) ? "This copy has its own commits that GitHub doesn't, so it can't update automatically. Ask Claude to sort out the git history." : msg);
    }
    const to = await git(["rev-parse", "HEAD"]);
    const changed = (await git(["diff", "--name-only", from, to])).split("\n");

    // new or changed packages need an install; config and package changes need a server restart to take effect
    let installed = false;
    if (changed.some((f) => /^website\/package(-lock)?\.json$/.test(f))) {
      try {
        const { stdout } = await run(NPM, ["install", "--no-audit", "--no-fund"], { cwd: path.join(ROOT, "website"), timeout: 300_000 });
        log += `\n\n${stdout.trim()}`;
        installed = true;
      } catch (err) {
        throw new Error(`The code updated, but installing packages failed. Run "npm install" in the website folder. (${((err as { stderr?: string }).stderr || (err as Error).message).trim().slice(0, 300)})`);
      }
    }
    const restartNeeded = installed || changed.some((f) => /^website\/(next\.config|\.env|tsconfig|postcss)/.test(f));
    return { updated: true, from: from.slice(0, 7), to: to.slice(0, 7), commits: status.incoming, installed, restartNeeded, log };
  } finally {
    busy = false;
  }
}
