"use client";

import { Check, ChevronDown, Crosshair, Pause, Pencil, Play, RotateCcw, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fmtTime, parseTime } from "@/lib/transcript";
import type { Story, Word } from "@/lib/types";
import { Button, cx, IconButton, Pill } from "../ui";
import { STORY_COLORS } from "./player";
import { StoryTranscript, textBetween } from "./transcript";
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
  const playingThis = media.range && Math.abs(media.range.start - s.start) < 0.05 && media.playing;
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
          onClick={() => (playingThis ? media.pause() : media.playRange(s.start, s.end))}
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
  const [showSummary, setShowSummary] = useState(!!s.summary && s.origin === "ai");
  const max = media.duration || Infinity;
  const clamp = (v: number) => Math.max(0, Math.min(max, Math.round(v * 10) / 10));
  const setStart = (v: number) => set({ start: Math.min(clamp(v), s.end - 1) });
  const setEnd = (v: number) => set({ end: Math.max(clamp(v), s.start + 1) });
  const aiChanged = s.ai && (Math.abs(s.ai.start - s.start) > 0.05 || Math.abs(s.ai.end - s.end) > 0.05);

  return (
    <div className="space-y-5 border-t border-stone-100 px-4 pb-4 pt-4">
      {/* timing */}
      <section className="space-y-3">
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
        {showSummary ? (
          <Field label="Summary">
            <textarea value={s.summary} onChange={(e) => set({ summary: e.target.value })} rows={5} placeholder="One or two sentences" className="input h-auto min-h-28 resize-y py-2 leading-relaxed" />
          </Field>
        ) : (
          <button type="button" onClick={() => setShowSummary(true)} className="text-xs text-stone-500 hover:text-stone-900">
            + Add a summary
          </button>
        )}
      </section>

      {/* transcript */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Transcript</h4>
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
                }}
                icon={<Pencil className="h-3 w-3" />}
              >
                {editingText ? "Done editing" : "Edit text"}
              </Button>
            )}
          </div>
        </div>
        <div className="scroll-thin max-h-72 overflow-y-auto rounded-lg bg-stone-50 p-3">
          {editingText ? (
            <textarea value={s.transcriptOverride ?? ""} onChange={(e) => set({ transcriptOverride: e.target.value })} rows={8} className="input h-auto w-full resize-y bg-white py-2 font-deva leading-relaxed" />
          ) : s.transcriptOverride != null ? (
            <p className="whitespace-pre-wrap font-deva leading-relaxed text-stone-800">{s.transcriptOverride}</p>
          ) : words ? (
            <>
              <StoryTranscript words={words} start={s.start} end={s.end} time={media.time} rohit={rohit} onSeek={(t) => media.seek(t, true)} />
              <p className="mt-3 text-[11px] text-stone-400">Faded text is just outside the story. Click any word to jump there, then use “Set to playhead”.</p>
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
