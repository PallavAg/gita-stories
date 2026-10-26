import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import type { CollectionKey } from "@/lib/types";

// The repo is public, so the key lives in website/.env.local (git-ignored), which Next loads automatically.
export const XAI_API_KEY = process.env.XAI_API_KEY?.trim() ?? "";

export const STT_MODEL = "grok-voice-transcribe-2.0";
export const LLM_MODEL = "grok-4.7";
/** xAI's published batch speech-to-text price; the API response doesn't report cost */
export const STT_USD_PER_HOUR = 0.1;

/** project folder (the website lives in <root>/website) */
export const ROOT = path.resolve(/* turbopackIgnore: true */ process.cwd(), "..");
export const DATA_DIR = path.join(ROOT, "stories");

// the dev server may not inherit the shell's PATH, so prefer Homebrew's absolute paths
const tool = (name: string) => [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`].find((p) => existsSync(p)) ?? name;
export const FFMPEG = tool("ffmpeg");
export const FFPROBE = tool("ffprobe");

export const COLLECTIONS: Record<CollectionKey, { label: string; audioDir: string; videoDir: string | null }> = {
  sunday: { label: "Sunday Family Class", audioDir: "Sunday Family Class Singapore Audio", videoDir: "Sunday Family Class Singapore" },
  saturday: { label: "Saturday Gita Class", audioDir: "Saturday Gita Class Audio", videoDir: "Saturday Gita Class" },
  chapters: { label: "Gita by Chapter (audio series)", audioDir: "audio", videoDir: null },
};
