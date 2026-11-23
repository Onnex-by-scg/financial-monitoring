import "server-only";
import { after } from "next/server";
import { ON_WORKERS } from "../runtime";

/**
 * Runs a pull that a request started (Refresh, Pull now), never throwing (the pull records its own errors).
 *
 * Node server / Netlify: after() — the response goes out at once and the page polls the progress endpoint.
 * Cloudflare Workers: work after the response is cut about 30 seconds later, too soon for a NetSuite pull, so the
 * request waits for the pull instead. A Worker has no time limit while the browser is still waiting; the page keeps
 * polling progress meanwhile, and gets the fresh data in the answer. (Closing the page cancels the pull.)
 */
export async function runPull(pull: () => Promise<unknown>): Promise<void> {
  const safe = () => pull().then(() => undefined, () => undefined);
  if (ON_WORKERS) await safe();
  else after(safe);
}
