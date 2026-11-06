import type { NextRequest } from "next/server";
import { dataStats, deleteStories, deleteTranscripts, rebuildMediaIndex, resetAll, resetSuggestions } from "@/lib/server/admin";
import { LLM_MODEL, STT_MODEL } from "@/lib/server/config";
import { fail, handle } from "@/lib/server/http";
import { clearHistory } from "@/lib/server/jobs";
import { getClassInfo } from "@/lib/server/library";
import { DEFAULT_SETTINGS, getSettings, saveSettings } from "@/lib/server/settings";
import type { AppSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

export function GET() {
  return handle(async () => Response.json({ settings: await getSettings(), defaults: DEFAULT_SETTINGS, stats: await dataStats(), models: { stt: STT_MODEL, llm: LLM_MODEL } }));
}

type Action =
  | { action: "save"; settings: Partial<AppSettings> }
  | { action: "reset-settings" }
  | { action: "reset-suggestions" | "delete-stories" | "delete-transcripts"; classId?: string }
  | { action: "clear-history" }
  | { action: "rebuild-index" }
  | { action: "reset-all" };

export function POST(request: NextRequest) {
  return handle(async () => {
    const body = (await request.json()) as Action;
    if ("classId" in body && body.classId && !(await getClassInfo(body.classId))) return fail(404, "No class with that id");
    try {
      switch (body.action) {
        case "save":
          return Response.json({ settings: await saveSettings(body.settings), message: "Saved" });
        case "reset-settings":
          return Response.json({ settings: await saveSettings(DEFAULT_SETTINGS), message: "Settings reset to defaults" });
        case "reset-suggestions":
          return Response.json(await resetSuggestions(body.classId));
        case "delete-stories":
          return Response.json(await deleteStories(body.classId));
        case "delete-transcripts":
          return Response.json(await deleteTranscripts(body.classId));
        case "clear-history":
          await clearHistory();
          return Response.json({ message: "Run history cleared." });
        case "rebuild-index":
          return Response.json(await rebuildMediaIndex());
        case "reset-all":
          return Response.json(await resetAll());
        default:
          return fail(400, "Unknown action");
      }
    } catch (err) {
      // expected refusals (e.g. a run in progress) go back as a plain 409 message
      return fail(409, (err as Error).message);
    }
  });
}
