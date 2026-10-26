"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Job, JobsState } from "@/lib/types";
import { api } from "./api";

// One shared poller for /api/jobs: fast while anything is running, slow otherwise, stopped with no subscribers.

let state: (JobsState & { error: string | null }) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let subscribers = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const active = (j: Job) => j.status === "running" || j.status === "queued";

async function poll() {
  timer = null;
  try {
    const next = await api<JobsState>("/api/jobs");
    state = { ...next, error: null };
  } catch (err) {
    state = state ? { ...state, error: (err as Error).message } : { jobs: [], concurrency: 2, paused: false, totals: { stt: 0, llm: 0, runs: 0 }, error: (err as Error).message };
  }
  emit();
  if (subscribers > 0) timer = setTimeout(poll, state.jobs.some(active) ? 1000 : 5000);
}

/** fetch now (e.g. right after starting a job) */
export function refreshJobs() {
  if (timer) clearTimeout(timer);
  return poll();
}

export function useJobs() {
  useEffect(() => {
    subscribers++;
    if (subscribers === 1) refreshJobs();
    return () => {
      subscribers--;
      if (subscribers === 0 && timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
  }, []);
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
    () => null,
  );
}

export async function jobAction(body: Record<string, unknown>) {
  const res = await api<{ created?: number; skipped?: number }>("/api/jobs", { body });
  await refreshJobs();
  return res;
}

export const isActive = active;

// Rough timings measured on real classes, used to show progress while xAI gives none.
export function estimateSeconds(duration: number | null, step: Job["step"] | "total", mode: Job["mode"] = "full") {
  const d = duration ?? 3600;
  const stt = 15 + d * 0.035;
  const gaps = 25;
  const llm = 90 + (d / 60) * 1.4;
  if (step === "transcribing") return stt;
  if (step === "filling") return gaps;
  if (step === "finding") return llm;
  if (step === "total") return (mode === "full" ? stt + gaps : 0) + llm;
  return 5;
}

/** estimated USD for one class: speech-to-text at $0.10/hour (+10% for gap re-runs) plus Grok's reading */
export function estimateCost(duration: number | null, mode: Job["mode"]) {
  const hours = (duration ?? 3600) / 3600;
  return (mode === "full" ? hours * 0.11 : 0) + 0.05 + hours * 0.12;
}

export const fmtUsd = (n: number) => (n < 0.995 ? `$${n.toFixed(2)}` : `$${n.toFixed(n < 100 ? 2 : 0)}`);
