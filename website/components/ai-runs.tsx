"use client";

import { AlertTriangle, ArrowRight, Ban, CheckCircle2, ChevronDown, Circle, CircleSlash, Pause, Play, RefreshCw, Search, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client/api";
import { estimateCost, estimateSeconds, fmtUsd, isActive, jobAction, useJobs } from "@/lib/client/jobs";
import { usePref } from "@/lib/client/prefs";
import { toast } from "@/lib/client/toast";
import { fmtDuration } from "@/lib/transcript";
import type { ClassInfo, Job } from "@/lib/types";
import { useLibrary } from "./library";
import { ClassStatusPill, JobProgress, jobCost, STEP_LABEL } from "./status";
import { Button, cx, ErrorBox, IconButton, Pill, Segmented, Spinner } from "./ui";

type Meta = { prompt: string; promptVersion: number; sttModel: string; llmModel: string; sttUsdPerHour: number };

export function AiRuns() {
  const jobs = useJobs();
  const active = jobs?.jobs.filter(isActive) ?? [];
  const history = jobs?.jobs.filter((j) => !isActive(j)) ?? [];

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">AI runs</h1>
        <p className="mt-1 text-stone-500">Transcribe classes and let Grok find Rohit’s stories. Start with a few, check them in the library, then queue more.</p>
      </div>

      {jobs?.error && <ErrorBox title="Lost contact with the local server" message={jobs.error} />}

      <QueueBar />
      <NewRun />

      {active.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">In progress</h2>
          <div className="space-y-2">
            {active.map((j) => (
              <ActiveJob key={j.id} job={j} />
            ))}
          </div>
        </section>
      )}

      <History jobs={history} />
      <HowItWorks />
    </main>
  );
}

