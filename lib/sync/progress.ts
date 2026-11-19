// Step-by-step progress of a running pull, for the dashboard's loading bar ("what is it doing now").
// The sync service creates one per pull; the PEAK / NetSuite loaders plan their steps and report into it.
// Kept in server memory only and read by GET /api/ar/progress (which never calls PEAK / NetSuite).

export type StepStatus = "pending" | "active" | "done" | "skipped";

export interface SyncStep {
  key: string;
  label: string;
  status: StepStatus;
  /** Units finished (pages, invoices, calls) and the total when known. */
  done: number;
  total: number | null;
  /** What the units are, e.g. "pages", "invoices". */
  unit: string | null;
  note: string | null;
}

export interface SyncProgress {
  running: boolean;
  provider: "peak" | "netsuite";
  startedAt: number;
  finishedAt: number | null;
  steps: SyncStep[];
  /** A line shown above the steps, e.g. why a full read replaced an update. */
  note: string | null;
}

export interface Reporter {
  /** Replaces the planned steps (e.g. NetSuite switching from an update to a full read). */
  plan(steps: { key: string; label: string; unit?: string; total?: number }[], note?: string | null): void;
  start(key: string, total?: number | null): void;
  /** One more unit finished in this step (starts it if it was pending). */
  tick(key: string, n?: number): void;
  setTotal(key: string, total: number | null): void;
  done(key: string, note?: string): void;
  skip(key: string, note?: string): void;
}

const store = new Map<string, SyncProgress>();

export const getSyncProgress = (entityId: string): SyncProgress | null => store.get(entityId) ?? null;

/** A reporter that does nothing (loaders called outside a pull). */
export const noProgress: Reporter = { plan() {}, start() {}, tick() {}, setTotal() {}, done() {}, skip() {} };

/** Every pull ends by writing to the database; the sync service reports this step. */
export const SAVE_STEP = "save";
const saveStep = (): SyncStep => ({ key: SAVE_STEP, label: "Saving to the database", status: "pending", done: 0, total: null, unit: null, note: null });

export function beginProgress(entityId: string, provider: SyncProgress["provider"]): Reporter & { finish(): void } {
  const p: SyncProgress = { running: true, provider, startedAt: Date.now(), finishedAt: null, steps: [saveStep()], note: null };
  store.set(entityId, p);
  const step = (key: string) => p.steps.find((s) => s.key === key);
  return {
    plan(steps, note = null) {
      // Keep the "save" step (added by the sync service) at the end, and keep progress already made on reused keys.
      const old = new Map(p.steps.map((s) => [s.key, s]));
      p.steps = [
        ...steps.map((s): SyncStep => old.get(s.key) ?? { key: s.key, label: s.label, status: "pending", done: 0, total: s.total ?? null, unit: s.unit ?? null, note: null }),
        old.get(SAVE_STEP) ?? saveStep(),
      ];
      p.note = note;
    },
    start(key, total) {
      const s = step(key);
      if (!s) return;
      s.status = "active";
      if (total !== undefined) s.total = total;
    },
    tick(key, n = 1) {
      const s = step(key);
      if (!s) return;
      if (s.status === "pending") s.status = "active";
      s.done += n;
    },
    setTotal(key, total) {
      const s = step(key);
      if (s) s.total = total;
    },
    done(key, note) {
      const s = step(key);
      if (!s) return;
      s.status = "done";
      if (note) s.note = note;
    },
    skip(key, note) {
      const s = step(key);
      if (!s) return;
      s.status = "skipped";
      if (note) s.note = note;
    },
    finish() {
      p.running = false;
      p.finishedAt = Date.now();
    },
  };
}
