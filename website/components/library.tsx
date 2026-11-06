"use client";

import { CalendarArrowDown, CalendarArrowUp, ChevronRight, Film, RefreshCw, Search, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client/api";
import { isActive, jobAction, useJobs } from "@/lib/client/jobs";
import { usePref } from "@/lib/client/prefs";
import { toast } from "@/lib/client/toast";
import { fmtDate, matchesQuery, sortChronological } from "@/lib/names";
import { fmtDuration } from "@/lib/transcript";
import type { ClassInfo, CollectionInfo, Job } from "@/lib/types";
import { FileNamePanel, FileNameToggle } from "./file-name";
import { ClassStatusPill } from "./status";
import { Button, cx, ErrorBox, IconButton, Segmented, Spinner } from "./ui";

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "review", label: "To review" },
  { value: "reviewed", label: "Reviewed" },
  { value: "new", label: "Not processed" },
] as const;

/** the library list; it reloads whenever the number of running AI jobs changes, so statuses stay current */
export function useLibrary() {
  const jobs = useJobs();
  const activeCount = jobs?.jobs.filter(isActive).length ?? 0;
  const [collections, setCollections] = useState<CollectionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    api<{ collections: CollectionInfo[] }>("/api/library").then(
      (r) => live && (setCollections(r.collections), setError(null)),
      (err) => live && setError((err as Error).message),
    );
    return () => {
      live = false;
    };
  }, [activeCount, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { collections, error, reload };
}

export function Library() {
  const { collections, error, reload } = useLibrary();
  const jobs = useJobs();
  const [collection, setCollection] = usePref("libraryCollection");
  const [status, setStatus] = usePref("libraryStatus");
  const [sort, setSort] = usePref("librarySort");
  const [search, setSearch] = usePref("librarySearch");

  const latestJob = useMemo(() => {
    const m = new Map<string, Job>();
    for (const j of jobs?.jobs ?? []) if (!m.has(j.classId)) m.set(j.classId, j);
    return m;
  }, [jobs]);

  const current = collections?.find((c) => c.key === collection) ?? collections?.[0];
  const q = search.trim().toLowerCase();
  const shown = sortChronological(current?.classes ?? [], sort).filter(
    (c) =>
      (status === "all" || (status === "new" ? c.status === "new" || c.status === "transcribed" : c.status === status)) &&
      (!q || matchesQuery(`${c.number ?? ""} ${c.display.title} ${c.display.note ?? ""} ${c.display.series} ${c.display.date ? fmtDate(c.display.date) : ""} ${c.title} ${c.group ?? ""}`, q)),
  );
  const groups = useMemo(() => {
    const m = new Map<string, ClassInfo[]>();
    for (const c of shown) m.set(c.group ?? "", [...(m.get(c.group ?? "") ?? []), c]);
    return [...m.entries()];
  }, [shown]);

  if (error && !collections) return <main className="mx-auto max-w-5xl p-6"><ErrorBox title="Couldn't load the library" message={error} action={<Button onClick={reload} icon={<RefreshCw className="h-4 w-4" />}>Try again</Button>} /></main>;
  if (!collections || !current)
    return (
      <main className="mx-auto flex max-w-5xl items-center gap-2 p-6 text-stone-500">
        <Spinner /> Loading library… (the first load measures every recording, which takes a few seconds)
      </main>
    );

  const all = current.classes;
  const stats = {
    processed: all.filter((c) => c.status === "review" || c.status === "reviewed").length,
    toReview: all.reduce((n, c) => n + c.counts.suggested, 0),
    approved: all.reduce((n, c) => n + c.counts.approved, 0),
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Library</h1>
          <p className="mt-1 text-stone-500">
            {stats.processed} of {all.length} classes processed · <span className={cx(stats.toReview > 0 && "font-medium text-amber-700")}>{stats.toReview} stories to review</span> · {stats.approved} approved
          </p>
        </div>
        <Segmented value={current.key} onChange={setCollection} options={collections.map((c) => ({ value: c.key, label: <>{c.label.replace(/ \(.*\)/, "")} <span className="text-stone-400">{c.classes.length}</span></> }))} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Segmented value={status} onChange={setStatus} options={STATUS_FILTERS.map((f) => ({ ...f }))} />
        <div className="ml-auto flex items-center gap-2">
          <SearchToggle value={search} onChange={setSearch} />
        <IconButton label={sort === "oldest" ? "Oldest first (click for newest first)" : "Newest first (click for oldest first)"} onClick={() => setSort(sort === "oldest" ? "newest" : "oldest")} className="h-9 w-9 border border-stone-200 bg-white">
          {sort === "oldest" ? <CalendarArrowUp className="h-4 w-4" /> : <CalendarArrowDown className="h-4 w-4" />}
        </IconButton>
        </div>
      </div>

      <div className="mt-4 overflow-clip rounded-xl border border-stone-200 bg-white">
        {shown.length === 0 && <p className="p-8 text-center text-stone-500">No classes match these filters.</p>}
        {groups.map(([group, classes]) => (
          <div key={group}>
            {group && <div className="sticky top-14 z-10 border-b border-stone-100 bg-stone-50/95 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500 backdrop-blur">{group}</div>}
            {classes.map((c) => (
              <Row key={c.id} info={c} job={latestJob.get(c.id) ?? null} />
            ))}
          </div>
        ))}
      </div>
    </main>
  );
}

