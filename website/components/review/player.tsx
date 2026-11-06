"use client";

import { AlertTriangle, Film, Headphones, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { useRef, useState } from "react";
import { fmtTime } from "@/lib/transcript";
import type { Story } from "@/lib/types";
import { cx, IconButton, Segmented, Spinner } from "../ui";
import type { Media } from "./use-media";

export const STORY_COLORS: Record<Story["status"], string> = {
  suggested: "bg-amber-400",
  approved: "bg-emerald-500",
  rejected: "bg-stone-300",
};

const RATES = [1, 2, 2.5, 3];

export function Player({
  attach,
  media,
  src,
  mode,
  hasVideo,
  onMode,
  rate,
  onRate,
  stories,
  openId,
  onOpenStory,
}: {
  attach: (node: HTMLVideoElement | null) => void;
  media: Media;
  src: string;
  mode: "audio" | "video";
  hasVideo: boolean;
  onMode: (m: "audio" | "video") => void;
  rate: number;
  onRate: (r: number) => void;
  stories: Story[];
  openId: string | null;
  onOpenStory: (id: string) => void;
}) {
  const showVideo = mode === "video" && hasVideo;
  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <div className={cx("relative bg-black", showVideo ? "aspect-video" : "hidden")}>
        <video ref={attach} src={src} preload="metadata" playsInline className="h-full w-full" onClick={media.toggle} />
        {media.loading && showVideo && (
          <div className="absolute inset-0 grid place-items-center">
            <Spinner className="h-6 w-6 text-white/70" />
          </div>
        )}
      </div>

      <div className="space-y-3 p-3">
        {media.error && (
          <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertTriangle className="h-3.5 w-3.5" />
            {media.error}
          </p>
        )}
        <Timeline media={media} stories={stories} openId={openId} onOpenStory={onOpenStory} />
        <div className="flex flex-wrap items-center gap-1">
          <IconButton label="Back 10 seconds" onClick={() => media.seek(media.time - 10)}>
            <RotateCcw className="h-4 w-4" />
          </IconButton>
          <button
            type="button"
            onClick={media.toggle}
            aria-label={media.playing ? "Pause" : "Play"}
            className="grid h-10 w-10 place-items-center rounded-full bg-stone-900 text-white transition-colors hover:bg-stone-700"
          >
            {media.loading && media.playing ? <Spinner /> : media.playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
          </button>
          <IconButton label="Forward 10 seconds" onClick={() => media.seek(media.time + 10)}>
            <RotateCw className="h-4 w-4" />
          </IconButton>
          <span className="ml-2 tabular-nums text-xs text-stone-500">
            <span className="text-stone-900">{fmtTime(media.time)}</span> / {fmtTime(media.duration)}
          </span>
          {media.range && <span className="ml-2 rounded-md bg-orange-50 px-1.5 py-0.5 text-xs text-orange-700">Playing section · stops at {fmtTime(media.range.end)}</span>}
          <div className="ml-auto flex items-center gap-2">
            <Segmented value={String(rate)} onChange={(v) => onRate(Number(v))} options={RATES.map((r) => ({ value: String(r), label: `${r}×`, title: `Play at ${r}× speed` }))} />
            {hasVideo && (
              <Segmented
                value={showVideo ? "video" : "audio"}
                onChange={onMode}
                options={[
                  { value: "audio", label: <><Headphones className="h-3.5 w-3.5" />Audio</> },
                  { value: "video", label: <><Film className="h-3.5 w-3.5" />Video</> },
                ]}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** whole-class bar: story sections, playhead, click to seek */
function Timeline({ media, stories, openId, onOpenStory }: { media: Media; stories: Story[]; openId: string | null; onOpenStory: (id: string) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const d = media.duration || 1;
  const at = (e: React.PointerEvent) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * d;
  };
  return (
    <div
      ref={bar}
      className="group relative h-8 cursor-pointer select-none"
      onPointerMove={(e) => setHover(at(e))}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => media.seek(at(e as unknown as React.PointerEvent))}
    >
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-stone-200" />
      <div className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-stone-400" style={{ width: `${(media.time / d) * 100}%` }} />
      {stories.map((s) => (
        <button
          key={s.id}
          type="button"
          title={`${s.title || "Untitled story"} · ${fmtTime(s.start)}–${fmtTime(s.end)}`}
          onClick={(e) => (e.stopPropagation(), onOpenStory(s.id))}
          className={cx("absolute top-1/2 h-4 -translate-y-1/2 rounded-sm transition-all hover:h-6", STORY_COLORS[s.status], s.id === openId && "h-6 ring-2 ring-stone-900 ring-offset-1")}
          style={{ left: `${(s.start / d) * 100}%`, width: `max(4px, ${((s.end - s.start) / d) * 100}%)` }}
        />
      ))}
      <div className="pointer-events-none absolute top-0 h-full w-0.5 -translate-x-1/2 rounded bg-stone-900" style={{ left: `${(media.time / d) * 100}%` }} />
      {hover != null && (
        // below the bar (above it would be clipped by the player's rounded box) and slid inwards near the ends
        <div className="pointer-events-none absolute top-full z-10 rounded bg-stone-900 px-1.5 py-0.5 text-[11px] tabular-nums text-white opacity-0 group-hover:opacity-100" style={{ left: `${(hover / d) * 100}%`, transform: `translateX(-${(hover / d) * 100}%)` }}>
          {fmtTime(hover)}
        </div>
      )}
    </div>
  );
}
