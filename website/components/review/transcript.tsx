"use client";

import { Plus } from "lucide-react";
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fmtTime, groupLines, type Line, wordAt } from "@/lib/transcript";
import type { Story, Word } from "@/lib/types";
import { cx } from "../ui";
import { STORY_COLORS } from "./player";

export function speakerName(spk: number | null, rohit: number[]) {
  if (spk == null) return "Unknown";
  return rohit.includes(spk) ? "Rohit" : `Speaker ${spk}`;
}

/** plain text of the words between start and end */
export function textBetween(words: Word[], start: number, end: number) {
  return words
    .filter((w) => w[0] >= start - 0.05 && w[0] < end)
    .map((w) => w[2])
    .join(" ");
}

/** start is green and end is rose everywhere marking shows up: buttons, word hover, the story's boundary bars */
export const MARK_COLORS = {
  start: {
    button: "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
    armed: "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700",
    word: "hover:bg-emerald-500 hover:text-white",
    bar: "border-emerald-500",
    ring: "ring-emerald-400",
    text: "text-emerald-700",
  },
  end: {
    button: "border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100",
    armed: "border-rose-600 bg-rose-600 text-white hover:bg-rose-700",
    word: "hover:bg-rose-500 hover:text-white",
    bar: "border-rose-500",
    ring: "ring-rose-400",
    text: "text-rose-700",
  },
};

/**
 * Story time for marking word idx as the first or last word of a story. Times are kept to 0.1s (the server rounds
 * them), so pick a value that still includes this word and leaves out its neighbour once rounded.
 */
function markTime(words: Word[], idx: number, which: "start" | "end") {
  const r = (t: number) => Math.round(t * 10) / 10;
  const [ws, we] = words[idx];
  if (which === "start") return r(ws);
  const next = words[idx + 1]?.[0] ?? Infinity;
  return Math.max(Math.min(r(we), Math.floor(next * 10) / 10), Math.floor(ws * 10) / 10 + 0.1);
}

/**
 * Word-level transcript around a story: words inside [start, end] are normal, the context around them is faded.
 * Clicking a word jumps there; the word being spoken is highlighted. While `marking`, clicking a word sets the
 * story's start or end to it instead.
 */
export function StoryTranscript({ words, start, end, time, rohit, onSeek, marking, onMark }: { words: Word[]; start: number; end: number; time: number; rohit: number[]; onSeek: (t: number) => void; marking?: "start" | "end" | null; onMark?: (t: number) => void }) {
  const CONTEXT = 30; // seconds of faded transcript shown before and after the story
  const REACH = 180; // while marking, how far past the story the transcript reaches on the side being moved
  const before = marking === "start" ? REACH : CONTEXT;
  const after = marking === "end" ? REACH : CONTEXT;
  // lines are grouped over the whole class so they stay the same as the window around the story moves
  const allLines = useMemo(() => groupLines(words), [words]);
  const lines = useMemo(() => allLines.filter((l) => l.end >= start - before && l.start <= end + after), [allLines, start, end, before, after]);
  const current = time >= start - before && time <= end + after ? wordAt(words, time) : -1;
  const isInside = (ws: number) => ws >= start - 0.05 && ws < end;
  const first = Math.max(0, wordAt(words, start - 0.05 - 1e-6) + 1);
  const last = wordAt(words, end - 1e-6);

  // Context lines come and go above the view as marking starts and stops, which would shift the text under the
  // pointer. Remember where the visible lines sit in the scroll box and keep the first one that's still there in place.
  const root = useRef<HTMLDivElement>(null);
  const pins = useRef<{ idx: string; top: number }[]>([]);
  const remember = useCallback(() => {
    const box = root.current?.closest(".overflow-y-auto");
    if (!box) return;
    const { top: boxTop, bottom: boxBottom } = box.getBoundingClientRect();
    pins.current = [];
    for (const line of root.current!.querySelectorAll<HTMLElement>("[data-line]")) {
      const r = line.getBoundingClientRect();
      if (r.bottom > boxTop && r.top < boxBottom) pins.current.push({ idx: line.dataset.line!, top: r.top - boxTop });
    }
  }, []);
  useLayoutEffect(() => {
    const box = root.current?.closest(".overflow-y-auto");
    for (const pin of pins.current) {
      const line = root.current?.querySelector(`[data-line="${pin.idx}"]`);
      if (!box || !line) continue;
      box.scrollTop += line.getBoundingClientRect().top - box.getBoundingClientRect().top - pin.top;
      break;
    }
    remember();
  }, [lines, remember]);
  useEffect(() => {
    const box = root.current?.closest(".overflow-y-auto");
    box?.addEventListener("scroll", remember, { passive: true });
    return () => box?.removeEventListener("scroll", remember);
  }, [remember]);

  if (!lines.length) return <p className="text-stone-400">No transcript words in this section.</p>;
  return (
    <div ref={root} className="space-y-3 font-deva text-[17px] leading-relaxed [overflow-anchor:none]">
      {lines.map((l) => (
        <div key={l.first} data-line={l.first} className="flex gap-3">
          <span className={cx("w-16 shrink-0 pt-1.5 text-[11px] font-sans", l.spk != null && rohit.includes(l.spk) ? "font-medium text-stone-600" : "text-stone-400")}>{speakerName(l.spk, rohit)}</span>
          <p className="min-w-0 flex-1">
            {l.text.map((t, i) => {
              const idx = l.first + i;
              const [ws] = words[idx];
              const inside = isInside(ws);
              return (
                <Fragment key={idx}>
                <span
                  onClick={() => (marking && onMark ? onMark(markTime(words, idx, marking)) : onSeek(ws))}
                  title={marking ? `Story ${marking}s ${marking === "start" ? "at" : "after"} this word (${fmtTime(ws, true)})` : fmtTime(ws, true)}
                  className={cx(
                    "rounded px-px",
                    marking ? cx("cursor-crosshair", MARK_COLORS[marking].word) : "cursor-pointer hover:bg-orange-100",
                    inside ? "text-stone-800" : "text-stone-300",
                    idx === current && "bg-orange-200 text-stone-900",
                    idx === first && inside && cx("rounded-l-none border-l-2 pl-0.5", MARK_COLORS.start.bar),
                    idx === last && inside && cx("rounded-r-none border-r-2 pr-0.5", MARK_COLORS.end.bar),
                  )}
                >
                  {t}
                </span>{" "}
                </Fragment>
              );
            })}
          </p>
        </div>
      ))}
    </div>
  );
}

