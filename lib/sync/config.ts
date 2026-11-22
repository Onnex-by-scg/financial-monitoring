import "server-only";
import { readSettings, type SyncSettings } from "../peak/settings-store";
import { SAMPLE_MODE } from "../mode";

// How often the scheduler pulls. Settings → Data sync (saved in the database) wins; otherwise the
// SYNC_INTERVAL_MINUTES env var; otherwise 15 minutes. Sample mode (lib/mode.ts) or SYNC_SCHEDULE=0 turn it off entirely.

export const MIN_INTERVAL_MINUTES = 5;
export const MAX_INTERVAL_MINUTES = 24 * 60;
export const DEFAULT_SYNC: SyncSettings = {
  enabled: true,
  intervalMinutes: clampInterval(Number(process.env.SYNC_INTERVAL_MINUTES) || 15),
  skipClosedUat: true,
};

export function clampInterval(n: number): number {
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(n)));
}

/** Why scheduling is off regardless of Settings, or null. */
export function scheduleBlockedBy(): string | null {
  if (SAMPLE_MODE) return "Sample mode (PEAK_USE_SAMPLE=1): the dashboard shows sample data and never pulls.";
  if (process.env.SYNC_SCHEDULE === "0") return "SYNC_SCHEDULE=0 is set in the server's environment.";
  return null;
}

export async function getSyncConfig(): Promise<SyncSettings & { fromSettings: boolean }> {
  const { settings } = await readSettings();
  const s = settings.sync;
  return s
    ? { enabled: s.enabled, intervalMinutes: clampInterval(s.intervalMinutes), skipClosedUat: s.skipClosedUat ?? true, fromSettings: true }
    : { ...DEFAULT_SYNC, fromSettings: false };
}
