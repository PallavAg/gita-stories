"use client";

import { ArrowLeft, ChevronDown, Keyboard, Plus, RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { estimateCost, fmtUsd, isActive, jobAction, useJobs } from "@/lib/client/jobs";
import { usePref } from "@/lib/client/prefs";
import { toast } from "@/lib/client/toast";
import { fmtDuration, fmtTime } from "@/lib/transcript";
import type { ClassDetail, Job, Story } from "@/lib/types";
import { ClassStatusPill, JobProgress } from "../status";
import { Button, cx, ErrorBox, Segmented, Spinner } from "../ui";
import { Player } from "./player";
import { type Draft, StoryCard } from "./story-card";
import { FullTranscript } from "./transcript";
import { useMedia } from "./use-media";

const COLLECTION_LABEL = { sunday: "Sunday Family Class", saturday: "Saturday Gita Class", chapters: "Gita by Chapter" };

export function ClassReview({ id }: { id: string }) {
  const [detail, setDetail] = useState<ClassDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [tab, setTab] = useState<"stories" | "transcript">("stories");
  const [showRejected, setShowRejected] = usePref("showRejected");
  const [mode, setMode] = usePref("mediaMode");
  const [rate, setRate] = usePref("playbackRate");

  const [nonce, setNonce] = useState(0);
  const load = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    api<ClassDetail>(`/api/class?id=${encodeURIComponent(id)}`).then(
      (d) => live && (setDetail(d), setLoadError(null)),
      (err) => live && setLoadError((err as Error).message),
    );
    return () => {
      live = false;
    };
  }, [id, nonce]);

  const hasVideo = !!detail?.info.hasVideo;
  const kind = mode === "video" && hasVideo ? "video" : "audio";
  const src = `/api/media?id=${encodeURIComponent(id)}&kind=${kind}`;
  const [attachMedia, media] = useMedia(src, rate);

  // AI job for this class: show progress, reload when it finishes
  const jobs = useJobs();
  const job: Job | null = useMemo(() => jobs?.jobs.find((j) => j.classId === id) ?? null, [jobs, id]);
  const running = !!job && isActive(job);
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) {
      load();
      if (job?.status === "done") toast(`AI finished: ${job.result?.added ?? 0} new ${job.result?.added === 1 ? "story" : "stories"} to review`, "success");
    }
    wasRunning.current = running;
  }, [running, job, load]);

  const stories = useMemo(() => {
    const saved = detail?.record.stories ?? [];
    const fresh = Object.values(drafts).filter((d) => d.isNew);
    return [...saved, ...fresh].sort((a, b) => a.start - b.start);
  }, [detail, drafts]);
  const visible = stories.filter((s) => s.status !== "rejected" || showRejected || s.id === openId || drafts[s.id]);
  const rejectedCount = stories.filter((s) => s.status === "rejected").length;
  const dirtyCount = Object.keys(drafts).length;

  // warn before leaving with unsaved edits
  useEffect(() => {
    if (!dirtyCount) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirtyCount]);

  const change = useCallback((d: Draft) => setDrafts((all) => ({ ...all, [d.id]: d })), []);
  const discard = (sid: string) =>
    setDrafts((all) => {
      const rest = { ...all };
      delete rest[sid];
      return rest;
    });

  const nextToReview = (after: Story) => stories.find((s) => s.status === "suggested" && s.id !== after.id && s.start > after.start) ?? stories.find((s) => s.status === "suggested" && s.id !== after.id);

  const save = async (d: Draft, status?: Story["status"]) => {
    setSaving(d.id);
    try {
      const body = { classId: id, story: { ...d, id: d.isNew ? undefined : d.id, status: status ?? d.status } };
      const { story } = await api<{ story: Story }>("/api/class/story", { body });
      setDetail((cur) => cur && { ...cur, record: { ...cur.record, stories: [...cur.record.stories.filter((s) => s.id !== story.id), story].sort((a, b) => a.start - b.start) } });
      discard(d.id);
      if (status === "approved" || status === "rejected") {
        toast(status === "approved" ? `Approved “${story.title || "Untitled story"}”` : "Marked as not a story", "success");
        const next = nextToReview(d);
        setOpenId(next?.id ?? null);
      } else {
        toast("Saved", "success");
        if (d.isNew) setOpenId(story.id);
      }
    } catch (err) {
      toast(`Couldn't save: ${(err as Error).message}`, "error");
    } finally {
      setSaving(null);
    }
  };

  const remove = async (s: Draft) => {
    if (s.isNew) return discard(s.id), setOpenId(null);
    if (!confirm(`Delete “${s.title || "Untitled story"}”? This can't be undone.`)) return;
    try {
      await api(`/api/class/story?classId=${encodeURIComponent(id)}&storyId=${s.id}`, { method: "DELETE" });
      discard(s.id);
      setDetail((cur) => cur && { ...cur, record: { ...cur.record, stories: cur.record.stories.filter((x) => x.id !== s.id) } });
      setOpenId(null);
      toast("Deleted", "success");
    } catch (err) {
      toast(`Couldn't delete: ${(err as Error).message}`, "error");
    }
  };

  const addStory = useCallback(
    (at: number) => {
      const now = new Date().toISOString();
      const d: Draft = { id: `new-${Date.now()}`, isNew: true, start: Math.round(at * 10) / 10, end: Math.round((at + 60) * 10) / 10, title: "", chapter: "", verse: "", summary: "", transcriptOverride: null, status: "suggested", origin: "manual", ai: null, createdAt: now, updatedAt: now };
      setDrafts((all) => ({ ...all, [d.id]: d }));
      setOpenId(d.id);
      setTab("stories");
    },
    [],
  );
  const openStory = useCallback((sid: string) => {
    setOpenId(sid);
    setTab("stories");
  }, []);
  const { seek } = media;
  const seekAndPlay = useCallback((t: number) => seek(t, true), [seek]);

  // keyboard: space play/pause, [ ] set start/end to playhead, ⌘S save, ⌘↵ approve, esc close
  const openStoryObj = stories.find((s) => s.id === openId) ?? null;
  const openDraft = openId ? (drafts[openId] ?? openStoryObj) : null;
  const keyState = useRef({ openDraft, media, save, change });
  useLayoutEffect(() => {
    keyState.current = { openDraft, media, save, change };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { openDraft: d, media: m, save: sv, change: ch } = keyState.current;
      const typing = e.target instanceof HTMLElement && (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) || e.target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (d) sv(d);
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && d) {
        e.preventDefault();
        sv(d, "approved");
      } else if (typing) return;
      else if (e.key === " " && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        m.toggle();
      } else if (e.key === "[" && d) ch({ ...d, start: Math.min(Math.round(m.time * 10) / 10, d.end - 1) });
      else if (e.key === "]" && d) ch({ ...d, end: Math.max(Math.round(m.time * 10) / 10, d.start + 1) });
      else if (e.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (loadError)
    return (
      <main className="mx-auto max-w-3xl p-6">
        <ErrorBox title="Couldn't open this class" message={loadError} action={<div className="flex gap-2"><Button onClick={load} icon={<RefreshCw className="h-4 w-4" />}>Try again</Button><Link href="/"><Button variant="ghost">Back to library</Button></Link></div>} />
      </main>
    );
  if (!detail)
    return (
      <main className="mx-auto flex max-w-7xl items-center gap-2 p-6 text-stone-500">
        <Spinner /> Loading class…
      </main>
    );

  const { info, record, words, rohitSpeakers } = detail;
  const processed = !!record.ai || stories.length > 0;

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <Link href="/" className="mt-0.5 grid h-8 w-8 place-items-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-900" aria-label="Back to library">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-stone-500">
            {COLLECTION_LABEL[info.collection]}
            {info.group && <> · {info.group}</>}
            {info.number != null && <> · #{info.number}</>} · {fmtDuration(info.duration)}
          </p>
          <h1 className="text-lg font-semibold tracking-tight">{info.title}</h1>
        </div>
        <ClassStatusPill info={{ ...info, counts: { suggested: stories.filter((s) => s.status === "suggested").length, approved: stories.filter((s) => s.status === "approved").length, rejected: rejectedCount }, status: !processed ? info.status : stories.some((s) => s.status === "suggested") ? "review" : "reviewed" }} job={running ? job : null} />
        {processed && !running && <RerunMenu id={id} duration={info.duration} transcribed={!!words} />}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="lg:sticky lg:top-20 lg:self-start">
          <Player
            attach={attachMedia}
            media={media}
            src={src}
            mode={kind}
            hasVideo={hasVideo}
            onMode={(m) => (media.keepPosition(), setMode(m))}
            rate={rate}
            onRate={setRate}
            stories={visible}
            openId={openId}
            onOpenStory={openStory}
          />
          <p className="mt-2 hidden items-center gap-1.5 text-[11px] text-stone-400 lg:flex">
            <Keyboard className="h-3 w-3" /> Space play/pause · [ ] set start/end to playhead · ⌘S save · ⌘↵ approve · Esc close
          </p>
        </div>

        <div className="min-w-0">
          {running && job && (
            <div className="mb-4 rounded-xl border border-orange-200 bg-orange-50/50 p-4">
              <p className="mb-3 flex items-center gap-2 font-medium">
                <Sparkles className="h-4 w-4 text-orange-500" />
                Finding stories with AI
              </p>
              <JobProgress job={job} />
            </div>
          )}
          {!running && job?.status === "failed" && (
            <div className="mb-4">
              <ErrorBox
                title={`The last AI run failed while ${job.errorStep === "finding" ? "finding stories" : job.errorStep === "filling" ? "filling transcript gaps" : "transcribing"}`}
                message={job.error ?? "Unknown error"}
                action={<Button size="sm" onClick={() => jobAction({ action: "retry", jobId: job.id }).catch((e) => toast(e.message, "error"))} icon={<RefreshCw className="h-3.5 w-3.5" />}>Retry</Button>}
              />
            </div>
          )}

          {!processed && !running ? (
            <EmptyState id={id} duration={info.duration} transcribed={!!words} onAdd={() => addStory(media.time)} />
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2">
                <Segmented value={tab} onChange={setTab} options={[{ value: "stories", label: <>Stories <span className="text-stone-400">{stories.length - rejectedCount}</span></> }, { value: "transcript", label: "Full transcript", disabled: !words }]} />
                {tab === "stories" && (
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => addStory(media.time)} icon={<Plus className="h-3.5 w-3.5" />} title="Add a story starting at the playhead">
                    Add story at {fmtTime(media.time)}
                  </Button>
                )}
              </div>
              {tab === "stories" ? (
                <div className="space-y-2">
                  {visible.length === 0 && (
                    <div className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-stone-500">
                      The AI didn’t find any stories in this class. If you hear one, add it with “Add story” or from the full transcript.
                    </div>
                  )}
                  {visible.map((s) => (
                    <StoryCard
                      key={s.id}
                      story={s.id.startsWith("new-") ? null : s}
                      draft={drafts[s.id] ?? null}
                      open={openId === s.id}
                      words={words}
                      rohit={rohitSpeakers}
                      media={media}
                      saving={saving === s.id}
                      onToggle={() => setOpenId(openId === s.id ? null : s.id)}
                      onChange={change}
                      onSave={save}
                      onDiscard={() => discard(s.id)}
                      onDelete={() => remove(drafts[s.id] ?? s)}
                    />
                  ))}
                  {rejectedCount > 0 && (
                    <button type="button" onClick={() => setShowRejected(!showRejected)} className="flex w-full items-center justify-center gap-1 py-2 text-xs text-stone-500 hover:text-stone-900">
                      <ChevronDown className={cx("h-3.5 w-3.5 transition-transform", showRejected && "rotate-180")} />
                      {showRejected ? "Hide" : "Show"} {rejectedCount} marked “not a story”
                    </button>
                  )}
                </div>
              ) : (
                words && (
                  <div className="scroll-thin max-h-[calc(100vh-11rem)] overflow-y-auto rounded-xl border border-stone-200 bg-white">
                    <FullTranscript words={words} stories={visible} rohit={rohitSpeakers} time={media.time} onSeek={seekAndPlay} onNewStory={addStory} onOpenStory={openStory} />
                  </div>
                )
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function EmptyState({ id, duration, transcribed, onAdd }: { id: string; duration: number | null; transcribed: boolean; onAdd: () => void }) {
  const [busy, setBusy] = useState(false);
  const mode = transcribed ? "stories" : "full";
  const run = async () => {
    setBusy(true);
    try {
      await jobAction({ action: "enqueue", classIds: [id], mode });
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-8 text-center">
      <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-orange-50 text-orange-500">
        <Sparkles className="h-5 w-5" />
      </div>
      <h2 className="font-semibold">No stories yet</h2>
      <p className="mx-auto mt-1 max-w-sm text-stone-500">
        {transcribed ? "This class is transcribed. Let Grok find the stories in it" : "Transcribe this class and let Grok find the stories Rohit tells"} — usually a few minutes, about {fmtUsd(estimateCost(duration, mode))}.
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <Button variant="primary" loading={busy} onClick={run} icon={<Sparkles className="h-4 w-4" />}>
          Find stories with AI
        </Button>
        <Button variant="ghost" onClick={onAdd} icon={<Plus className="h-4 w-4" />}>
          Add one by hand
        </Button>
      </div>
    </div>
  );
}

function RerunMenu({ id, duration, transcribed }: { id: string; duration: number | null; transcribed: boolean }) {
  const [open, setOpen] = useState(false);
  const run = async (mode: "full" | "stories") => {
    setOpen(false);
    try {
      await jobAction({ action: "enqueue", classIds: [id], mode });
      toast("AI run started — your approved, rejected and hand-added stories are kept", "info");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };
  return (
    <div className="relative">
      <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} icon={<Sparkles className="h-3.5 w-3.5" />}>
        Re-run AI <ChevronDown className="h-3.5 w-3.5" />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-1 w-72 rounded-xl border border-stone-200 bg-white p-1 shadow-lg">
            {transcribed && (
              <MenuItem onClick={() => run("stories")} title="Find stories again" detail={`Uses the saved transcript and the current prompt · ≈${fmtUsd(estimateCost(duration, "stories"))}`} />
            )}
            <MenuItem onClick={() => run("full")} title="Re-transcribe and find stories" detail={`Starts from the audio again · ≈${fmtUsd(estimateCost(duration, "full"))}`} />
            <p className="px-3 py-2 text-[11px] text-stone-400">Stories you approved, rejected or added are kept. Only unreviewed AI suggestions are replaced.</p>
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ title, detail, onClick }: { title: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-stone-50">
      <span className="block font-medium">{title}</span>
      <span className="block text-xs text-stone-500">{detail}</span>
    </button>
  );
}
