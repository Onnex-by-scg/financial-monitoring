import "server-only";
import { PeakError, type Connection } from "./client";
import { cleanSecret, parseEnv } from "./settings-store";

// Settings routes read and write credentials. The app has no login, so it binds to 127.0.0.1
// (see package.json), and these routes also refuse cross-site requests from other web pages.
function assertSameOrigin(req: Request) {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new PeakError(403, "Cross-site request refused.");
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) throw new PeakError(403, "Cross-origin request refused.");
}

export function route(handler: (req: Request, body: Record<string, unknown>) => Promise<unknown>) {
  return async (req: Request): Promise<Response> => {
    try {
      assertSameOrigin(req);
      let body: Record<string, unknown> = {};
      if (req.method !== "GET" && req.method !== "DELETE") {
        // An empty body (e.g. POST /api/sync from "Pull now") means no fields, not bad JSON.
        const text = await req.text();
        if (text.trim()) {
          try {
            body = (JSON.parse(text) as Record<string, unknown> | null) ?? {};
          } catch {
            throw new PeakError(400, "Invalid JSON body");
          }
        }
      }
      return Response.json(await handler(req, body), { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      const e = err as PeakError;
      const status = err instanceof PeakError ? e.status : 500;
      return Response.json(
        { error: e.message, code: e.code ?? null, test: (e as PeakError & { test?: unknown }).test ?? null },
        { status, headers: { "Cache-Control": "no-store" } },
      );
    }
  };
}

/** Developer credentials from a form. Blank Connect ID / Key keep the saved value. */
export function developerInput(input: unknown, saved?: Connection | null): Connection {
  const b = (input ?? {}) as Record<string, unknown>;
  const env = parseEnv(b.env ?? saved?.env);
  const connectId = cleanSecret(b.connectId, "Connect ID", false) ?? saved?.connectId;
  const connectKey = cleanSecret(b.connectKey, "Connect Key", false) ?? saved?.connectKey;
  if (!connectId) throw new PeakError(400, "Connect ID is required.", "invalid");
  if (!connectKey) throw new PeakError(400, "Connect Key is required.", "invalid");
  return { env, connectId, connectKey };
}

/** Thrown when a save is refused because the connection test failed; the UI can then offer "Save anyway". */
export function testFailed(test: { ok: boolean; message: string }): PeakError {
  const err = new PeakError(422, test.message, "test_failed") as PeakError & { test?: unknown };
  err.test = test;
  return err;
}
