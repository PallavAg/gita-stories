import type { NextRequest } from "next/server";
import { fail, handle } from "@/lib/server/http";
import { getClassInfo } from "@/lib/server/library";
import { newStory, updateRecord } from "@/lib/server/store";
import type { Story } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUSES = ["suggested", "approved", "rejected"];

function clean(input: Partial<Story>, duration: number | null): string | null {
  if (typeof input.start !== "number" || typeof input.end !== "number" || !Number.isFinite(input.start) || !Number.isFinite(input.end)) return "Start and end must be numbers";
  if (input.start < 0 || input.end <= input.start) return "End must be after start";
  if (duration && input.start > duration + 1) return "Start is past the end of the recording";
  if (input.status && !STATUSES.includes(input.status)) return "Unknown status";
  return null;
}

/** create or update one story; body: { classId, story } (a story without an id is created) */
export function POST(request: NextRequest) {
  return handle(async () => {
    const { classId, story } = (await request.json()) as { classId: string; story: Partial<Story> };
    const info = await getClassInfo(classId);
    if (!info) return fail(404, "No class with that id");
    const problem = clean(story, info.duration);
    if (problem) return fail(400, problem);

    let saved: Story | null = null;
    await updateRecord(classId, (rec) => {
      const editable = {
        start: Math.round(story.start! * 10) / 10,
        end: Math.round(story.end! * 10) / 10,
        title: String(story.title ?? "").trim(),
        chapter: String(story.chapter ?? "").trim(),
        verse: String(story.verse ?? "").trim(),
        summary: String(story.summary ?? "").trim(),
        transcriptOverride: story.transcriptOverride?.trim() ? story.transcriptOverride : null,
        status: story.status ?? "suggested",
      };
      const i = story.id ? rec.stories.findIndex((s) => s.id === story.id) : -1;
      if (story.id && i < 0) throw new Error("That story no longer exists — it may have been replaced by a newer AI run. Reload the page.");
      if (i >= 0) {
        saved = { ...rec.stories[i], ...editable, updatedAt: new Date().toISOString() };
        rec.stories[i] = saved;
      } else {
        saved = newStory({ ...editable, origin: "manual" });
        rec.stories.push(saved);
      }
      rec.stories.sort((a, b) => a.start - b.start);
      return rec;
    });
    return Response.json({ story: saved });
  });
}

/** delete a story outright (the UI only offers this for stories you added by hand; AI ones get rejected instead) */
export function DELETE(request: NextRequest) {
  return handle(async () => {
    const classId = request.nextUrl.searchParams.get("classId") ?? "";
    const storyId = request.nextUrl.searchParams.get("storyId") ?? "";
    if (!(await getClassInfo(classId))) return fail(404, "No class with that id");
    await updateRecord(classId, (rec) => ({ ...rec, stories: rec.stories.filter((s) => s.id !== storyId) }));
    return Response.json({ ok: true });
  });
}
