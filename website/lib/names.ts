// Turns messy recording titles ("sunday gita chapter 15 1 nov 12 th", "baba ke patr may 19th mp4") into
// consistent display names. Pure functions, no I/O: the file names on disk are never touched.

export type Described = {
  /** consistent title, e.g. "Gita 15.15–15.18" */
  title: string;
  /** what kind of recording it is, e.g. "Gita", "Baba Ke Patr" */
  series: string;
  /** extra detail shown quietly next to the title, e.g. "Class 99" */
  note: string | null;
  /** ISO date (yyyy-mm-dd) when the class date could be worked out */
  date: string | null;
};

export type NameInput = { collection: string; number: number | null; title: string; group: string | null };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const monthIndex = (m: string) => MONTHS.indexOf(m.slice(0, 3).toLowerCase());
const ORD = "(?:st|nd|rd|th|nfd)";

type DateHit = { day: number; month: number; year: number | null; start: number; end: number };

const FIRST_YEAR = 2020;
const LAST_YEAR = 2026;
const isSunday = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).getUTCDay() === 0;
const validDay = (m: number, d: number) => d >= 1 && d <= new Date(Date.UTC(2024, m + 1, 0)).getUTCDate();
const fullYear = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));

/** all the ways a day + month could be written in the text, strongest evidence first */
function dateCandidates(text: string): DateHit[] {
  const out: { hit: DateHit; rank: number }[] = [];
  const add = (re: RegExp, rank: number, dayIdx: number, monthIdx: number, yearIdx?: number) => {
    for (const m of text.matchAll(re)) {
      const month = monthIndex(m[monthIdx]);
      const day = Number(m[dayIdx]);
      if (month < 0 || !validDay(month, day)) continue;
      const y = yearIdx ? (m[yearIdx] ?? m[yearIdx + 1] ?? m[yearIdx + 2]) : undefined;
      out.push({ rank, hit: { day, month, year: y ? fullYear(y) : null, start: m.index!, end: m.index! + m[0].length } });
    }
  };
  const Y = "(?:[,']\\s*(\\d{4}|\\d{2})|\\s+(20\\d{2})|(20\\d{2}))?";
  const M = `(?:(?<![a-z])|(?<=\\d(?:st|nd|rd|th|nfd)))${MONTH_RE}(?:(?![a-z])|(?=gita|family|ending))`; // month name, even when glued to the next word
  const D = "(?<!\\d)(\\d{1,2})";
  const D0 = "(\\d{1,2})"; // before an ordinal suffix the day may be glued to a verse number
  // "Jun 26, 22" (comma year) and a day with an ordinal suffix are the strongest hints: "26th July", "Dec 8th", "june25 th"
  add(new RegExp(`${M}\\s+${D}\\s*,\\s*(\\d{4}|\\d{2})`, "gi"), 0, 2, 1, 3);
  add(new RegExp(`${D0}\\s*${ORD}\\s*-?\\s*${M}${Y}`, "gi"), 0, 1, 2, 3);
  add(new RegExp(`${M}\\s*-?\\s*${D0}\\s*${ORD}(?![a-z])${Y}`, "gi"), 0, 2, 1, 3);
  // tight joins: "9Apr", "Nov6", "8May2022"
  add(new RegExp(`${D}${M}${Y}`, "gi"), 1, 1, 2, 3);
  add(new RegExp(`${M}${D}(?!\\d)${Y}`, "gi"), 1, 2, 1, 3);
  // spaced, no suffix: "5 Jun 2022", "Aug 9"
  add(new RegExp(`${D}\\s+${M}(?:\\s+(20\\d{2}|2[0-6])(?!\\d))?`, "gi"), 2, 1, 2, 3);
  add(new RegExp(`${M}\\s+${D}(?!\\d)${Y}`, "gi"), 2, 2, 1, 3);
  return out.sort((a, b) => a.rank - b.rank || a.hit.start - b.hit.start).map((o) => o.hit);
}

