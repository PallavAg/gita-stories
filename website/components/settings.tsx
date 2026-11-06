"use client";

import { AlertTriangle, ChevronDown, FolderOpen, RefreshCw, Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { refreshJobs } from "@/lib/client/jobs";
import { resetPrefs } from "@/lib/client/prefs";
import { toast } from "@/lib/client/toast";
import { fmtDate, matchesQuery } from "@/lib/names";
import type { AppSettings, ClassInfo, DataStats, ReasoningEffort } from "@/lib/types";
import { useLibrary } from "./library";
import { Button, cx, ErrorBox, Pill, Segmented, Spinner } from "./ui";

type SettingsResponse = { settings: AppSettings; defaults: AppSettings; stats: DataStats; models: { stt: string; llm: string } };

const EFFORTS: { value: ReasoningEffort; label: string; hint: string }[] = [
  { value: "low", label: "Low", hint: "Fastest; most likely to miss or mislabel stories." },
  { value: "medium", label: "Medium", hint: "Thinks less than High and runs faster. Worth comparing on classes you've already reviewed." },
  { value: "high", label: "High", hint: "xAI's default, used for every run so far. Good results in testing." },
  { value: "xhigh", label: "Extra high", hint: "Most thorough; slower on long classes." },
];

export function Settings() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    api<SettingsResponse>("/api/settings").then(
      (d) => live && (setData(d), setError(null)),
      (e) => live && setError((e as Error).message),
    );
    return () => {
      live = false;
    };
  }, [nonce]);

  /** run a settings action; returns true when it worked */
  const act = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        const res = await api<{ message?: string; settings?: AppSettings }>("/api/settings", { body });
        if (res.settings) setData((d) => d && { ...d, settings: res.settings! });
        if (res.message) toast(res.message, "success");
        reload();
        refreshJobs();
        return true;
      } catch (err) {
        toast((err as Error).message, "error");
        return false;
      }
    },
    [reload],
  );

  if (error && !data) return <main className="mx-auto max-w-3xl p-6"><ErrorBox title="Couldn't load settings" message={error} action={<Button onClick={reload} icon={<RefreshCw className="h-4 w-4" />}>Try again</Button>} /></main>;
  if (!data) return <main className="mx-auto flex max-w-3xl items-center gap-2 p-6 text-stone-500"><Spinner /> Loading settings…</main>;

  const { settings, stats, models } = data;
  const effort = EFFORTS.find((e) => e.value === settings.reasoningEffort)!;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-stone-500">Saved on this computer in <code className="rounded bg-stone-100 px-1 text-xs">stories/settings.json</code>.</p>
      </div>

      <Card title="AI">
        <Row label="Story finding effort" sub={`How hard ${models.llm} thinks before listing stories. Applies to new runs.`}>
          <Segmented value={settings.reasoningEffort} onChange={(v) => act({ action: "save", settings: { reasoningEffort: v } })} options={EFFORTS.map((e) => ({ value: e.value, label: e.label }))} />
        </Row>
        <p className="-mt-2 text-xs text-stone-500">{effort.hint}</p>
        <Row label="Keep filler words" sub={`Keep “uh”, “um” and similar in new transcripts from ${models.stt}. Off gives cleaner text.`}>
          <Toggle on={settings.fillerWords} onChange={(v) => act({ action: "save", settings: { fillerWords: v } })} />
        </Row>
      </Card>

      <Card title="Your data">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Transcripts" value={stats.transcripts} />
          <Stat label="Classes with stories" value={stats.classesWithStories} />
          <Stat label="Approved stories" value={stats.stories.approved} />
          <Stat label="To review" value={stats.stories.suggested} />
        </div>
        <p className="flex items-center gap-2 text-xs text-stone-500">
          <FolderOpen className="h-3.5 w-3.5" />
          Everything is in <code className="rounded bg-stone-100 px-1">{stats.dataDir}</code>
          {stats.deletedBatches > 0 && <> · {stats.deletedBatches} deleted {stats.deletedBatches === 1 ? "batch" : "batches"} in <code className="rounded bg-stone-100 px-1">stories/.deleted</code></>}
          {stats.version && <> · version {stats.version}</>}
        </p>
      </Card>

      <ClassReset act={act} />
      <DangerZone act={act} stats={stats} />
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white">
      <h2 className="border-b border-stone-100 px-4 py-3 font-semibold">{title}</h2>
      <div className="space-y-4 p-4">{children}</div>
    </section>
  );
}

