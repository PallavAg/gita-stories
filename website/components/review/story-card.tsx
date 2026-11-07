"use client";

import { ArrowLeftToLine, ArrowRightToLine, Check, ChevronDown, ChevronRight, Crosshair, Pause, Pencil, Play, RotateCcw, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/lib/client/toast";
import { fmtTime, parseTime } from "@/lib/transcript";
import type { Story, Word } from "@/lib/types";
import { Button, cx, IconButton, Pill } from "../ui";
import { STORY_COLORS } from "./player";
import { MARK_COLORS, StoryTranscript, textBetween } from "./transcript";
import type { Media } from "./use-media";

export type Draft = Story & { isNew?: boolean };

const STATUS_PILL = { suggested: <Pill color="amber">To review</Pill>, approved: <Pill color="green">Approved</Pill>, rejected: <Pill>Rejected</Pill> };

export function shloka(s: Pick<Story, "chapter" | "verse">) {
  return s.chapter || s.verse ? `${s.chapter || "?"}.${s.verse || "?"}` : null;
}

export function StoryCard({
  story,
  draft,
  open,
  words,
  rohit,
  media,
  saving,
  onToggle,
  onChange,
  onSave,
  onDiscard,
  onDelete,
  canUndo,
  onUndo,
}: {
  story: Story | null;
  draft: Draft | null;
  open: boolean;
  words: Word[] | null;
  rohit: number[];
  media: Media;
  saving: boolean;
  onToggle: () => void;
  onChange: (d: Draft) => void;
  onSave: (d: Draft, status?: Story["status"]) => void;
  onDiscard: () => void;
  onDelete: () => void;
  canUndo: boolean;
  onUndo: () => void;
}) {
  const s = (draft ?? story)!;
  const dirty = !!draft;
  // this story's section is loaded in the player (playing or paused partway); seeking inside the story keeps it
  const inRange = !!media.range && Math.abs(media.range.end - s.end) < 0.05 && media.range.start >= s.start - 0.05 && media.range.start < s.end;
  const playingThis = inRange && media.playing;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open]);
  const set = (patch: Partial<Draft>) => onChange({ ...s, ...patch });

  return (
    <div ref={ref} className={cx("overflow-hidden rounded-xl border bg-white transition-shadow", open ? "border-stone-300 shadow-md" : "border-stone-200", s.status === "rejected" && !open && "opacity-60")}>
      {/* summary row: always visible */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          onClick={() => (playingThis ? media.pause() : inRange ? media.play() : media.playRange(s.start, s.end))}
          aria-label={playingThis ? "Pause" : "Play this story"}
          className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-full text-white", playingThis ? "bg-orange-500" : "bg-stone-800 hover:bg-stone-600")}
        >
          {playingThis ? <Pause className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
        </button>
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className={cx("h-2 w-2 shrink-0 rounded-full", STORY_COLORS[s.status])} />
          <span className="min-w-0 flex-1">
            <span className={cx("block truncate font-medium", s.status === "rejected" && "line-through decoration-stone-300")}>{s.title || "Untitled story"}</span>
            <span className="block text-xs tabular-nums text-stone-500">
              {fmtTime(s.start)} – {fmtTime(s.end)} · {fmtTime(s.end - s.start)}
              {shloka(s) && <> · Shloka {shloka(s)}</>}
              {s.origin === "manual" && <> · added by you</>}
            </span>
          </span>
          {dirty && <Pill color="orange">Unsaved</Pill>}
          {!open && STATUS_PILL[s.status]}
          <ChevronDown className={cx("h-4 w-4 shrink-0 text-stone-400 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {inRange && <StoryProgress start={s.start} end={s.end} media={media} />}

      {open && (
        <Editor
          s={s}
          dirty={dirty}
          words={words}
          rohit={rohit}
          media={media}
          saving={saving}
          set={set}
          onSave={onSave}
          onDiscard={onDiscard}
          onDelete={onDelete}
          canUndo={canUndo}
          onUndo={onUndo}
        />
      )}
    </div>
  );
}

function Editor({ s, dirty, words, rohit, media, saving, set, onSave, onDiscard, onDelete, canUndo, onUndo }: { s: Draft; dirty: boolean; words: Word[] | null; rohit: number[]; media: Media; saving: boolean; set: (p: Partial<Draft>) => void; onSave: (d: Draft, status?: Story["status"]) => void; onDiscard: () => void; onDelete: () => void; canUndo: boolean; onUndo: () => void }) {
  const [editingText, setEditingText] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [showTimes, setShowTimes] = useState(false);
  const [marking, setMarking] = useState<"start" | "end" | null>(null);
  const max = media.duration || Infinity;
  const clamp = (v: number) => Math.max(0, Math.min(max, Math.round(v * 10) / 10));
  const setStart = (v: number) => set({ start: Math.min(clamp(v), s.end - 1) });
  const setEnd = (v: number) => set({ end: Math.max(clamp(v), s.start + 1) });
  const aiChanged = s.ai && (Math.abs(s.ai.start - s.start) > 0.05 || Math.abs(s.ai.end - s.end) > 0.05);
  const canMark = !!words && !editingText && s.transcriptOverride == null;

  const mark = (t: number) => {
    const v = clamp(t);
    if (marking === "start" && v >= s.end) return toast("That word is after the story’s end. Mark the end first to move the story later.", "error");
    if (marking === "end" && v <= s.start) return toast("That word is before the story’s start. Mark the start first to move the story earlier.", "error");
    set(marking === "start" ? { start: v } : { end: v });
    setMarking(null);
  };
  // Esc cancels marking instead of closing the story
  useEffect(() => {
    if (!marking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      setMarking(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [marking]);

  return (
    <div className="space-y-5 border-t border-stone-100 px-4 pb-4 pt-4">
      {/* timing */}
      <section>
        <Disclosure open={showTimes} onToggle={() => setShowTimes(!showTimes)} label="Timing controls" preview={`${fmtTime(s.start, true)} – ${fmtTime(s.end, true)}`} />
        {showTimes && (
          <div className="mt-3 space-y-3">
            <RangeEditor s={s} media={media} setStart={setStart} setEnd={setEnd} />
            <div className="grid gap-3 sm:grid-cols-2">
              <TimeControl label="Start" value={s.start} onChange={setStart} media={media} onPreview={() => media.playRange(s.start, Math.min(s.start + 6, s.end))} previewLabel="Play first 6s" />
              <TimeControl label="End" value={s.end} onChange={setEnd} media={media} onPreview={() => media.playRange(Math.max(s.start, s.end - 6), s.end)} previewLabel="Play last 6s" />
            </div>
            {aiChanged && (
              <p className="flex items-center gap-2 text-xs text-stone-500">
                AI suggested {fmtTime(s.ai!.start)} – {fmtTime(s.ai!.end)}
                <button type="button" className="inline-flex items-center gap-1 text-stone-600 underline-offset-2 hover:underline" onClick={() => set({ start: s.ai!.start, end: s.ai!.end })}>
                  <RotateCcw className="h-3 w-3" />
                  reset times
                </button>
              </p>
            )}
          </div>
        )}
      </section>

      {/* details */}
      <section className="space-y-3">
        <Field label="Title">
          <input value={s.title} onChange={(e) => set({ title: e.target.value })} placeholder="Short title for this story" className="input" />
        </Field>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Chapter" className="w-24">
            <input value={s.chapter} onChange={(e) => set({ chapter: e.target.value })} placeholder="2" inputMode="numeric" className="input" />
          </Field>
          <Field label="Shloka (verse)" className="w-32">
            <input value={s.verse} onChange={(e) => set({ verse: e.target.value })} placeholder="60" className="input" />
          </Field>
          {s.ai?.evidence && (
            <p className="min-w-0 flex-1 pb-2 text-xs text-stone-500">
              <span className="text-stone-400">AI found it from:</span> <span className="font-deva text-stone-600">“{s.ai.evidence}”</span>
            </p>
          )}
        </div>
        <div>
          <Disclosure open={showSummary} onToggle={() => setShowSummary(!showSummary)} label="Summary" preview={s.summary || "None yet"} />
          {showSummary && (
            <textarea value={s.summary} onChange={(e) => set({ summary: e.target.value })} rows={5} placeholder="One or two sentences" aria-label="Summary" className="input mt-2 h-auto min-h-28 resize-y py-2 leading-relaxed" />
          )}
        </div>
      </section>

      {/* transcript */}
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Transcript</h4>
          {canMark &&
            (["start", "end"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setMarking(marking === k ? null : k)}
                aria-pressed={marking === k}
                title={marking === k ? "Cancel (Esc)" : `Then click the word where the story ${k === "start" ? "starts" : "ends"}`}
                className={cx("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors", marking === k ? MARK_COLORS[k].armed : MARK_COLORS[k].button)}
              >
                {k === "start" ? <ArrowRightToLine className="h-3 w-3" /> : <ArrowLeftToLine className="h-3 w-3" />}
                {marking === k ? `Click the ${k === "start" ? "first" : "last"} word…` : k === "start" ? "Mark start" : "Mark end"}
              </button>
            ))}
          {s.transcriptOverride != null && <Pill color="blue">Edited</Pill>}
          <div className="ml-auto flex gap-1">
            {s.transcriptOverride != null && !editingText && (
              <Button size="sm" variant="ghost" onClick={() => set({ transcriptOverride: null })} icon={<Undo2 className="h-3 w-3" />}>
                Use machine transcript
              </Button>
            )}
            {words && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (!editingText && s.transcriptOverride == null) set({ transcriptOverride: textBetween(words, s.start, s.end) });
                  setEditingText(!editingText);
                  setMarking(null);
                }}
                icon={<Pencil className="h-3 w-3" />}
              >
                {editingText ? "Done editing" : "Edit text"}
              </Button>
            )}
          </div>
        </div>
        <div className={cx("scroll-thin max-h-[min(40rem,70vh)] overflow-y-auto rounded-lg bg-stone-50 p-4", marking && cx("ring-2", MARK_COLORS[marking].ring))}>
          {editingText ? (
            <textarea value={s.transcriptOverride ?? ""} onChange={(e) => set({ transcriptOverride: e.target.value })} rows={14} className="input h-auto w-full resize-y bg-white py-2 font-deva text-[17px] leading-relaxed" />
          ) : s.transcriptOverride != null ? (
            <p className="whitespace-pre-wrap font-deva text-[17px] leading-relaxed text-stone-800">{s.transcriptOverride}</p>
          ) : words ? (
            <>
              <StoryTranscript words={words} start={s.start} end={s.end} time={media.time} rohit={rohit} onSeek={(t) => media.seek(t, true)} marking={marking} onMark={mark} />
              <p className={cx("mt-3 text-[11px]", marking ? MARK_COLORS[marking].text : "text-stone-400")}>
                {marking
                  ? `Click the ${marking === "start" ? "first" : "last"} word of the story. Esc to cancel.`
                  : "Faded text is just outside the story. Click any word to play from there, or use Mark start / Mark end and then click a word."}
              </p>
            </>
          ) : (
            <p className="text-stone-400">No transcript yet — run the AI on this class to get one.</p>
          )}
        </div>
      </section>

      {/* actions */}
      <section className="flex flex-wrap items-center gap-2 border-t border-stone-100 pt-4">
        {s.origin === "manual" ? (
          <Button variant="ghost" size="sm" onClick={onDelete} icon={<Trash2 className="h-3.5 w-3.5" />} className="text-red-600 hover:bg-red-50 hover:text-red-700">
            {s.isNew ? "Discard" : "Delete"}
          </Button>
        ) : s.status === "rejected" ? (
          <Button variant="secondary" size="sm" loading={saving} onClick={() => onSave(s, "suggested")} icon={<Undo2 className="h-3.5 w-3.5" />}>
            Restore
          </Button>
        ) : (
          <Button variant="danger" size="sm" loading={saving} onClick={() => onSave(s, "rejected")} icon={<X className="h-3.5 w-3.5" />} title="Not a story — hide it and stop the AI suggesting it again">
            Not a story
          </Button>
        )}
        {s.status === "approved" && (
          <Button variant="ghost" size="sm" loading={saving} onClick={() => onSave(s, "suggested")} icon={<Undo2 className="h-3.5 w-3.5" />} title="Move back to “to review”">
            Undo approval
          </Button>
        )}
        {(canUndo || dirty) && (
          <Button variant="ghost" size="sm" onClick={onUndo} disabled={!canUndo} icon={<RotateCcw className="h-3.5 w-3.5" />} title="Undo the last change (⌘Z)">
            Undo
          </Button>
        )}
        {dirty && !s.isNew && (
          <Button variant="ghost" size="sm" onClick={onDiscard}>
            Discard changes
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          {(dirty || s.status !== "suggested") && (
            <Button variant="secondary" loading={saving} onClick={() => onSave(s)} disabled={!dirty} title="⌘S">
              Save
            </Button>
          )}
          {s.status !== "approved" && s.status !== "rejected" && (
            <Button variant="success" loading={saving} onClick={() => onSave(s, "approved")} icon={<Check className="h-4 w-4" />} title="Save and mark as reviewed (⌘↵)">
              {dirty ? "Save & approve" : "Approve"}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

/** how far through the story playback is; click to jump within the story (it still stops at the story's end) */
function StoryProgress({ start, end, media }: { start: number; end: number; media: Media }) {
  const bar = useRef<HTMLDivElement>(null);
  const length = end - start;
  const elapsed = Math.min(length, Math.max(0, media.time - start));
  const jump = (e: React.MouseEvent) => {
    const r = bar.current!.getBoundingClientRect();
    media.playRange(start + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * length, end);
  };
  return (
    <div className="flex items-center gap-2 px-3 pb-2.5 text-[11px] tabular-nums text-stone-500">
      <span className="w-10 text-right">{fmtTime(elapsed)}</span>
      <div ref={bar} onClick={jump} title="Jump within the story" className="group relative flex h-4 flex-1 cursor-pointer items-center">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200 transition-[height] group-hover:h-2">
          <div className="h-full rounded-full bg-orange-500" style={{ width: `${(elapsed / length) * 100}%` }} />
        </div>
      </div>
      <span className="w-10">−{fmtTime(length - elapsed)}</span>
    </div>
  );
}

function Disclosure({ open, onToggle, label, preview }: { open: boolean; onToggle: () => void; label: string; preview: string }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full min-w-0 items-center gap-1.5 text-left text-xs text-stone-500 hover:text-stone-900">
      <ChevronRight className={cx("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-90")} />
      <span className="shrink-0 font-medium">{label}</span>
      {!open && <span className="min-w-0 truncate text-stone-400">{preview}</span>}
    </button>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-xs font-medium text-stone-500">{label}</span>
      {children}
    </label>
  );
}

function TimeControl({ label, value, onChange, media, onPreview, previewLabel }: { label: string; value: number; onChange: (v: number) => void; media: Media; onPreview: () => void; previewLabel: string }) {
  const [text, setText] = useState(fmtTime(value, true));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : fmtTime(value, true);
  const commit = () => {
    const t = parseTime(text);
    if (t != null) onChange(t);
    setFocused(false);
  };
  const nudge = (d: number) => onChange(value + d);
  return (
    <div className="rounded-lg border border-stone-200 p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-stone-500">{label}</span>
        <button type="button" onClick={onPreview} className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-900">
          <Play className="h-3 w-3" />
          {previewLabel}
        </button>
      </div>
      <div className="flex items-center gap-1">
        <NudgeButton onClick={() => nudge(-5)}>−5</NudgeButton>
        <NudgeButton onClick={() => nudge(-1)}>−1</NudgeButton>
        <input
          value={shown}
          onFocus={() => (setText(fmtTime(value, true)), setFocused(true))}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          aria-label={`${label} time`}
          className={cx("h-8 w-full min-w-0 rounded-md border bg-white px-2 text-center text-sm tabular-nums outline-none focus:border-stone-400", focused && parseTime(text) == null ? "border-red-300" : "border-stone-200")}
        />
        <NudgeButton onClick={() => nudge(1)}>+1</NudgeButton>
        <NudgeButton onClick={() => nudge(5)}>+5</NudgeButton>
        <IconButton label={`Set ${label.toLowerCase()} to the playhead (${fmtTime(media.time, true)}) — shortcut ${label === "Start" ? "[" : "]"}`} onClick={() => onChange(media.time)} className="text-orange-600 hover:bg-orange-50 hover:text-orange-700">
          <Crosshair className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}

function NudgeButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="h-8 shrink-0 rounded-md px-1.5 text-xs tabular-nums text-stone-500 hover:bg-stone-100 hover:text-stone-900">
      {children}
    </button>
  );
}

/** zoomed bar around the story with draggable start/end handles; click to seek */
function RangeEditor({ s, media, setStart, setEnd }: { s: Draft; media: Media; setStart: (v: number) => void; setEnd: (v: number) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const pad = 30; // seconds shown either side of the story on the zoomed bar
  // freeze the window while dragging so the bar doesn't move under the pointer
  const [frozen, setFrozen] = useState<[number, number] | null>(null);
  const [w0, w1] = frozen ?? [Math.max(0, s.start - pad), Math.min(media.duration || s.end + pad, s.end + pad)];
  const pct = (t: number) => `${((t - w0) / (w1 - w0)) * 100}%`;
  const timeAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return w0 + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (w1 - w0);
  };
  const drag = (which: "start" | "end") => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setFrozen([w0, w1]);
    const move = (ev: PointerEvent) => (which === "start" ? setStart : setEnd)(timeAt(ev.clientX));
    const up = () => {
      setFrozen(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const inWindow = media.time >= w0 && media.time <= w1;
  return (
    <div>
      <div ref={bar} onClick={(e) => media.seek(timeAt(e.clientX))} className="relative h-10 cursor-pointer select-none rounded-lg bg-stone-100">
        <div className="absolute inset-y-0 bg-orange-100" style={{ left: pct(s.start), width: `calc(${pct(s.end)} - ${pct(s.start)})` }} />
        {(["start", "end"] as const).map((k) => (
          <div
            key={k}
            onPointerDown={drag(k)}
            onClick={(e) => e.stopPropagation()}
            title={`Drag to move the ${k}`}
            className="absolute inset-y-0 z-10 flex w-4 -translate-x-1/2 cursor-ew-resize items-center justify-center"
            style={{ left: pct(s[k]) }}
          >
            <div className="h-full w-1.5 rounded-full bg-orange-500 shadow" />
          </div>
        ))}
        {inWindow && <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-stone-900" style={{ left: pct(media.time) }} />}
      </div>
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-stone-400">
        <span>{fmtTime(w0)}</span>
        <span>Drag the orange handles, or click to move the playhead</span>
        <span>{fmtTime(w1)}</span>
      </div>
    </div>
  );
}