/** the whole class, line by line; follows playback and shows where stories are */
export function FullTranscript({ words, stories, rohit, time, onSeek, onNewStory, onOpenStory }: { words: Word[]; stories: Story[]; rohit: number[]; time: number; onSeek: (t: number) => void; onNewStory: (t: number) => void; onOpenStory: (id: string) => void }) {
  const lines = useMemo(() => groupLines(words), [words]);
  const [follow, setFollow] = useState(true);
  const [onlyRohit, setOnlyRohit] = useState(false);
  let active = -1;
  for (let lo = 0, hi = lines.length - 1; lo <= hi; ) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].start <= time) {
      active = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // scroll only the transcript box (scrollIntoView would also move the page)
    const line = activeRef.current;
    const box = line?.closest(".overflow-y-auto");
    if (!follow || !line || !box) return;
    const top = line.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    box.scrollTo({ top: top - box.clientHeight / 3, behavior: "smooth" });
  }, [active, follow]);

  return (
    <div>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-4 border-b border-stone-100 bg-white/95 px-4 py-2 text-xs text-stone-500 backdrop-blur">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />Follow playback</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={onlyRohit} onChange={(e) => setOnlyRohit(e.target.checked)} />Only Rohit</label>
        <span className="ml-auto">Click a line to play from there · hover for “New story here”</span>
      </div>
      <div className="divide-y divide-stone-50">
        {lines.map((l, i) =>
          onlyRohit && !(l.spk != null && rohit.includes(l.spk)) ? null : (
            <TranscriptLine
              key={l.first}
              line={l}
              story={stories.find((s) => l.start >= s.start - 0.5 && l.start < s.end) ?? null}
              active={i === active}
              rohit={rohit}
              innerRef={i === active ? activeRef : undefined}
              onSeek={onSeek}
              onNewStory={onNewStory}
              onOpenStory={onOpenStory}
            />
          ),
        )}
      </div>
    </div>
  );
}

const TranscriptLine = memo(function TranscriptLine({ line, story, active, rohit, innerRef, onSeek, onNewStory, onOpenStory }: { line: Line; story: Story | null; active: boolean; rohit: number[]; innerRef?: React.Ref<HTMLDivElement>; onSeek: (t: number) => void; onNewStory: (t: number) => void; onOpenStory: (id: string) => void }) {
  const isRohit = line.spk != null && rohit.includes(line.spk);
  return (
    <div ref={innerRef} className={cx("group relative flex gap-3 py-2 pl-4 pr-3", active ? "bg-orange-50" : "hover:bg-stone-50")}>
      {story && <button type="button" title={`Story: ${story.title || "Untitled"}`} onClick={() => onOpenStory(story.id)} className={cx("absolute inset-y-0 left-0 w-1", STORY_COLORS[story.status])} />}
      <button type="button" onClick={() => onSeek(line.start)} className="w-12 shrink-0 pt-0.5 text-left text-[11px] tabular-nums text-stone-400 hover:text-orange-700">
        {fmtTime(line.start)}
      </button>
      <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onSeek(line.start)}>
        <p className={cx("text-[11px]", isRohit ? "font-medium text-stone-600" : "text-stone-400")}>{speakerName(line.spk, rohit)}</p>
        <p className={cx("font-deva leading-relaxed", isRohit ? "text-stone-800" : "text-stone-500")}>{line.text.join(" ")}</p>
      </div>
      <button
        type="button"
        onClick={() => onNewStory(line.start)}
        className="invisible absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-xs text-stone-600 shadow-sm hover:text-stone-900 group-hover:visible"
      >
        <Plus className="h-3 w-3" />
        New story here
      </button>
    </div>
  );
});