function pickDate(text: string, sundayOnly: boolean): DateHit | null {
  const all = dateCandidates(text);
  if (!all.length) return null;
  if (sundayOnly) {
    const ok = all.find((h) => (h.year ? [h.year] : range(FIRST_YEAR, LAST_YEAR)).some((y) => isSunday(y, h.month, h.day)));
    if (ok) return ok;
  }
  return all[0];
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// ---------- verses ----------

const dash = "–";

/** "2.57–65", "15.15–15.18", "18.66" from the loose numbers left in a title, or null if they don't look like verses */
function verses(nums: number[]): string | null {
  let n = nums.filter((x) => x > 0);
  if (n.length > 4 && n.length % 2 === 0) n = [...n.slice(0, 2), ...n.slice(-2)]; // several ranges: first start to last end
  if (n.length === 2) return n[0] <= 18 ? `${n[0]}.${n[1]}` : null;
  if (n.length === 3) {
    const [c, a, b] = n;
    return c <= 18 && b > a ? `${c}.${a}${dash}${b}` : null;
  }
  if (n.length === 4) {
    const [c1, v1, c2raw, v2] = n;
    if (c1 > 18) return null;
    const c2 = c2raw > 18 ? c1 : c2raw; // typo like "2 66 to 22 72"
    return c1 === c2 ? (v2 > v1 ? `${c1}.${v1}${dash}${v2}` : `${c1}.${v1}`) : `${c1}.${v1}${dash}${c2}.${v2}`;
  }
  return null;
}

const nums = (s: string) => (s.match(/\d+/g) ?? []).map(Number);

// ---------- helpers ----------

const titleCase = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|[\s(-])([a-z])/g, (_, p, c) => p + c.toUpperCase());