function QueueBar() {
  const jobs = useJobs();
  if (!jobs) return null;
  const running = jobs.jobs.filter((j) => j.status === "running").length;
  const queued = jobs.jobs.filter((j) => j.status === "queued").length;
  const spent = jobs.totals.stt + jobs.totals.llm;
  const act = (body: Record<string, unknown>) => jobAction(body).catch((e) => toast(e.message, "error"));
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-stone-200 bg-white px-4 py-3">
      <Stat label="Running" value={running} />
      <Stat label="Queued" value={queued} />
      <Stat label="Classes done" value={jobs.totals.runs} />
      <Stat label="Spent so far" value={fmtUsd(spent)} hint={`Grok ${fmtUsd(jobs.totals.llm)} (exact) + transcription ${fmtUsd(jobs.totals.stt)} (estimated)`} />
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-stone-500">
          At once
          <select value={jobs.concurrency} onChange={(e) => act({ action: "settings", concurrency: Number(e.target.value) })} className="h-8 rounded-lg border border-stone-200 bg-white px-2 text-sm text-stone-800">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <Button size="sm" onClick={() => act({ action: "settings", paused: !jobs.paused })} icon={jobs.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />} title={jobs.paused ? "Start queued jobs again" : "Finish running jobs but don't start queued ones"}>
          {jobs.paused ? "Resume queue" : "Pause queue"}
        </Button>
        {queued + running > 0 && (
          <Button size="sm" variant="danger" onClick={() => confirm("Cancel all queued and running jobs?") && act({ action: "cancel", jobId: "all" })} icon={<Ban className="h-3.5 w-3.5" />}>
            Cancel all
          </Button>
        )}
      </div>
      {jobs.paused && <p className="w-full text-xs text-amber-700">Queue paused — queued jobs won’t start until you resume.</p>}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div title={hint}>
      <p className="text-[11px] uppercase tracking-wide text-stone-400">{label}</p>
      <p className="text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

const PICK_FILTERS = [
  { value: "new", label: "Not processed" },
  { value: "transcribed", label: "Transcribed only" },
  { value: "done", label: "Already processed" },
  { value: "all", label: "All" },
];

function NewRun() {
  const { collections, error } = useLibrary();
  const jobs = useJobs();
  const [collection, setCollection] = usePref("aiCollection");
  const [filter, setFilter] = usePref("aiFilter");
  const [mode, setMode] = usePref("aiMode");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);

  const busy = useMemo(() => new Set(jobs?.jobs.filter(isActive).map((j) => j.classId)), [jobs]);
  const latest = useMemo(() => {
    const m = new Map<string, Job>();
    for (const j of jobs?.jobs ?? []) if (!m.has(j.classId)) m.set(j.classId, j);
    return m;
  }, [jobs]);
  const all = useMemo(() => collections?.flatMap((c) => c.classes) ?? [], [collections]);
  const current = collections?.find((c) => c.key === collection) ?? collections?.[0];
  const shown = (current?.classes ?? []).filter(
    (c) =>
      (filter === "all" || (filter === "new" ? c.status === "new" : filter === "transcribed" ? c.status === "transcribed" : c.status === "review" || c.status === "reviewed")) &&
      (!q || `${c.number ?? ""} ${c.title} ${c.group ?? ""}`.toLowerCase().includes(q.toLowerCase())),
  );
  const picked = all.filter((c) => selected.has(c.id));
  const modeFor = (c: ClassInfo) => (mode === "stories" && c.transcribed ? "stories" : "full");
  const hours = picked.reduce((t, c) => t + (c.duration ?? 3600), 0) / 3600;
  const cost = picked.reduce((t, c) => t + estimateCost(c.duration, modeFor(c)), 0);
  const conc = jobs?.concurrency ?? 2;
  const minutes = picked.reduce((t, c) => t + estimateSeconds(c.duration, "total", modeFor(c)), 0) / 60 / Math.min(conc, Math.max(1, picked.length));
  const needsTranscript = mode === "stories" ? picked.filter((c) => !c.transcribed).length : 0;
  const big = picked.length > 10 || cost > 5;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const selectable = shown.filter((c) => !busy.has(c.id));
  const allShownSelected = selectable.length > 0 && selectable.every((c) => selected.has(c.id));

  const start = async () => {
    if (big && !confirming) return setConfirming(true);
    setStarting(true);
    try {
      const res = await jobAction({ action: "enqueue", classIds: picked.map((c) => c.id), mode });
      toast(`Queued ${res.created} ${res.created === 1 ? "class" : "classes"}${res.skipped ? ` (${res.skipped} already running)` : ""}`, "success");
      setSelected(new Set());
      setConfirming(false);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setStarting(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-stone-100 px-4 py-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Sparkles className="h-4 w-4 text-orange-500" />
          Start a run
        </h2>
        {collections && current && (
          <Segmented className="ml-auto" value={current.key} onChange={(v) => setCollection(v)} options={collections.map((c) => ({ value: c.key, label: c.label.replace(/ \(.*\)/, "") }))} />
        )}
      </div>

      {error && !collections ? (
        <div className="p-4"><ErrorBox title="Couldn't load the library" message={error} /></div>
      ) : !collections ? (
        <p className="flex items-center gap-2 p-4 text-stone-500"><Spinner />Loading classes…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="input pl-9" />
            </div>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-9 rounded-lg border border-stone-200 bg-white px-2">
              {PICK_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3 border-y border-stone-100 bg-stone-50 px-4 py-1.5 text-xs text-stone-500">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={allShownSelected}
                onChange={() => setSelected((s) => {
                  const n = new Set(s);
                  selectable.forEach((c) => (allShownSelected ? n.delete(c.id) : n.add(c.id)));
                  return n;
                })}
              />
              Select all {selectable.length} shown
            </label>
            {selected.size > 0 && (
              <button type="button" className="ml-auto hover:text-stone-900" onClick={() => setSelected(new Set())}>
                Clear selection ({selected.size})
              </button>
            )}
          </div>
          <div className="scroll-thin max-h-80 overflow-y-auto">
            {shown.length === 0 && <p className="p-6 text-center text-stone-500">Nothing here with this filter.</p>}
            {shown.map((c) => (
              <label key={c.id} className={cx("flex cursor-pointer items-center gap-3 border-b border-stone-50 px-4 py-2 hover:bg-stone-50", busy.has(c.id) && "cursor-default opacity-60")}>
                <input type="checkbox" disabled={busy.has(c.id)} checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                <span className="w-8 shrink-0 text-right text-xs tabular-nums text-stone-400">{c.number ?? ""}</span>
                <span className="min-w-0 flex-1 truncate">{c.group && <span className="text-stone-400">{c.group} · </span>}{c.title}</span>
                <span className="shrink-0 text-xs text-stone-400">{fmtDuration(c.duration)}</span>
                <ClassStatusPill info={c} job={latest.get(c.id) ?? null} />
              </label>
            ))}
          </div>

          <div className="space-y-3 border-t border-stone-100 px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  { value: "full", label: "Transcribe + find stories", title: "Full run from the audio" },
                  { value: "stories", label: "Find stories only", title: "Re-use saved transcripts with the current prompt (cheaper)" },
                ]}
              />
              <p className="text-xs text-stone-500">
                {picked.length ? (
                  <>
                    <span className="font-medium text-stone-800">{picked.length} {picked.length === 1 ? "class" : "classes"}</span> · {hours.toFixed(1)} h of audio · ≈ <span className="font-medium text-stone-800">{fmtUsd(cost)}</span> · ≈ {Math.max(1, Math.round(minutes))} min with {conc} at once
                    {needsTranscript > 0 && <> · {needsTranscript} not transcribed yet, so they’ll get a full run</>}
                  </>
                ) : (
                  "Pick classes above."
                )}
              </p>
              <div className="ml-auto flex items-center gap-2">
                {confirming && (
                  <Button variant="ghost" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                )}
                <Button variant="primary" disabled={!picked.length} loading={starting} onClick={start} icon={<Sparkles className="h-4 w-4" />}>
                  {confirming ? `Yes, spend about ${fmtUsd(cost)}` : `Run ${picked.length || ""}`.trim()}
                </Button>
              </div>
            </div>
            {confirming && (
              <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5" />
                This is a bigger batch ({picked.length} classes, about {fmtUsd(cost)}). You can pause or cancel the queue at any time.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function ActiveJob({ job }: { job: Job }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link href={`/class?id=${encodeURIComponent(job.classId)}`} className="block truncate font-medium hover:underline">{job.title}</Link>
          <p className="text-xs text-stone-500">{job.mode === "stories" ? "Finding stories (saved transcript)" : "Transcribe + find stories"} · {fmtDuration(job.duration)}</p>
        </div>
        <IconButton label="Cancel this job" onClick={() => jobAction({ action: "cancel", jobId: job.id }).catch((e) => toast(e.message, "error"))}>
          <Ban className="h-4 w-4" />
        </IconButton>
      </div>
      <JobProgress job={job} />
    </div>
  );
}

const HISTORY_ICON = {
  done: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
  failed: <AlertTriangle className="h-4 w-4 text-red-600" />,
  canceled: <CircleSlash className="h-4 w-4 text-stone-400" />,
  interrupted: <AlertTriangle className="h-4 w-4 text-amber-600" />,
  queued: <Circle className="h-4 w-4" />,
  running: <Circle className="h-4 w-4" />,
};

function History({ jobs }: { jobs: Job[] }) {
  const [limit, setLimit] = useState(20);
  if (!jobs.length) return null;
  const failed = jobs.filter((j) => j.status === "failed" || j.status === "interrupted");
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold">History</h2>
        {failed.length > 0 && <Pill color="red">{failed.length} need attention</Pill>}
        {failed.length > 1 && (
          <Button size="sm" variant="ghost" onClick={async () => { for (const j of failed) await jobAction({ action: "retry", jobId: j.id }).catch((e) => toast(e.message, "error")); }} icon={<RefreshCw className="h-3.5 w-3.5" />}>
            Retry all failed
          </Button>
        )}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => confirm("Clear the run history? Saved transcripts and stories are not affected.") && jobAction({ action: "clear" })} icon={<Trash2 className="h-3.5 w-3.5" />}>
          Clear history
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        {jobs.slice(0, limit).map((j) => (
          <HistoryRow key={j.id} job={j} />
        ))}
        {jobs.length > limit && (
          <button type="button" onClick={() => setLimit(limit + 50)} className="w-full py-2 text-xs text-stone-500 hover:bg-stone-50 hover:text-stone-900">
            Show more ({jobs.length - limit} older)
          </button>
        )}
      </div>
    </section>
  );
}

function HistoryRow({ job }: { job: Job }) {
  const [open, setOpen] = useState(job.status === "failed");
  const bad = job.status === "failed" || job.status === "interrupted";
  const when = job.finishedAt ? new Date(job.finishedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  const took = job.startedAt && job.finishedAt ? Math.round((Date.parse(job.finishedAt) - Date.parse(job.startedAt)) / 1000) : null;
  return (
    <div className="border-b border-stone-100 last:border-0">
      <div className="flex items-center gap-3 px-4 py-2.5">
        {HISTORY_ICON[job.status]}
        <div className="min-w-0 flex-1">
          <Link href={`/class?id=${encodeURIComponent(job.classId)}`} className="block truncate hover:underline">{job.title}</Link>
          <p className="text-xs text-stone-500">
            {job.status === "done" && job.result && <>{job.result.found} found · {job.result.added} new to review{job.result.kept ? ` · ${job.result.kept} reviewed kept` : ""} · </>}
            {job.status === "failed" && <>Failed while {STEP_LABEL[job.errorStep ?? job.step].toLowerCase()} · </>}
            {job.status === "interrupted" && <>Interrupted (server restarted) · </>}
            {job.status === "canceled" && <>Canceled · </>}
            {jobCost(job) && <>{jobCost(job)} · </>}
            {took != null && <>{took < 60 ? `${took}s` : `${Math.round(took / 60)} min`} · </>}
            {when}
          </p>
        </div>
        {bad && (
          <>
            {job.error && (
              <IconButton label="Show error" onClick={() => setOpen(!open)}>
                <ChevronDown className={cx("h-4 w-4 transition-transform", open && "rotate-180")} />
              </IconButton>
            )}
            <Button size="sm" onClick={() => jobAction({ action: "retry", jobId: job.id }).catch((e) => toast(e.message, "error"))} icon={<RefreshCw className="h-3.5 w-3.5" />}>
              Retry
            </Button>
          </>
        )}
        {job.status === "done" && (
          <Link href={`/class?id=${encodeURIComponent(job.classId)}`} className="inline-flex items-center gap-1 text-xs font-medium text-stone-600 hover:text-stone-900">
            Review <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
      {bad && open && job.error && <p className="mx-4 mb-3 break-words rounded-lg bg-red-50 px-3 py-2 font-mono text-xs text-red-800">{job.error}</p>}
    </div>
  );
}

function HowItWorks() {
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    if (open && !meta) api<{ meta: Meta }>("/api/jobs?meta").then((r) => setMeta(r.meta)).catch((e) => toast(e.message, "error"));
  }, [open, meta]);
  return (
    <section className="rounded-xl border border-stone-200 bg-white">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-4 py-3 text-left font-semibold">
        How it works, prompt and costs
        <ChevronDown className={cx("ml-auto h-4 w-4 text-stone-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-stone-100 px-4 py-4 text-stone-600">
          <ol className="list-decimal space-y-1 pl-5">
            <li><b>Transcribe</b> — the whole MP3 goes to xAI speech-to-text{meta && <> ({meta.sttModel})</>}, which returns every word with its time and who said it.</li>
            <li><b>Fill gaps</b> — xAI skips stretches of speech in long files, so every silence of 4s+ is cut out and transcribed again on its own.</li>
            <li><b>Find stories</b> — {meta?.llmModel ?? "Grok"} reads the transcript, works out which speaker is Rohit, and lists his stories with times, titles and shlokas.</li>
            <li><b>Save</b> — results go to <code className="rounded bg-stone-100 px-1">stories/classes/…json</code>. Re-running keeps anything you approved, rejected or added.</li>
          </ol>
          <p>
            Costs: transcription ≈ ${meta?.sttUsdPerHour ?? 0.1} per audio hour (estimated — xAI doesn’t report it), Grok is billed per token and reported exactly. A typical 1–2 hour class costs $0.25–0.50 in total.
          </p>
          {meta ? (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-400">Prompt (version {meta.promptVersion}) · edit in website/lib/server/pipeline.ts</p>
              <pre className="scroll-thin max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-50 p-3 text-xs leading-relaxed">{meta.prompt}</pre>
            </div>
          ) : (
            <Spinner />
          )}
        </div>
      )}
    </section>
  );
}
