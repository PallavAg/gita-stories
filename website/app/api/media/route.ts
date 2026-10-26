import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { NextRequest } from "next/server";
import { audioFile, parseClassId, videoFile } from "@/lib/server/library";

export const dynamic = "force-dynamic";

// Streams a class's audio (?kind=audio) or video (?kind=video) with HTTP range support so the
// browser can seek without downloading the whole file.

function resolve(request: NextRequest) {
  const parsed = parseClassId(request.nextUrl.searchParams.get("id") ?? "");
  if (!parsed) return null;
  const video = request.nextUrl.searchParams.get("kind") === "video";
  const file = video ? videoFile(parsed.collection, parsed.rel) : audioFile(parsed.collection, parsed.rel);
  return file ? { file, type: video ? "video/mp4" : "audio/mpeg" } : null;
}

/**
 * File → web stream with backpressure that stops cleanly when the browser drops the request (it does on every
 * seek). Readable.toWeb keeps pushing into the closed stream and crashes the process with "Controller is already closed".
 */
function fileStream(file: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
  const node = createReadStream(file, range);
  return new ReadableStream({
    start(controller) {
      node.on("data", (chunk) => {
        try {
          controller.enqueue(new Uint8Array(chunk as Buffer));
          if ((controller.desiredSize ?? 1) <= 0) node.pause();
        } catch {
          node.destroy();
        }
      });
      node.on("end", () => {
        try {
          controller.close();
        } catch {}
      });
      node.on("error", (err) => {
        try {
          controller.error(err);
        } catch {}
      });
    },
    pull() {
      node.resume();
    },
    cancel() {
      node.destroy();
    },
  });
}

const headers = (size: number, type: string) => ({ "Accept-Ranges": "bytes", "Content-Length": String(size), "Content-Type": type, "Cache-Control": "private, max-age=3600" });

export async function GET(request: NextRequest) {
  const target = resolve(request);
  if (!target) return new Response("Not found", { status: 404 });
  const info = await stat(target.file).catch(() => null);
  if (!info) return new Response("Not found", { status: 404 });

  const range = request.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (!range) return new Response(fileStream(target.file), { headers: headers(info.size, target.type) });

  const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
  if (start > end || start >= info.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
  return new Response(fileStream(target.file, { start, end }), {
    status: 206,
    headers: { ...headers(end - start + 1, target.type), "Content-Range": `bytes ${start}-${end}/${info.size}` },
  });
}

export async function HEAD(request: NextRequest) {
  const target = resolve(request);
  const info = target && (await stat(target.file).catch(() => null));
  if (!target || !info) return new Response(null, { status: 404 });
  return new Response(null, { headers: headers(info.size, target.type) });
}