function clean(raw: string) {
  return raw
    .replace(/[’‘]/g, "'")
    .replace(/\.(mp4|m4a|mp3)\b/gi, " ")
    .replace(/\b(mp4|m4a|mp3)\b/gi, " ")
    .replace(/(\d)(mp4|m4a)\b/gi, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

/** drop the matched date and leftover filler, for titles we can't classify */
function stripFiller(text: string, hit: DateHit | null) {
  let t = hit ? text.slice(0, hit.start) + " " + text.slice(hit.end) : text;
  t = t.replace(/\b(sunday|sun)\b/gi, " ").replace(/\bclass\b/gi, " ").replace(/[,\-–]+\s*$/g, "").replace(/^\s*[,\-–]+/g, "");
  return titleCase(t);
}

type Spec = { series: string; title: string; note?: string | null };

/** "2.57–65" from a title body like "gita chapter 15 1 15 18", or null when it has no verse numbers */
function gitaVerses(body: string) {
  return verses(nums(body.replace(/(\d)\s*\.\s*(\d)/g, "$1 $2").replace(/gita|gıta|bhagwad|bhagavad|chapter|chap|shlokas?|shlok|sh\b|sunday|family|class|gyan|yagya|explanations?|second line of|first line of|bhaiji|charanamrit|charitamrit|charitra|amrit/g, " ").replace(/\bto\b/g, " ")));
}

function describeText(rawTitle: string, hit: DateHit | null): Spec {
  const text = clean(rawTitle);
  const lower = text.toLowerCase();
  const withoutDate = (hit ? text.slice(0, hit.start) + " " + text.slice(hit.end) : text).toLowerCase();
  const seq = lower.match(/^(\d+)\)\s*/);
  const note = seq ? `Part ${seq[1]}` : null;
  const body = withoutDate.replace(/^\d+\)\s*/, "").replace(/(?<!\d)20\d{2}(?!\d)/g, " ");

  // Kathopanisad (Baba Ki Pustak): "Sh 2.6- Sh 2.11", "Sh1-Sh-3", "Sh7(contd)- Sh 11"
  if (/kathopanisad|baba ki pustak/.test(lower)) {
    const part = body.replace(/baba ki pustak|kathopanisad/g, " ").replace(/\(contd[^)]*\)/g, " ").replace(/(\d)\s*-\s*sh/g, "$1 sh");
    const n = part.match(/\d+(?:\.\d+)?/g) ?? [];
    const label = n.length >= 3 ? `${n[0]}${dash}${n[1]}, ${n.slice(2).join(", ")}` : n.length === 2 && n[0] !== n[1] ? `${n[0]}${dash}${n[1]}` : (n[0] ?? "");
    return { series: "Kathopanisad", title: label ? `Kathopanisad Sh ${label}` : "Kathopanisad", note };
  }
  if (/adhyatma/.test(lower)) return { series: "Adhyatma Upanishad", title: "Adhyatma Upanishad", note };
  if (/ishavasya|ishavasyop|upnishad|upanishad/.test(lower)) {
    const part = body.replace(/teerthji maharajji|ishavasyop?nishad|ishavasya|upanishad|upnishad/g, " ").replace(/\(contd[^)]*\)/g, " ").replace(/(\d)\s*[-&]\s*(?:sh\s*)?/g, "$1 ");
    const n = part.match(/\d+(?:\.\d+)?/g) ?? [];
    const label = n.length >= 2 && n[0] !== n[n.length - 1] ? `${n[0]}${dash}${n[n.length - 1]}` : (n[0] ?? "");
    const guest = /teerthji maharajji/.test(lower) ? "Teerthji Maharajji" : /epilogue/.test(lower) ? "Epilogue" : null;
    return { series: "Ishavasya Upanishad", title: label ? `Ishavasya Upanishad Sh ${label}` : "Ishavasya Upanishad", note: guest ?? note };
  }
  if (/baba ke patr|madhur patr|madur patr|baba ki patr/.test(lower)) {
    return { series: "Patr", title: /madh?ur/.test(lower) ? "Madhur Patr" : "Baba Ke Patr", note };
  }
  if (/\baka|a?stikta|astitka/.test(lower)) {
    const pages = nums(body.replace(/aastikta ki aadhaarshilaayen|astikta ki adharshila/g, " "));
    const label = /to end/.test(body) ? `${pages[0]}${dash}end` : pages.length >= 2 ? `${pages[0]}${dash}${pages[1]}` : pages.length === 1 ? String(pages[0]) : "";
    return { series: "Aastikta", title: label ? `Aastikta pp. ${label}` : "Aastikta", note };
  }
  if (/bhaiji|babuji ?charat/.test(lower)) {
    const gv = gitaVerses(body);
    return { series: "Bhaiji", title: gv ? `Gita ${gv} + Bhaiji Charitamrit` : "Bhaiji Charitamrit", note };
  }
  if (/gyan yagya/.test(lower)) {
    const ch = nums(body.replace(/gyan yagya/g, " "));
    return { series: "Gyan Yagya", title: ch.length ? `Gyan Yagya Ch ${ch[0]}` : "Gyan Yagya", note };
  }
  if (/manas|uttarkand/.test(lower)) {
    const d = body.match(/(?:uttarkand|\w+kand)?\s*doha\s*(\d+)\D+(\d+)/);
    return { series: "Ram Charitmanas", title: d ? `Ram Charitmanas Doha ${d[1]}${dash}${d[2]}` : "Ram Charitmanas", note };
  }
  if (/hanuman ?chalisa/.test(lower)) {
    const n = nums(body.replace(/hanuman ?chalisa|doha|verses|sunday/g, " "));
    const label = n.length >= 2 ? `${n[0]}${dash}${n[1]}` : n.length === 1 ? String(n[0]) : "";
    return { series: "Hanuman Chalisa", title: label ? `Hanuman Chalisa ${label}` : "Hanuman Chalisa", note };
  }
  if (/bhaj\w*\s*govind/.test(lower)) return { series: "Bhaj Govindam", title: "Bhaj Govindam", note };

  // Gita with verse numbers
  const v = gitaVerses(body);
  if (v && /gita|chapter|shlok|\bsh\b|sunday \d|^sunday/.test(lower)) {
    const tail = /quiz/.test(lower) ? "Quiz" : /explanation/.test(lower) ? null : null;
    return { series: "Gita", title: `Gita ${v}${tail ? ` ${tail}` : ""}`, note };
  }
  if (/quiz/.test(lower)) {
    const c = nums(body);
    return { series: "Gita", title: c.length ? `Gita Chapter ${c[0]} Quiz` : "Gita Quiz", note };
  }
  // no verses or known book: keep whatever is distinctive, else name it by what it is
  const left = stripFiller(text, hit).replace(/\b(family|fam|gita|ending|2nd recording)\b/gi, " ").replace(/(\d)\s*(st|nd|rd|th)\b/gi, " ").replace(/\s+/g, " ").trim();
  if (/[a-z]{3}/i.test(left)) return { series: "Other", title: titleCase(left), note };
  const kind = /gita/.test(lower) ? "Gita Class" : /\bfam/.test(lower) ? "Family Class" : "Sunday Class";
  return { series: kind === "Gita Class" ? "Gita" : "Other", title: kind, note: /2nd recording/.test(lower) ? "2nd recording" : note };
}

