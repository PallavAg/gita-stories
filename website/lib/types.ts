// Types shared by the server (API routes) and the browser.

import type { Described } from "./names";

export type CollectionKey = "sunday" | "saturday" | "chapters";

export type ClassStatus = "new" | "transcribed" | "review" | "reviewed";

export type ClassInfo = {
  /** `${collection}/${rel}` — stable id used in URLs and data file paths */
  id: string;
  collection: CollectionKey;
  /** path inside the collection's audio folder, without extension */
  rel: string;
  /** leading number from the file name, for ordering */
  number: number | null;
  /** cleaned-up title from the file name (still the original wording) */
  title: string;
  /** standardised name, series and date worked out from the title (display only, files are never renamed) */
  display: Described;
  /** the file name as it is on disk, e.g. "014 - Chapter 2 - Shlokas 57-65.mp3" */
  fileName: string;
  /** sub-folder, e.g. "CHAPTER 2" (chapters series only) */
  group: string | null;
  duration: number | null;
  hasVideo: boolean;
  transcribed: boolean;
  aiRanAt: string | null;
  counts: { suggested: number; approved: number; rejected: number };
  status: ClassStatus;
};

export type CollectionInfo = { key: CollectionKey; label: string; hasVideo: boolean; classes: ClassInfo[] };

export type StoryStatus = "suggested" | "approved" | "rejected";

export type Story = {
  id: string;
  start: number;
  end: number;
  title: string;
  chapter: string;
  verse: string;
  summary: string;
  /** hand-corrected transcript text; null means use the machine transcript */
  transcriptOverride: string | null;
  status: StoryStatus;
  origin: "ai" | "manual";
  /** what the AI originally said, kept so edits can be compared or reset */
  ai: { start: number; end: number; title: string; chapter: string; verse: string; evidence: string; speaker: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type ClassRecord = {
  classId: string;
  stories: Story[];
  ai: { model: string; ranAt: string; rohitSpeakers: string[]; costUsd: number; promptVersion: number; reasoningEffort?: ReasoningEffort } | null;
  updatedAt: string;
};

/** compact transcript word: [start, end, text, speaker, gap?] — speaker null when unknown; gap = index of the re-transcribed stretch it came from */
export type Word = [number, number, string, number | null, number?];

export type ClassDetail = { info: ClassInfo; record: ClassRecord; words: Word[] | null; rohitSpeakers: number[] };

export type JobMode = "full" | "stories";
export type JobStatus = "queued" | "running" | "done" | "failed" | "canceled" | "interrupted";
export type JobStep = "queued" | "transcribing" | "filling" | "finding" | "saving" | "done";

export type Job = {
  id: string;
  classId: string;
  title: string;
  mode: JobMode;
  status: JobStatus;
  step: JobStep;
  stepDetail: string | null;
  /** 0–1, estimated from elapsed time where the API gives no progress */
  progress: number;
  /** seconds of audio, used for estimates */
  duration: number | null;
  createdAt: string;
  startedAt: string | null;
  stepStartedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  errorStep: JobStep | null;
  cost: { stt: number; llm: number };
  result: { found: number; added: number; kept: number } | null;
};

export type Commit = { sha: string; subject: string; date: string };

export type UpdateStatus = {
  /** false when the folder has no GitHub remote to pull from */
  configured: boolean;
  upstream: string | null;
  current: Commit;
  behind: number;
  ahead: number;
  incoming: Commit[];
  /** tracked files edited locally, which would block a pull */
  localChanges: string[];
  checkedAt: string;
  fetchError: string | null;
};

export type UpdateResult = { updated: boolean; from: string; to: string; commits: Commit[]; installed: boolean; restartNeeded: boolean; log: string };

export type JobsState = {
  jobs: Job[];
  concurrency: number;
  paused: boolean;
  totals: { stt: number; llm: number; runs: number };
};

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

/** app settings saved to stories/settings.json */
export type AppSettings = {
  /** how hard Grok thinks when finding stories (xAI's default is "high") */
  reasoningEffort: ReasoningEffort;
  /** keep "uh", "um" etc. in new transcripts */
  fillerWords: boolean;
};

export type DataStats = {
  dataDir: string;
  transcripts: number;
  classesWithStories: number;
  stories: { suggested: number; approved: number; rejected: number };
  deletedBatches: number;
  version: string | null;
};
