import { PeakError } from "@/lib/peak/client";
import { route } from "@/lib/peak/route-helpers";
import { updateSettings } from "@/lib/peak/settings-store";
import { clampPageSize, clampPageWait, getSyncConfig, MAX_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES } from "@/lib/sync/config";
import { PAGE_WAIT_MAX_SECONDS, PEAK_PAGE_SIZE_MAX, PEAK_PAGE_SIZE_MIN } from "@/lib/settings-types";
import { restartSchedule } from "@/lib/sync/scheduler";

// GET /api/settings/sync -> { enabled, intervalMinutes, skipClosedUat, fromSettings }
// PUT /api/settings/sync { enabled, intervalMinutes, skipClosedUat, peakPageSize?, pageWaitSeconds? } -> saves to the database
// (lib/peak/settings-store.ts). The page fields are optional; left out, the saved values are kept.
// The scheduler re-reads it within 30 seconds; the next round is counted from the save.
export const GET = route(async () => getSyncConfig());

export const PUT = route(async (_req, body) => {
  const minutes = Number(body.intervalMinutes);
  if (!Number.isFinite(minutes) || minutes < MIN_INTERVAL_MINUTES || minutes > MAX_INTERVAL_MINUTES) {
    throw new PeakError(400, `The interval must be between ${MIN_INTERVAL_MINUTES} minutes and ${MAX_INTERVAL_MINUTES / 60} hours.`);
  }
  const current = await getSyncConfig();
  const pageSize = body.peakPageSize === undefined ? current.peakPageSize : Number(body.peakPageSize);
  if (!Number.isInteger(pageSize) || pageSize < PEAK_PAGE_SIZE_MIN || pageSize > PEAK_PAGE_SIZE_MAX) {
    throw new PeakError(400, `Rows per page must be a whole number from ${PEAK_PAGE_SIZE_MIN} to ${PEAK_PAGE_SIZE_MAX}.`);
  }
  const wait = body.pageWaitSeconds === undefined ? current.pageWaitSeconds : Number(body.pageWaitSeconds);
  if (!Number.isFinite(wait) || wait < 0 || wait > PAGE_WAIT_MAX_SECONDS) {
    throw new PeakError(400, `The wait between pages must be from 0 to ${PAGE_WAIT_MAX_SECONDS} seconds.`);
  }
  await updateSettings((s) => {
    s.sync = {
      enabled: body.enabled !== false,
      intervalMinutes: Math.round(minutes),
      skipClosedUat: body.skipClosedUat !== false,
      peakPageSize: clampPageSize(pageSize),
      pageWaitSeconds: clampPageWait(wait),
    };
  });
  restartSchedule();
  return getSyncConfig();
});
