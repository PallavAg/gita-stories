"use client";

import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { estimateSeconds, fmtUsd } from "@/lib/client/jobs";
import type { ClassInfo, Job, JobStep } from "@/lib/types";
import { cx, Pill, ProgressBar } from "./ui";

export function ClassStatusPill({ info, job }: { info: ClassInfo; job?: Job | null }) {
  if (job?.status === "running") return <Pill color="orange"><Loader2 className="h-3 w-3 animate-spin" />{STEP_LABEL[job.step]}</Pill>;
  if (job?.status === "queued") return <Pill color="orange">Queued</Pill>;
  const { suggested, approved } = info.counts;
  switch (info.status) {
    case "new":
      return job?.status === "failed" ? <Pill color="red"><AlertTriangle className="h-3 w-3" />AI run failed</Pill> : <Pill>Not processed</Pill>;
    case "transcribed":
      return <Pill color="blue">Transcribed</Pill>;
    case "review":
      return <Pill color="amber">{suggested} to review</Pill>;
    case "reviewed":
      return <Pill color="green"><Check className="h-3 w-3" />{approved ? `${approved} ${approved === 1 ? "story" : "stories"}` : "No stories"}</Pill>;
  }
}

export const STEP_LABEL: Record<JobStep, string> = {
  queued: "Queued",
  transcribing: "Transcribing",
  filling: "Filling gaps",
  finding: "Finding stories",
  saving: "Saving",
  done: "Done",
};

const STEPS: JobStep[] = ["transcribing", "filling", "finding"];

/** re-render every second while mounted, for elapsed timers */
export function useNow(on = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

const secs = (s: number) => (s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`);

/** step-by-step progress for a running job, with time-based estimates where xAI reports nothing */
export function JobProgress({ job, compact }: { job: Job; compact?: boolean }) {
  const now = useNow(job.status === "running");
  const steps = job.mode === "stories" ? (["finding"] as JobStep[]) : STEPS;
  const idx = steps.indexOf(job.step);
  const stepElapsed = job.stepStartedAt ? (now - Date.parse(job.stepStartedAt)) / 1000 : 0;
  const total = job.startedAt ? (now - Date.parse(job.startedAt)) / 1000 : 0;
  const est = estimateSeconds(job.duration, job.step);
  // filling reports real progress; the other steps are estimated, capped so the bar never claims "done" early
  const stepFraction = job.step === "filling" ? job.progress : Math.min(0.95, stepElapsed / est);
  const overall = idx < 0 ? (job.step === "saving" ? 0.98 : 0) : (idx + stepFraction) / steps.length;

  if (job.status === "queued") return <p className="text-xs text-stone-500">Waiting for a free slot…</p>;

  return (
    <div className="space-y-2">
      {!compact && (
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs">
          {steps.map((s, i) => (
            <span key={s} className="flex items-center gap-1">
              {i > 0 && <span className="text-stone-300">→</span>}
              <span className={cx("flex items-center gap-1 rounded-md px-1.5 py-0.5", i < idx || job.step === "saving" ? "text-emerald-700" : i === idx ? "bg-orange-50 font-medium text-orange-800" : "text-stone-400")}>
                {i < idx || job.step === "saving" ? <Check className="h-3 w-3" /> : i === idx ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {STEP_LABEL[s]}
              </span>
            </span>
          ))}
        </div>
      )}
      <ProgressBar value={overall} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
        <span className="min-w-0 truncate">{job.stepDetail ?? (job.step === "finding" ? "Grok is reading the transcript" : STEP_LABEL[job.step])}</span>
        <span className="tabular-nums">
          {secs(total)} elapsed
          {job.step !== "filling" && job.step !== "saving" && stepElapsed < est && <> · ~{secs(Math.max(5, est - stepElapsed))} left in this step</>}
          {stepElapsed > est * 1.5 && <> · taking longer than usual</>}
        </span>
      </div>
    </div>
  );
}

export function jobCost(job: Job) {
  const c = job.cost.stt + job.cost.llm;
  return c ? fmtUsd(c) : null;
}