function Row({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{label}</p>
        {sub && <p className="text-xs text-stone-500">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-stone-400">{label}</p>
      <p className="text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className={cx("relative h-6 w-11 rounded-full transition-colors", on ? "bg-orange-500" : "bg-stone-300")}>
      <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", on ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

/** a button that asks for a second click (with an explanation) before doing anything destructive */
function ConfirmAction({ label, explain, confirmLabel, onConfirm, disabled, typeToConfirm }: { label: string; explain: string; confirmLabel?: string; onConfirm: () => Promise<boolean | void>; disabled?: boolean; typeToConfirm?: string }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const typedOk = !typeToConfirm || typed.trim().toLowerCase() === typeToConfirm;
  const go = async () => {
    setBusy(true);
    await onConfirm();
    setBusy(false);
    setAsking(false);
  };
  return (
    <div className={cx("rounded-lg border p-3", asking ? "border-red-200 bg-red-50/50" : "border-stone-200")}>
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 font-medium">{label}</p>
        {!asking ? (
          <Button size="sm" variant="danger" disabled={disabled} onClick={() => setAsking(true)}>
            {label.split(" ")[0]}…
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => (setAsking(false), setTyped(""))} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" variant="destructive" loading={busy} onClick={go} disabled={!typedOk}>
              {confirmLabel ?? "Yes, do it"}
            </Button>
          </div>
        )}
      </div>
      {asking && (
        <p className="mt-2 flex items-start gap-2 text-xs text-red-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {explain}
        </p>
      )}
      {asking && typeToConfirm && (
        <label className="mt-2 block text-xs text-red-800">
          Type <b>{typeToConfirm}</b> to confirm
          <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} className="input mt-1 h-8 max-w-48" />
        </label>
      )}
    </div>
  );
}

const MOVED = "Files are moved to stories/.deleted, so you can restore them by moving them back.";

function ClassReset({ act: run }: { act: (b: Record<string, unknown>) => Promise<boolean> }) {
  const { collections, reload } = useLibrary();
  // refresh the class's badges after an action
  const act = async (b: Record<string, unknown>) => {
    const ok = await run(b);
    if (ok) reload();
    return ok;
  };
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<ClassInfo | null>(null);
  const all = collections?.flatMap((c) => c.classes) ?? [];
  const current = picked ? (all.find((c) => c.id === picked.id) ?? picked) : null;
  const hits = q.trim()
    ? all.filter((c) => matchesQuery(`${c.display.title} ${c.display.note ?? ""} ${c.display.date ? fmtDate(c.display.date) : ""} ${c.title} ${c.number ?? ""}`, q)).slice(0, 8)
    : [];
  const stories = current ? current.counts.suggested + current.counts.approved + current.counts.rejected : 0;
  return (
    <Card title="Reset one class">
      {!current ? (
        <div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={collections ? "Find a class by title, date or number" : "Loading classes…"} className="input pl-9" />
          </div>
          {hits.length > 0 && (
            <div className="mt-2 overflow-hidden rounded-lg border border-stone-200">
              {hits.map((c) => (
                <button key={c.id} type="button" onClick={() => (setPicked(c), setQ(""))} className="flex w-full items-center gap-2 border-b border-stone-100 px-3 py-2 text-left last:border-0 hover:bg-stone-50">
                  <span className="min-w-0 flex-1 truncate">
                    {c.display.title}
                    {c.display.date && <span className="text-xs text-stone-400"> · {fmtDate(c.display.date)}</span>}
                  </span>
                  <span className="text-xs text-stone-400">{c.collection}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-lg bg-stone-50 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{current.display.title}{current.display.date && <span className="font-normal text-stone-500"> · {fmtDate(current.display.date)}</span>}</p>
              <p className="flex flex-wrap gap-1.5 pt-1 text-xs">
                <Pill color={current.transcribed ? "blue" : "gray"}>{current.transcribed ? "Transcribed" : "No transcript"}</Pill>
                <Pill color={current.counts.suggested ? "amber" : "gray"}>{current.counts.suggested} to review</Pill>
                <Pill color={current.counts.approved ? "green" : "gray"}>{current.counts.approved} approved</Pill>
                {current.counts.rejected > 0 && <Pill>{current.counts.rejected} rejected</Pill>}
              </p>
            </div>
            <button type="button" aria-label="Pick another class" onClick={() => setPicked(null)} className="text-stone-400 hover:text-stone-700">
              <X className="h-4 w-4" />
            </button>
          </div>
          <ConfirmAction
            label="Reset AI suggestions"
            disabled={!current.aiRanAt && !current.counts.suggested}
            explain="Removes this class's unreviewed AI stories so you can run the AI on it again from scratch. Approved, rejected and hand-added stories stay."
            onConfirm={() => act({ action: "reset-suggestions", classId: current.id })}
          />
          <ConfirmAction label="Delete all stories" disabled={!stories && !current.aiRanAt} explain={`Removes all ${stories} stories for this class, including approved ones. ${MOVED}`} onConfirm={() => act({ action: "delete-stories", classId: current.id })} />
          <ConfirmAction label="Delete transcript" disabled={!current.transcribed} explain={`The next AI run will have to transcribe this class again. ${MOVED}`} onConfirm={() => act({ action: "delete-transcripts", classId: current.id })} />
        </div>
      )}
    </Card>
  );
}

function DangerZone({ act, stats }: { act: (b: Record<string, unknown>) => Promise<boolean>; stats: DataStats }) {
  const [open, setOpen] = useState(false);
  const total = stats.stories.suggested + stats.stories.approved + stats.stories.rejected;
  return (
    <section className="rounded-xl border border-stone-200 bg-white">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-4 py-3 text-left font-semibold">
        Reset everything
        <span className="text-xs font-normal text-stone-400">bulk resets and maintenance</span>
        <ChevronDown className={cx("ml-auto h-4 w-4 text-stone-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-stone-100 p-4">
          <ConfirmAction
            label="Reset all data"
            typeToConfirm="reset"
            confirmLabel="Reset everything"
            explain={`Starts over: ${total} ${total === 1 ? "story" : "stories"} (${stats.stories.approved} approved), ${stats.transcripts} ${stats.transcripts === 1 ? "transcript" : "transcripts"} and their older versions, the AI run history and spending totals, the settings, and this browser's view preferences. Recordings aren't touched. ${MOVED}`}
            onConfirm={async () => {
              const ok = await act({ action: "reset-all" });
              if (ok) resetPrefs();
              return ok;
            }}
          />
          <ConfirmAction label="Reset all AI suggestions" disabled={!stats.stories.suggested} explain={`Removes all ${stats.stories.suggested} unreviewed AI stories in every class and marks those classes as not processed. Approved, rejected and hand-added stories stay.`} onConfirm={() => act({ action: "reset-suggestions" })} />
          <ConfirmAction label="Delete all stories" disabled={!total} explain={`Removes all ${total} stories in ${stats.classesWithStories} classes, including ${stats.stories.approved} approved. ${MOVED}`} onConfirm={() => act({ action: "delete-stories" })} />
          <ConfirmAction label="Delete all transcripts" disabled={!stats.transcripts} explain={`Removes ${stats.transcripts} transcripts and their older versions. Every class would have to be transcribed again. ${MOVED}`} onConfirm={() => act({ action: "delete-transcripts" })} />
          <ConfirmAction label="Clear AI run history" explain="Empties the history list on the AI runs page and resets the spending totals. Stories and transcripts aren't affected." confirmLabel="Yes, clear it" onConfirm={() => act({ action: "clear-history" })} />
          <ConfirmAction label="Re-measure recording lengths" explain="Forgets the cached lengths of all recordings. The next library load measures them again, which takes a few seconds." confirmLabel="Re-measure" onConfirm={() => act({ action: "rebuild-index" })} />
          <ConfirmAction
            label="Reset view preferences"
            explain="Forgets this browser's tabs, filters, audio/video choice and playback speed. Nothing on disk changes."
            confirmLabel="Reset"
            onConfirm={async () => {
              resetPrefs();
              toast("View preferences reset", "success");
            }}
          />
          <ConfirmAction label="Reset settings to defaults" explain="Puts the AI settings above back to their defaults (High effort, no filler words)." confirmLabel="Reset" onConfirm={() => act({ action: "reset-settings" })} />
        </div>
      )}
    </section>
  );
}