// ---------- per-collection ----------

function describeChapters(t: NameInput): Spec {
  const text = clean(t.title);
  const home = text.match(/^chapter\s*(\d+)/i);
  const rest0 = text.replace(/^chapter\s*\d+\s*-?\s*/i, "");
  // "Shlokas 12-15" belongs to the home chapter; "Chapter 5 Shlokas 1-3" names its own chapter
  const seg: { c: number; a: number; b: number }[] = [];
  const token = /(?:chapter\s*(\d+)\s*[-,]?\s*)?shlokas?\s*(\d+)(?:\s*[-–]\s*(\d+))?/gi;
  for (const m of rest0.matchAll(token)) {
    const c = m[1] ? Number(m[1]) : home ? Number(home[1]) : 0;
    seg.push({ c, a: Number(m[2]), b: m[3] ? Number(m[3]) : Number(m[2]) });
  }
  const first = seg[0], last = seg[seg.length - 1];
  let label: string | null = null;
  if (first) {
    const end = last.c === first.c ? `${last.b}` : `${last.c}.${last.b}`;
    label = `${first.c}.${first.a}${first.a === last.b && first.c === last.c ? "" : `${dash}${end}`}`;
  } else if (home) label = `Chapter ${home[1]}`;
  const note = rest0
    .replace(token, " ")
    .replace(/\bchapter\s*\d+\b(?!\s*(?:summary|intro))/gi, " ")
    .replace(/\bfamily gita class on\b/gi, "Family class")
    .replace(/\b(and|on)\b/gi, " ")
    .replace(/[,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tidy = note.replace(/^manas\b.*$/i, "Ram Charitmanas").replace(/\bintro\b/i, "Intro");
  return { series: "Gita", title: label ? `Gita ${label}` : titleCase(text), note: tidy ? titleCase(tidy).replace(/^Family Class$/, "Family class") : null };
}

function describeSaturday(t: NameInput, hit: DateHit | null): Spec {
  const text = clean(t.title);
  const cls = text.match(/class\s*(\d+)/i);
  const note = cls ? `Class ${cls[1]}` : null;
  const body = text.replace(/saturday\s*(satsang|gita)?\s*class\s*\d*\.?/i, " ").replace(/\s+/g, " ").trim();
  const lower = body.toLowerCase().replace(/shlok[a-z]*/g, "shloka");
  let verse: string | null = null;
  const ch = lower.match(/chapter\s*(\d+)/);
  if (ch) {
    const vs = nums(lower.replace(/chapter\s*\d+/, " "));
    if (vs.length) verse = vs.length >= 2 ? `${ch[1]}.${vs[0]}${dash}${vs[vs.length - 1]}` : `${ch[1]}.${vs[0]}`;
  } else if (/shloka/.test(lower)) verse = gitaVerses(lower.replace(/(\d)\s*\.\s*(\d)/g, "$1 $2"));
  const extras: string[] = [];
  if (/q&a/.test(lower)) extras.push("Q&A");
  if (/sharings?/.test(lower)) extras.push("Sharings");
  if (/review/.test(lower)) extras.push("Review");
  const noteAll = [note, ...extras].filter(Boolean).join(" · ") || null;
  if (verse) return { series: "Gita", title: `Gita ${verse}`, note: noteAll };
  const left = stripFiller(body, hit).replace(/\bsaturday\b/gi, " ").replace(/\s+/g, " ").trim();
  if (!/[a-z]{3}/i.test(left.replace(/\b(class|video)\b/gi, ""))) return { series: "Gita", title: cls ? `Saturday Gita Class ${cls[1]}` : "Saturday Gita Class", note: null };
  return { series: "Other", title: titleCase(left.replace(/^[,\s]+|[,\s]+$/g, "")), note };
}

// ---------- public ----------

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * Names for a whole collection at once, because class dates rarely say the year: Sunday classes are
 * numbered newest-first and happen on Sundays, which pins down the year for nearly all of them.
 */
export function describeCollection(items: NameInput[]): Described[] {
  const sunday = items[0]?.collection === "sunday";
  const hits = items.map((t) => (t.collection === "chapters" ? null : pickDate(clean(t.title), sunday)));
  const specs = items.map((t, i) => (t.collection === "chapters" ? describeChapters(t) : t.collection === "saturday" ? describeSaturday(t, hits[i]) : describeText(t.title, hits[i])));

  const dates: (string | null)[] = items.map(() => null);
  if (items[0]?.collection !== "chapters") {
    // Newest first: dates must never increase down the list. Pick every year at once (dynamic programming),
    // preferring years where the date falls on a Sunday and keeping the order consistent.
    const order = items.map((_, i) => i).filter((i) => hits[i]).sort((a, b) => (items[a].number ?? 1e9) - (items[b].number ?? 1e9));
    const options = order.map((i) => {
      const h = hits[i]!;
      return (h.year ? [h.year] : range(FIRST_YEAR, LAST_YEAR)).filter((y) => new Date(Date.UTC(y, h.month, h.day)).getUTCMonth() === h.month).map((y) => ({ y, t: Date.UTC(y, h.month, h.day), cost: (sunday && !isSunday(y, h.month, h.day) ? 1 : 0) + (LAST_YEAR - y) * 0.001 }));
    });
    const ORDER_PENALTY = 1000;
    let prev = options[0]?.map((o) => ({ cost: o.cost, from: -1 })) ?? [];
    const trail = [prev];
    for (let k = 1; k < options.length; k++) {
      prev = options[k].map((o) => {
        let best = { cost: Infinity, from: 0 };
        options[k - 1].forEach((p, j) => {
          const lateDays = (o.t - p.t) / 86_400_000;
          // a few weeks out of order happens (files numbered by upload), years out of order is a wrong year
          const c = trail[k - 1][j].cost + (lateDays <= 0 ? 0 : lateDays <= 45 ? 0.5 : ORDER_PENALTY + lateDays / 365);
          if (c < best.cost) best = { cost: c, from: j };
        });
        return { cost: best.cost + o.cost, from: best.from };
      });
      trail.push(prev);
    }
    let pick = prev.reduce((bi, c, i, arr) => (c.cost < arr[bi].cost ? i : bi), 0);
    for (let k = options.length - 1; k >= 0; k--) {
      const o = options[k][pick];
      const h = hits[order[k]]!;
      dates[order[k]] = iso(o.y, h.month, h.day);
      pick = trail[k][pick].from;
    }
  }
  return specs.map((s, i) => ({ title: s.title, series: s.series, note: s.note ?? null, date: dates[i] }));
}

export function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
}

/** one-line label for places with little room, e.g. job lists: "Gita 15.15–18 · 12 Nov 2023" */
export function fullLabel(d: Described) {
  return [d.title, d.note ? `(${d.note})` : null, d.date ? `· ${fmtDate(d.date)}` : null].filter(Boolean).join(" ");
}

/** search match: every word of the query appears somewhere in the text (any order, any case) */
export function matchesQuery(text: string, query: string) {
  const hay = text.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/**
 * Chronological order for a collection's classes. Uses each class's date where known; undated classes take the
 * date of the nearest newer class, and file numbers break ties (Sunday and Saturday files are numbered newest-first,
 * the chapter series oldest-first, in chapter groups).
 */
export function sortChronological<T extends { collection: string; number: number | null; group: string | null; display: { date: string | null } }>(items: T[], order: "oldest" | "newest"): T[] {
  const dir = order === "oldest" ? 1 : -1;
  if (items[0]?.collection === "chapters") {
    return [...items].sort((a, b) => dir * ((a.group ?? "").localeCompare(b.group ?? "", undefined, { numeric: true }) || (a.number ?? 1e9) - (b.number ?? 1e9)));
  }
  const byFile = [...items].sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9)); // newest first
  const key = new Map<T, string>();
  let carried = "9999-12-31";
  for (const it of byFile) {
    if (it.display.date) carried = it.display.date;
    key.set(it, it.display.date ?? carried);
  }
  return byFile.sort((a, b) => dir * (key.get(a)!.localeCompare(key.get(b)!) || (b.number ?? 1e9) - (a.number ?? 1e9)));
}
