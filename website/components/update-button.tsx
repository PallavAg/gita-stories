"use client";

import { ArrowDownToLine, CheckCircle2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { toast } from "@/lib/client/toast";
import type { UpdateResult, UpdateStatus } from "@/lib/types";
import { Button, cx, Spinner } from "./ui";

const CHECK_EVERY = 30 * 60_000;

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString();
};

/** quiet icon in the top bar that turns into an "Update" button when GitHub has newer code */
export function UpdateButton() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<UpdateResult | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await api<UpdateStatus>("/api/update"));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    let live = true;
    const load = () =>
      api<UpdateStatus>("/api/update").then(
        (s) => live && setStatus(s),
        () => {},
      );
    load();
    const t = setInterval(load, CHECK_EVERY);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const pull = async () => {
    setPulling(true);
    setError(null);
    try {
      const res = await api<UpdateResult>("/api/update", { method: "POST", body: {} });
      setDone(res);
      if (res.updated && !res.restartNeeded) {
        toast(`Updated to ${res.to}. Reloading…`, "success");
        setTimeout(() => window.location.reload(), 1500);
      } else if (!res.updated) {
        toast("Already up to date", "info");
        check();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPulling(false);
    }
  };

  if (!status?.configured) return null;
  const available = status.behind > 0;

  return (
    <div className="relative">
      {available ? (
        <button type="button" onClick={() => setOpen(!open)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-orange-500 px-3 text-sm font-medium text-white hover:bg-orange-600">
          <ArrowDownToLine className="h-4 w-4" />
          Update
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(!open)} title="Check for website updates" aria-label="Website updates" className="grid h-8 w-8 place-items-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700">
          <RefreshCw className={cx("h-4 w-4", checking && "animate-spin")} />
        </button>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-80 rounded-xl border border-stone-200 bg-white p-4 text-sm shadow-lg">
            {done?.updated && done.restartNeeded ? (
              <div className="space-y-2">
                <p className="flex items-center gap-2 font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" />Updated to {done.to}</p>
                <p className="text-stone-600">{done.installed ? "New packages were installed, so the" : "The"} server needs a restart: stop it (Ctrl+C in its terminal) and run <code className="rounded bg-stone-100 px-1">npm run dev</code> again.</p>
              </div>
            ) : available ? (
              <div className="space-y-3">
                <div>
                  <p className="font-medium">{status.behind} {status.behind === 1 ? "update" : "updates"} available</p>
                  <p className="text-xs text-stone-500">Your saved stories and edits aren’t affected.</p>
                </div>
                <ul className="scroll-thin max-h-40 space-y-1 overflow-y-auto text-xs text-stone-600">
                  {status.incoming.map((c) => (
                    <li key={c.sha} className="flex gap-2"><span className="font-mono text-stone-400">{c.sha}</span><span className="min-w-0 flex-1">{c.subject}</span></li>
                  ))}
                </ul>
                <Button variant="primary" className="w-full" loading={pulling} onClick={pull} icon={<ArrowDownToLine className="h-4 w-4" />}>
                  {pulling ? "Updating…" : "Update now"}
                </Button>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4 text-emerald-600" />Up to date</p>
                <p className="text-xs text-stone-500">
                  Version {status.current.sha} · checked {ago(status.checkedAt)}
                </p>
                <Button size="sm" variant="ghost" className="-ml-2.5 mt-1" loading={checking} onClick={check} icon={<RefreshCw className="h-3.5 w-3.5" />}>
                  Check again
                </Button>
              </div>
            )}
            {status.fetchError && !error && <p className="mt-3 text-xs text-amber-700">{status.fetchError}</p>}
            {error && <p className="mt-3 break-words rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
            {pulling && <p className="mt-2 flex items-center gap-2 text-xs text-stone-500"><Spinner className="h-3 w-3" />Downloading from GitHub…</p>}
          </div>
        </>
      )}
    </div>
  );
}
