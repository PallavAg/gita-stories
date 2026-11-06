import "server-only";
import type { AppSettings } from "@/lib/types";
import { dataPath, readJson, writeJson } from "./store";

export const DEFAULT_SETTINGS: AppSettings = { reasoningEffort: "high", fillerWords: false };
const EFFORTS = ["low", "medium", "high", "xhigh"];

export async function getSettings(): Promise<AppSettings> {
  const saved = await readJson<Partial<AppSettings>>(dataPath("settings.json")).catch(() => null);
  return { ...DEFAULT_SETTINGS, ...saved };
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = { ...(await getSettings()) };
  if (patch.reasoningEffort !== undefined) {
    if (!EFFORTS.includes(patch.reasoningEffort)) throw new Error("Unknown reasoning level");
    next.reasoningEffort = patch.reasoningEffort;
  }
  if (patch.fillerWords !== undefined) next.fillerWords = !!patch.fillerWords;
  await writeJson(dataPath("settings.json"), next);
  return next;
}
