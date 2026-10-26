import type { NextRequest } from "next/server";
import { LLM_MODEL, STT_MODEL, STT_USD_PER_HOUR } from "@/lib/server/config";
import { fail, handle } from "@/lib/server/http";
import { cancel, clearHistory, enqueue, getState, retry, updateSettings } from "@/lib/server/jobs";
import { PROMPT, PROMPT_VERSION } from "@/lib/server/pipeline";
import type { JobMode } from "@/lib/types";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  return handle(async () => {
    const state = await getState();
    const classId = request.nextUrl.searchParams.get("classId");
    const jobs = classId ? state.jobs.filter((j) => j.classId === classId).slice(0, 5) : state.jobs;
    const meta = request.nextUrl.searchParams.has("meta")
      ? { prompt: PROMPT, promptVersion: PROMPT_VERSION, sttModel: STT_MODEL, llmModel: LLM_MODEL, sttUsdPerHour: STT_USD_PER_HOUR }
      : undefined;
    return Response.json({ ...state, jobs, meta });
  });
}

type Action =
  | { action: "enqueue"; classIds: string[]; mode: JobMode }
  | { action: "cancel"; jobId: string }
  | { action: "retry"; jobId: string }
  | { action: "settings"; concurrency?: number; paused?: boolean }
  | { action: "clear" };

export function POST(request: NextRequest) {
  return handle(async () => {
    const body = (await request.json()) as Action;
    switch (body.action) {
      case "enqueue":
        if (!Array.isArray(body.classIds) || !body.classIds.length) return fail(400, "Pick at least one class");
        return Response.json(await enqueue(body.classIds, body.mode === "stories" ? "stories" : "full"));
      case "cancel":
        await cancel(body.jobId);
        return Response.json({ ok: true });
      case "retry":
        return Response.json(await retry(body.jobId));
      case "settings":
        await updateSettings(body);
        return Response.json({ ok: true });
      case "clear":
        await clearHistory();
        return Response.json({ ok: true });
      default:
        return fail(400, "Unknown action");
    }
  });
}
