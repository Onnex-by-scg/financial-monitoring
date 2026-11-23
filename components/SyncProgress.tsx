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
  if (!p.steps.length) return "Working…"; // running on another server instance: no step details
  const active = p.steps.filter((s) => s.status === "active");
  if (!active.length) return p.steps.every((s) => s.status !== "pending") ? "Finishing…" : "Starting…";
  return active.map((s) => [s.label, count(s)].filter(Boolean).join(" · ")).join("  ·  ");
}

/**
 * The pull progress bar used everywhere a pull shows progress: brand gradient fill that eases to each new value,
 * a light shimmer sweeping across it, and a soft glow at the leading edge. `value` null = not reported yet
 * (a segment slides across instead).
 */
export function ProgressBar({
  value,
  label,
  size = "md",
  className = "",
}: {
  value: number | null;
  label: string;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const h = size === "md" ? "h-2.5" : size === "sm" ? "h-1.5" : "h-[3px]";
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? undefined}
      className={`relative w-full overflow-hidden rounded-full bg-slate-200/70 ${h} ${className}`}
    >
      {value === null ? (
        <div className="ci-bar progress-slide absolute inset-y-0 left-0 w-1/3 rounded-full" />
      ) : (
        <div
          className="ci-bar relative h-full overflow-hidden rounded-full shadow-[0_0_10px_rgba(3,191,215,0.45)] transition-[width] duration-700 ease-out"
          style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
        >
          <span className="progress-shimmer absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/55 to-transparent" aria-hidden />
        </div>
      )}
    </div>
  );
}

/**
 * The line under a dashboard header: the brand gradient normally, a live progress line while a pull runs
 * (visible wherever the page is scrolled, since the header is sticky).
 */
export function HeaderProgress({ active, progress, source }: { active: boolean; progress: SyncProgressView | null; source: string }) {
  if (!active) return <div className="ci-bar h-[3px]" aria-hidden />;
  return <ProgressBar value={progress ? progressPercent(progress) : null} label={`Pulling from ${source}`} size="xs" className="rounded-none bg-slate-100" />;
}

/**
 * A one-line strip shown above the data while a pull refreshes it: spinner, what it's doing, a bar, the percentage,
 * and when the data on screen was saved. Sits in the page flow, so it never covers the dashboard.
 */
export function RefreshBanner({ source, progress, savedAt }: { source: string; progress: SyncProgressView | null; savedAt: string }) {
  const pct = progress ? progressPercent(progress) : null;
  return (
    <div role="status" className="slide-down flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-brand/15 bg-white/90 px-4 py-2.5 shadow-sm backdrop-blur">
      <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-brand/20 border-t-brand" aria-hidden />
      <p className="min-w-0 flex-1 truncate text-sm">
        <span className="font-semibold text-slate-900">Updating from {source}</span>
        <span className="text-slate-500"> · {progress ? currentActivity(progress) : "starting…"}</span>
      </p>
      <div className="flex w-full items-center gap-3 sm:w-64">
        <ProgressBar value={pct} label={`Updating from ${source}`} size="sm" className="flex-1" />
        <span className="w-9 text-right text-sm font-semibold text-slate-700 tabular-nums">{pct !== null ? `${pct}%` : ""}</span>
      </div>
      <span className="hidden text-xs text-slate-400 lg:inline">Showing data saved {savedAt}</span>
    </div>
  );
}

/**
 * Wraps a dashboard's content. While a pull refreshes it, a progress strip sits above the data (never on top of it);
 * the saved data stays fully visible and usable until the fresh data replaces it.
 */
export function RefreshVeil({
  active,
  source,
  progress,
  savedAt,
  children,
}: {
  active: boolean;
  source: string;
  progress: SyncProgressView | null;
  savedAt: string;
  children: React.ReactNode;
}) {
  return (
    <div aria-busy={active || undefined}>
      {active && (
        <div className="mb-4">
          <RefreshBanner source={source} progress={progress} savedAt={savedAt} />
        </div>
      )}
      {children}
    </div>
  );
}

export function SyncProgress({ progress, source, compact = false }: { progress: SyncProgressView; source: string; compact?: boolean }) {
  const pct = progressPercent(progress);
  const stepNo = progress.steps.findIndex((s) => s.status === "active" || s.status === "pending") + 1 || progress.steps.length;
  const header = `Pulling from ${source} · step ${stepNo} of ${progress.steps.length} · ${progress.seconds} s`;

  const bar = <ProgressBar value={pct} label={`Pulling from ${source}`} size="sm" />;

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

/**
 * The card shown while a tab's first pull runs: spinner, one line of what's happening, and a progress bar
 * (sliding until the server reports progress). The step list is folded away under "Details".
 */
export function FirstPullCard({ source, progress }: { source: string; progress: SyncProgressView | null }) {
  const pct = progress ? progressPercent(progress) : null;
  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200/70 bg-white p-6 shadow-sm" aria-busy>
      <div className="flex items-center gap-4">
        <span className="size-9 shrink-0 animate-spin rounded-full border-[3px] border-brand/15 border-t-brand" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">Loading {source} data</p>
          <p className="truncate text-xs text-slate-500" aria-live="polite">
            {progress ? `${currentActivity(progress)} · ${progress.seconds} s` : "Connecting…"}
          </p>
        </div>
        {pct !== null && <span className="text-sm font-semibold text-slate-700 tabular-nums">{pct}%</span>}
      </div>

      <ProgressBar value={pct} label={`Loading ${source} data`} className="mt-5" />

      {progress && (
        <details className="mt-4 text-xs text-slate-500">
          <summary className="cursor-pointer select-none hover:text-slate-700">Details</summary>
          <StepList progress={progress} />
        </details>
      )}
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

/** If a refresh never shows up as running or finished (e.g. the server stopped it unrecorded), stop waiting after this. */
const GIVE_UP_MS = 60_000;

/**
 * While `active`, polls the progress endpoint every second for a tab; calls onDone when a pull ends.
 * `since` (the tab's last pull time when a refresh started) lets it see a pull end even if it never caught it
 * running, which happens on Netlify: the pull runs on one server instance and the check may land on another.
 */
export function useSyncProgress(
  entity: string | null,
  active: boolean,
  onDone: () => void,
  endpoint = "/api/ar/progress",
  since?: string | null,
): SyncProgressView | null {
  const [progress, setProgress] = useState<SyncProgressView | null>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });
  useEffect(() => {
    if (!entity || !active) return;
    let wasRunning = false;
    let stopped = false;
    let idleSince = Date.now();
    const tick = async () => {
      try {
        const p = (await (await fetch(`${endpoint}?entity=${encodeURIComponent(entity)}`, { cache: "no-store" })).json()) as (
          | SyncProgressView
          | { running: false }
        ) & { lastFinishedAt?: string | null };
        if (stopped) return;
        setProgress(p.running ? (p as SyncProgressView) : null);
        const finishedSince = since !== undefined && Boolean(p.lastFinishedAt) && (p.lastFinishedAt as string) > (since ?? "");
        if (p.running) {
          wasRunning = true;
          idleSince = Date.now();
        } else if (wasRunning || finishedSince || (since !== undefined && Date.now() - idleSince > GIVE_UP_MS)) {
          wasRunning = false;
          idleSince = Date.now();
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
  }, [entity, active, endpoint, since]);
  return progress;
}
