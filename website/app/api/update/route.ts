import { fail, handle } from "@/lib/server/http";
import { getState } from "@/lib/server/jobs";
import { pullUpdate, updateStatus } from "@/lib/server/update";

export const dynamic = "force-dynamic";

/** check GitHub for newer commits */
export function GET() {
  return handle(async () => Response.json(await updateStatus(true)));
}

/** pull the latest code */
export function POST() {
  return handle(async () => {
    const running = (await getState()).jobs.filter((j) => j.status === "running" || j.status === "queued").length;
    if (running) return fail(409, `Wait for the ${running} AI ${running === 1 ? "run" : "runs"} to finish (or cancel them) before updating.`);
    return Response.json(await pullUpdate());
  });
}
