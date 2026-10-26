import type { Word } from "./types";

export type Line = { spk: number | null; start: number; end: number; text: string[]; first: number };

const MAX_LINE_SECONDS = 25;

/** Group words into lines by speaker, breaking at sentence ends, pauses, or every 25s. `first` is the index of the line's first word. */
export function groupLines(words: Word[]): Line[] {
  const out: Line[] = [];
  let cur: Line | null = null;
  words.forEach(([start, end, text, spk], i) => {
    if (!cur || spk !== cur.spk || start - cur.end > 3 || start - cur.start > MAX_LINE_SECONDS) {
      cur = { spk, start, end, text: [], first: i };
      out.push(cur);
    }
    cur.text.push(text);
    cur.end = end;
    if (/[।.?!]$/.test(text) && end - cur.start > 8) cur = null;
  });
  return out;
}

/** "m:ss" / "h:mm:ss"; with tenths when `precise` */
export function fmtTime(sec: number, precise = false) {
  if (!Number.isFinite(sec)) return "–";
  const neg = sec < 0;
  sec = Math.abs(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const ss = precise ? s.toFixed(1).padStart(4, "0") : String(Math.floor(s)).padStart(2, "0");
  return `${neg ? "-" : ""}${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${ss}`;
}

/** parse "1:02:03", "52:35.5", "95" into seconds */
export function parseTime(input: string): number | null {
  const parts = input.trim().split(":");
  if (!parts.length || parts.length > 3 || parts.some((p) => p === "" || !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.map(Number).reduce((acc, p) => acc * 60 + p, 0);
}

export function fmtDuration(sec: number | null) {
  if (sec == null) return "–";
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m} min`;
}

/** index of the last word starting at or before t */
export function wordAt(words: Word[], t: number) {
  let lo = 0, hi = words.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid][0] <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
