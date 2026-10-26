import type { NextRequest } from "next/server";
import { fail, handle } from "@/lib/server/http";
import { getClassInfo } from "@/lib/server/library";
import { readTranscript } from "@/lib/server/pipeline";
import { readRecord } from "@/lib/server/store";
import type { ClassDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  return handle(async () => {
    const id = request.nextUrl.searchParams.get("id") ?? "";
    const info = await getClassInfo(id);
    if (!info) return fail(404, "No class with that id");
    const [record, transcript] = await Promise.all([readRecord(id), readTranscript(id)]);
    const rohitSpeakers = (record.ai?.rohitSpeakers ?? []).map((s) => Number(String(s).replace(/\D/g, ""))).filter(Number.isFinite);
    const detail: ClassDetail = { info, record, words: transcript?.words ?? null, rohitSpeakers };
    return Response.json(detail);
  });
}