function Row({ info, job }: { info: ClassInfo; job: Job | null }) {
  const [starting, setStarting] = useState(false);
  const [showFile, setShowFile] = useState(false);
  const busy = job && isActive(job);
  const start = async () => {
    setStarting(true);
    try {
      await jobAction({ action: "enqueue", classIds: [info.id], mode: "full" });
      toast(`Started finding stories in “${info.display.title}”`, "success");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setStarting(false);
    }
  };
  const href = `/class?id=${encodeURIComponent(info.id)}`;
  const { display } = info;
  return (
    <div className="group border-b border-stone-100 last:border-0">
      <div className="flex items-center gap-1 pr-3 hover:bg-stone-50">
        <Link href={href} className="flex min-w-0 flex-1 items-center py-2.5 pl-4">
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline gap-2">
              <span className="truncate font-medium text-stone-800">{display.title}</span>
              {display.note && <span className="shrink-0 truncate text-xs text-stone-400">{display.note}</span>}
            </p>
            <p className="flex items-center gap-2 text-xs text-stone-400">
              {display.date && <span className="tabular-nums text-stone-500">{fmtDate(display.date)}</span>}
              <span>{fmtDuration(info.duration)}</span>
              {info.hasVideo && <span className="inline-flex items-center gap-1"><Film className="h-3 w-3" />video</span>}
              {info.number != null && <span className="tabular-nums">#{info.number}</span>}
            </p>
          </div>
        </Link>
        {(info.status === "new" || info.status === "transcribed") && !busy && (
          <Button size="sm" variant="ghost" loading={starting} onClick={start} icon={<Sparkles className="h-3.5 w-3.5" />} className="opacity-0 group-hover:opacity-100 focus:opacity-100">
            Find stories
          </Button>
        )}
        <FileNameToggle open={showFile} onToggle={() => setShowFile(!showFile)} />
        <Link href={href} className="flex items-center gap-2 py-2.5 pl-1" tabIndex={-1} aria-hidden>
          <ClassStatusPill info={info} job={job} />
          <ChevronRight className="h-4 w-4 shrink-0 text-stone-300 group-hover:text-stone-500" />
        </Link>
      </div>
      {showFile && <FileNamePanel info={info} className="mx-4 mb-2.5" />}
    </div>
  );
}

/** a search icon that opens into a search box; stays open while there's a query */
function SearchToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const close = () => {
    onChange("");
    setOpen(false);
  };
  if (!open && !value)
    return (
      <IconButton label="Search" onClick={() => setOpen(true)} className="h-9 w-9 border border-stone-200 bg-white">
        <Search className="h-4 w-4" />
      </IconButton>
    );
  return (
    <div className="relative w-64 max-w-[60vw]">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && close()}
        onBlur={() => !value && setOpen(false)}
        placeholder="Title, date, number or shloka"
        className="h-9 w-full rounded-lg border border-stone-200 bg-white pl-9 pr-8 outline-none placeholder:text-stone-400 focus:border-stone-400"
      />
      <button type="button" aria-label="Clear search" onMouseDown={(e) => e.preventDefault()} onClick={close} className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
