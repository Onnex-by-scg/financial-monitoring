"use client";

// Asking the server for a pull (Refresh, opening a tab whose data is old or missing, Settings → "Pull now").
// On Netlify this calls the background function (netlify/pull-background.ts), which can run for 15 minutes;
// elsewhere the app's own POST /api/pull. The request names only the tab: the keys stay on the server.

export const PULL_VIA: "netlify" | "app" = process.env.NEXT_PUBLIC_PULL_VIA === "netlify" ? "netlify" : "app";

export interface PullTarget {
  kind: "ar" | "pnl" | "all";
  entity?: string | null;
  year?: number | null;
}

/** Returns false when nothing will run (sample mode, or the tab isn't in Settings). Throws if the request failed. */
export async function requestPull(t: PullTarget): Promise<boolean> {
  const q = new URLSearchParams({ kind: t.kind });
  if (t.entity) q.set("entity", t.entity);
  if (t.year) q.set("year", String(t.year));
  const url = PULL_VIA === "netlify" ? `/.netlify/functions/pull-background?${q}` : `/api/pull?${q}`;
  const res = await fetch(url, { method: "POST", cache: "no-store" });
  if (PULL_VIA === "netlify") {
    if (res.status !== 202) throw new Error(`Couldn't start the pull (HTTP ${res.status}).`);
    return true;
  }
  const json = (await res.json().catch(() => ({}))) as { started?: boolean; error?: string };
  if (!res.ok) throw new Error(json.error ?? `Couldn't start the pull (HTTP ${res.status}).`);
  return Boolean(json.started);
}
