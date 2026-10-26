"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/lib/client/toast";

/**
 * Drives a single <video> element (it plays MP3s too), so switching between audio and video only swaps the
 * source: position and play state carry over. `playRange` plays a section and stops at its end.
 */
export function useMedia(src: string, rate: number) {
  // callback ref, so the listeners below are bound once the element actually mounts
  const ref = useRef<HTMLVideoElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const attach = useCallback((node: HTMLVideoElement | null) => {
    ref.current = node;
    setMounted(!!node);
  }, []);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const stopAt = useRef<number | null>(null);
  const pending = useRef<{ t: number; play: boolean } | null>(null);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let last = -1;
    const tick = () => {
      // ~10 updates a second is plenty for the UI; the stop check below still runs every frame
      if (Math.abs(el.currentTime - last) >= 0.1) setTime((last = el.currentTime));
      if (stopAt.current != null && el.currentTime >= stopAt.current) {
        el.pause();
        el.currentTime = stopAt.current;
        stopAt.current = null;
        setRange(null);
      }
      if (!el.paused) raf = requestAnimationFrame(tick);
    };
    const onPlay = () => (setPlaying(true), cancelAnimationFrame(raf), (raf = requestAnimationFrame(tick)));
    const onPause = () => (setPlaying(false), setTime(el.currentTime));
    const onMeta = () => {
      setDuration(el.duration || 0);
      setLoading(false);
      setError(null);
      el.playbackRate = rate;
      const p = pending.current;
      pending.current = null;
      if (p) {
        el.currentTime = p.t;
        if (p.play) el.play().catch(() => {});
      }
    };
    const onSeeked = () => setTime(el.currentTime);
    const onWaiting = () => setLoading(true);
    const onPlaying = () => setLoading(false);
    const onError = () => {
      setLoading(false);
      setError("This file couldn't be played. It may have been moved or renamed.");
    };
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("seeked", onSeeked);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("error", onError);
    if (el.readyState >= 1) onMeta();
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("seeked", onSeeked);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("error", onError);
    };
    // rate is applied separately below; re-binding on rate change isn't needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, src]);

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = rate;
  }, [rate]);

  const play = useCallback(() => {
    ref.current?.play().catch((err) => toast(`Couldn't start playback: ${err.message}`, "error"));
  }, []);
  const pause = useCallback(() => ref.current?.pause(), []);
  const seek = useCallback((t: number, andPlay = false) => {
    const el = ref.current;
    if (!el) return;
    stopAt.current = null;
    setRange(null);
    el.currentTime = Math.max(0, Math.min(t, el.duration || t));
    setTime(el.currentTime);
    if (andPlay) el.play().catch(() => {});
  }, []);
  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      el.play().catch((err) => toast(`Couldn't start playback: ${err.message}`, "error"));
    } else el.pause();
  }, []);
  /** play [start, end) and stop at end */
  const playRange = useCallback((start: number, end: number) => {
    const el = ref.current;
    if (!el) return;
    el.currentTime = start;
    stopAt.current = end;
    setRange({ start, end });
    el.play().catch((err) => toast(`Couldn't start playback: ${err.message}`, "error"));
  }, []);

  /** call right before changing `src`, so the new source resumes from the same spot */
  const keepPosition = useCallback(() => {
    const el = ref.current;
    if (el) pending.current = { t: el.currentTime, play: !el.paused };
    setLoading(true);
  }, []);

  // the ref callback is returned separately from the state so components can read the state during render
  return [attach, { time, duration, playing, loading, error, range, play, pause, toggle, seek, playRange, keepPosition }] as const;
}

export type Media = ReturnType<typeof useMedia>[1];
