"use client";

import { useEffect, useRef, useState } from "react";
import type { SyncProgress as SyncProgressData, SyncStep } from "@/lib/sync/progress";

// What a running pull (PEAK / NetSuite → database) is doing, step by step: an overall bar, the current activity,
// and the step list. Fed by GET /api/ar/progress, which reads server memory only.

export type SyncProgressView = SyncProgressData & { seconds: number };

const fmt = (n: number) => n.toLocaleString("en-US");

/** Share of a step that's finished (0–1). Without a total, an active step counts as a third done. */
function stepShare(s: SyncStep): number {
  if (s.status === "done" || s.status === "skipped") return 1;
  if (s.status === "pending") return 0;
  return s.total ? Math.min(0.97, s.done / s.total) : 0.33;
}

export function progressPercent(p: SyncProgressView): number {
  if (!p.steps.length) return 3;
  return Math.max(3, Math.round((100 * p.steps.reduce((a, s) => a + stepShare(s), 0)) / p.steps.length));
}

function count(s: SyncStep): string {
  if (!s.done && !s.total) return "";
  const unit = s.unit ?? "";
  return s.total ? `${fmt(Math.min(s.done, s.total))} of ${fmt(s.total)} ${unit}` : `${fmt(s.done)} ${unit}`;
}

/** "Reading outstanding invoices · 2 pages" (several steps can run at once). */
export function currentActivity(p: SyncProgressView): string {
  const active = p.steps.filter((s) => s.status === "active");
  if (!active.length) return p.steps.every((s) => s.status !== "pending") ? "Finishing…" : "Starting…";
  return active.map((s) => [s.label, count(s)].filter(Boolean).join(" · ")).join("  ·  ");
}

export function SyncProgress({ progress, source, compact = false }: { progress: SyncProgressView; source: string; compact?: boolean }) {
  const pct = progressPercent(progress);
  const stepNo = progress.steps.findIndex((s) => s.status === "active" || s.status === "pending") + 1 || progress.steps.length;
  const header = `Pulling from ${source} · step ${stepNo} of ${progress.steps.length} · ${progress.seconds} s`;

  const bar = (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={`Pulling from ${source}`}
      className="h-2 overflow-hidden rounded-full bg-slate-200"
    >
      <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </div>
  );

  if (compact) {
    return (
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <span className="truncate font-semibold text-brand-dark">{currentActivity(progress)}</span>
          <span className="shrink-0 text-brand-dark/70 tabular-nums">
            {pct}% · {progress.seconds} s
          </span>
        </div>
        <div className="mt-1.5">{bar}</div>
        <details className="mt-1 text-xs text-brand-dark/80">
          <summary className="cursor-pointer select-none">All steps</summary>
          <StepList progress={progress} />
        </details>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between gap-3 text-xs text-slate-500">
        <span>{header}</span>
        <span className="font-semibold text-slate-700 tabular-nums">{pct}%</span>
      </div>
      <div className="mt-1.5">{bar}</div>
      <p className="mt-2 text-sm font-semibold text-slate-800" aria-live="polite">
        {currentActivity(progress)}
      </p>
      {progress.note && <p className="mt-1 text-xs text-amber-700">{progress.note}</p>}
      <StepList progress={progress} />
    </div>
  );
}

function StepList({ progress }: { progress: SyncProgressView }) {
  return (
    <ol className="mt-3 space-y-1.5">
      {progress.steps.map((s) => (
        <li key={s.key} className="flex items-start gap-2.5 text-sm">
          <StepIcon status={s.status} />
          <span className={`min-w-0 flex-1 ${s.status === "pending" ? "text-slate-400" : s.status === "skipped" ? "text-slate-400 line-through decoration-slate-300" : "text-slate-700"}`}>
            {s.label}
            {s.note && <span className="block text-xs text-slate-400 no-underline">{s.note}</span>}
          </span>
          <span className="shrink-0 text-xs text-slate-500 tabular-nums">{s.status === "skipped" ? "skipped" : count(s)}</span>
        </li>
      ))}
    </ol>
  );
}

function StepIcon({ status }: { status: SyncStep["status"] }) {
  if (status === "done")
    return (
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-ci-green text-[10px] font-bold text-white" aria-label="done">
        ✓
      </span>
    );
  if (status === "active")
    return <span className="mt-0.5 size-4 shrink-0 animate-spin rounded-full border-2 border-brand border-r-transparent" aria-label="in progress" />;
  if (status === "skipped")
    return (
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] text-slate-500" aria-label="skipped">
        –
      </span>
    );
  return <span className="mt-0.5 size-4 shrink-0 rounded-full border-2 border-slate-200" aria-label="waiting" />;
}

/** While `active`, polls the progress endpoint every second for a tab; calls onDone when a running pull ends. */
export function useSyncProgress(entity: string | null, active: boolean, onDone: () => void, endpoint = "/api/ar/progress"): SyncProgressView | null {
  const [progress, setProgress] = useState<SyncProgressView | null>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });
  useEffect(() => {
    if (!entity || !active) return;
    let wasRunning = false;
    let stopped = false;
    const tick = async () => {
      try {
        const p = (await (await fetch(`${endpoint}?entity=${encodeURIComponent(entity)}`, { cache: "no-store" })).json()) as SyncProgressView | { running: false };
        if (stopped) return;
        setProgress(p.running ? (p as SyncProgressView) : null);
        if (p.running) wasRunning = true;
        else if (wasRunning) {
          wasRunning = false;
          onDoneRef.current();
        }
      } catch {
        // ignore; the main request reports errors
      }
    };
    void tick();
    const id = setInterval(tick, 1000);
    return () => {
      stopped = true;
      clearInterval(id);
      setProgress(null);
    };
  }, [entity, active, endpoint]);
  return progress;
}
