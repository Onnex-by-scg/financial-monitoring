// Netlify background function: runs one pull the dashboard asked for (Refresh, opening a tab whose data is old or
// missing, or Settings → "Pull now"). Netlify answers the browser 202 at once and lets this run for up to 15 minutes,
// so a full NetSuite read (about 4–5 minutes) fits, unlike a normal request (30 s).
//
// Called by the browser (components/pull.ts) as POST /.netlify/functions/pull-background?kind=ar&entity=<id>, so the
// site's team login applies to it like to every other page. The request carries only which tab to pull: the
// PEAK / NetSuite keys are read from the saved settings in the database (DATABASE_URL), inside this function.
//
// Source of truth is this file; `pnpm build` bundles it into netlify/functions/pull-background.mjs
// (scripts/build-functions.mjs), which Netlify deploys. Progress and the result go to the database (SyncRun,
// ArSnapshot, PnlMonth); the page follows them through /api/ar/progress and /api/pnl/progress.

import { parsePullRequest, runPull } from "../lib/sync/pull";

async function pullBackground(req: Request): Promise<Response> {
  // Same rule as the app's API routes: no pulls started from other websites.
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return new Response("Cross-site request refused.", { status: 403 });
  if (req.method !== "POST") return new Response("Use POST.", { status: 405 });

  const started = Date.now();
  try {
    const pull = parsePullRequest(new URL(req.url).searchParams);
    console.log(`[pull] start kind=${pull.kind} entity=${pull.entity ?? "all"} year=${pull.year ?? "-"}`);
    await runPull(pull);
    console.log(`[pull] done in ${Math.round((Date.now() - started) / 1000)} s`);
  } catch (e) {
    console.error("[pull] failed:", (e as Error).message);
  }
  return new Response(null, { status: 202 });
}

export default pullBackground;

export const config = { background: true };
