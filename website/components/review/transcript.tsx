"use client";

import { Plus } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
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

/**
 * Word-level transcript around a story: words inside [start, end] are normal, the context around them is faded.
 * Clicking a word jumps there; the word being spoken is highlighted.
 */
export function StoryTranscript({ words, start, end, time, rohit, onSeek }: { words: Word[]; start: number; end: number; time: number; rohit: number[]; onSeek: (t: number) => void }) {
  const CONTEXT = 10;
  const slice = useMemo(() => {
    const from = Math.max(0, wordAt(words, start - CONTEXT));
    const to = wordAt(words, end + CONTEXT);
    return { from, lines: groupLines(words.slice(from, to + 1)) };
  }, [words, start, end]);
  const current = time >= start - CONTEXT && time <= end + CONTEXT ? wordAt(words, time) : -1;
  if (!slice.lines.length) return <p className="text-stone-400">No transcript words in this section.</p>;
  return (
    <div className="space-y-2 font-deva leading-relaxed">
      {slice.lines.map((l) => (
        <div key={l.first} className="flex gap-3">
          <span className={cx("w-16 shrink-0 pt-0.5 text-[11px] font-sans", l.spk != null && rohit.includes(l.spk) ? "font-medium text-stone-600" : "text-stone-400")}>{speakerName(l.spk, rohit)}</span>
          <p className="min-w-0 flex-1">
            {l.text.map((t, i) => {
              const idx = slice.from + l.first + i;
              const [ws] = words[idx];
              const inside = ws >= start - 0.05 && ws < end;
              return (
                <span
                  key={idx}
                  onClick={() => onSeek(ws)}
                  title={fmtTime(ws, true)}
                  className={cx("cursor-pointer rounded px-px hover:bg-orange-100", inside ? "text-stone-800" : "text-stone-300", idx === current && "bg-orange-200 text-stone-900")}
                >
                  {t}{" "}
                </span>
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
