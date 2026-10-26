import { handle } from "@/lib/server/http";
import { listLibrary } from "@/lib/server/library";

export const dynamic = "force-dynamic";

export function GET() {
  return handle(async () => Response.json({ collections: await listLibrary() }));
}
