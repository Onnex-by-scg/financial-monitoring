import { PeakError } from "@/lib/peak/client";
import { route } from "@/lib/peak/route-helpers";
import { updateSettings } from "@/lib/peak/settings-store";
import { getSyncConfig, MAX_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES } from "@/lib/sync/config";
import { restartSchedule } from "@/lib/sync/scheduler";

// GET /api/settings/sync -> { enabled, intervalMinutes, skipClosedUat, fromSettings }
// PUT /api/settings/sync { enabled, intervalMinutes, skipClosedUat } -> saves to .peak/settings.json.
// The scheduler re-reads it within 30 seconds; the next round is counted from the save.
export const GET = route(async () => getSyncConfig());

export const PUT = route(async (_req, body) => {
  const minutes = Number(body.intervalMinutes);
  if (!Number.isFinite(minutes) || minutes < MIN_INTERVAL_MINUTES || minutes > MAX_INTERVAL_MINUTES) {
    throw new PeakError(400, `The interval must be between ${MIN_INTERVAL_MINUTES} minutes and ${MAX_INTERVAL_MINUTES / 60} hours.`);
  }
  await updateSettings((s) => {
    s.sync = { enabled: body.enabled !== false, intervalMinutes: Math.round(minutes), skipClosedUat: body.skipClosedUat !== false };
  });
  restartSchedule();
  return getSyncConfig();
});
