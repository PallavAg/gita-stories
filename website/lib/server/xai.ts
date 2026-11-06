import "server-only";
import { Agent, fetch, FormData } from "undici";
import { LLM_MODEL, STT_MODEL, XAI_API_KEY } from "./config";
import { getSettings } from "./settings";

// Transcribing a 2-hour class or reasoning over its transcript can take several minutes before the
// first response byte, longer than Node's built-in fetch waits (5 min), so use our own agent.
const agent = new Agent({ headersTimeout: 20 * 60_000, bodyTimeout: 20 * 60_000, connectTimeout: 30_000 });

export class XaiError extends Error {
  constructor(message: string, readonly status: number | null, readonly retryable: boolean) {
    super(message);
  }
}

const HINTS: Record<number, string> = {
  400: "xAI rejected the request",
  401: "xAI rejected the API key (check XAI_API_KEY in website/.env.local)",
  403: "the API key isn't allowed to use this model, or the account is out of credits",
  404: "model or endpoint not found",
  413: "the audio file is too large for xAI (500 MB limit)",
  429: "rate limited by xAI",
};

async function call(url: string, init: { body: FormData | string; json?: boolean }, signal: AbortSignal) {
  if (!XAI_API_KEY) throw new XaiError("No xAI API key set. Add a line XAI_API_KEY=xai-… to website/.env.local, then restart the server.", null, false);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${XAI_API_KEY}`, ...(init.json ? { "Content-Type": "application/json" } : {}) },
      body: init.body,
      dispatcher: agent,
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    throw new XaiError(`Network error talking to xAI: ${cause?.code ?? cause?.message ?? (err as Error).message}`, null, true);
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 400);
    try {
      const j = JSON.parse(text);
      detail = j.error?.message ?? j.error ?? j.message ?? detail;
    } catch {}
    const hint = HINTS[res.status] ?? (res.status >= 500 ? "xAI server error" : "request failed");
    throw new XaiError(`${hint} (HTTP ${res.status}): ${typeof detail === "string" ? detail : JSON.stringify(detail)}`, res.status, res.status === 429 || res.status >= 500);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new XaiError(`xAI returned something that isn't JSON: ${text.slice(0, 200)}`, res.status, true);
  }
}

/** retry rate limits, server errors and network blips with backoff; give up on anything else straight away */
export async function withRetry<T>(fn: () => Promise<T>, signal: AbortSignal, onRetry?: (msg: string) => void): Promise<T> {
  const waits = [5, 20, 60];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (signal.aborted || !(err instanceof XaiError) || !err.retryable || attempt >= waits.length) throw err;
      onRetry?.(`${err.message} — retrying in ${waits[attempt]}s (attempt ${attempt + 2} of ${waits.length + 1})`);
      await new Promise((r, j) => {
        const t = setTimeout(r, waits[attempt] * 1000);
        signal.addEventListener("abort", () => (clearTimeout(t), j(signal.reason)), { once: true });
      });
    }
  }
}

export type SttWord = { text: string; start: number; end: number; speaker?: number };
export type SttResult = { text: string; language: string; duration: number; words: SttWord[] };

export const KEYTERMS = ["shloka", "Gita", "Krishna", "Arjuna", "Bhagavad Gita", "satsang", "Baba"];
/** xAI's speech-detection threshold (its default); recorded in each transcript */
export const VAD_THRESHOLD = 0.5;

// xAI speech-to-text allows 10 requests a second and 100 at once on the starting tier. Every running class sends
// its own requests (plus up to 6 gap clips at a time), so all of them share these slots to stay under the limits.
const STT_PER_SECOND = 8;
const STT_AT_ONCE = 60;
const sttStarts: number[] = [];
let sttActive = 0;

async function sttSlot(signal: AbortSignal): Promise<() => void> {
  for (;;) {
    if (signal.aborted) throw signal.reason;
    const now = Date.now();
    while (sttStarts.length && now - sttStarts[0] >= 1000) sttStarts.shift();
    if (sttActive < STT_AT_ONCE && sttStarts.length < STT_PER_SECOND) {
      sttStarts.push(now);
      sttActive++;
      return () => void sttActive--;
    }
    await new Promise((r) => setTimeout(r, sttStarts.length >= STT_PER_SECOND ? 1000 - (now - sttStarts[0]) + 5 : 100));
  }
}

export async function speechToText(audio: Buffer, name: string, signal: AbortSignal): Promise<SttResult> {
  const form = new FormData();
  // option fields must come before the file field
  form.append("model", STT_MODEL);
  form.append("diarize", "true");
  form.append("vad_threshold", String(VAD_THRESHOLD));
  form.append("filler_words", String((await getSettings()).fillerWords));
  for (const t of KEYTERMS) form.append("keyterm", t);
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), name);
  const release = await sttSlot(signal);
  let res;
  try {
    res = await call("https://api.x.ai/v1/stt", { body: form }, signal);
  } finally {
    release();
  }
  if (typeof res !== "object" || res === null) throw new XaiError("xAI transcription response wasn't an object", null, true);
  // silence (common for short gap clips) comes back without a words list: that's an empty result, not an error
  return { text: res.text ?? "", language: res.language ?? "", duration: res.duration ?? 0, words: Array.isArray(res.words) ? res.words : [] } as SttResult;
}

export async function chatJson(system: string, user: string, schema: object, signal: AbortSignal) {
  const { reasoningEffort } = await getSettings();
  const res = await call(
    "https://api.x.ai/v1/chat/completions",
    {
      json: true,
      body: JSON.stringify({
        model: LLM_MODEL,
        reasoning_effort: reasoningEffort,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_schema", json_schema: { name: "stories", schema, strict: true } },
      }),
    },
    signal,
  );
  const content = res.choices?.[0]?.message?.content;
  if (!content) throw new XaiError(`Grok returned no content (finish reason: ${res.choices?.[0]?.finish_reason ?? "unknown"})`, null, true);
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new XaiError(`Grok's answer wasn't valid JSON: ${content.slice(0, 200)}`, null, true);
  }
  // cost_in_usd_ticks is in units of 1e-10 USD
  const costUsd = typeof res.usage?.cost_in_usd_ticks === "number" ? res.usage.cost_in_usd_ticks / 1e10 : 0;
  return { parsed, costUsd, usage: res.usage, reasoningEffort };
}
