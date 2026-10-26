"use client";

import { useCallback, useSyncExternalStore } from "react";

// localStorage holds only view preferences (tabs, filters, playback choices). All story data and edits are
// saved to files on disk through the API, so the UI can change freely without losing anything.

const KEY = "gita-stories.ui.v1";

export type Prefs = {
  libraryCollection: string;
  libraryStatus: string;
  librarySearch: string;
  mediaMode: "audio" | "video";
  playbackRate: number;
  aiCollection: string;
  aiFilter: string;
  aiMode: "full" | "stories";
  showRejected: boolean;
};

const DEFAULTS: Prefs = {
  libraryCollection: "sunday",
  libraryStatus: "all",
  librarySearch: "",
  mediaMode: "audio",
  playbackRate: 1,
  aiCollection: "sunday",
  aiFilter: "new",
  aiMode: "full",
  showRejected: false,
};

let cache: Prefs | null = null;
const listeners = new Set<() => void>();

function read(): Prefs {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache!;
}

function write(next: Prefs) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage may be unavailable; prefs then last for this tab only */
  }
  listeners.forEach((l) => l());
}

export function usePref<K extends keyof Prefs>(key: K): [Prefs[K], (v: Prefs[K]) => void] {
  const value = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => read()[key],
    () => DEFAULTS[key],
  );
  const set = useCallback((v: Prefs[K]) => write({ ...read(), [key]: v }), [key]);
  return [value, set];
}
