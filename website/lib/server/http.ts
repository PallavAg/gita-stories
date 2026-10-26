import "server-only";

export function fail(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

/** run a route body, turning thrown errors into a JSON error the UI can show */
export async function handle(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (err) {
    console.error(err);
    return fail(500, (err as Error).message || "Something went wrong on the server");
  }
}
