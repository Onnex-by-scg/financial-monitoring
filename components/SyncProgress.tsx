"use client";

import { useEffect, useRef, useState } from "react";
import type { SyncProgress as SyncProgressData, SyncStep } from "@/lib/sync/progress";
import { PULL_VIA, requestPull } from "./pull";

// What a running pull (PEAK / NetSuite → database) is doing, step by step: an overall bar, the current activity,
// and the step list. Fed by GET /api/ar/progress (or /api/pnl/progress), which reads the pull's row in the database.

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

/** Shown above the data while a pull refreshes it in the background: one line, a bar, and the saved time. */
export function RefreshBanner({ source, progress, savedAt }: { source: string; progress: SyncProgressView | null; savedAt: string }) {
  const pct = progress ? progressPercent(progress) : null;
  return (
    <div role="status" className="rise-in rounded-2xl border border-slate-200/70 bg-white/95 px-5 py-4 shadow-xl shadow-slate-900/10 backdrop-blur">
      <div className="flex items-center gap-3">
        <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-brand/20 border-t-brand" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-sm">
          <span className="font-semibold text-slate-900">Updating from {source}</span>
          <span className="text-slate-500"> · {progress ? currentActivity(progress) : "starting…"}</span>
        </p>
        {pct !== null && <span className="text-sm font-semibold text-slate-700 tabular-nums">{pct}%</span>}
      </div>
      <ProgressBar value={pct} label={`Updating from ${source}`} size="sm" className="mt-2.5" />
      <p className="mt-1.5 text-[11px] text-slate-400">Showing data saved {savedAt}</p>
    </div>
  );
}

/**
 * Wraps a dashboard's content. While a pull refreshes it, the saved data is dimmed, blurred and locked
 * (not clickable, skipped by keyboard and screen readers), and the progress card floats on top, staying in
 * view while scrolling. When the pull ends, the fresh data fades back in.
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
    <div className="relative" aria-busy={active || undefined}>
      <div
        inert={active || undefined}
        className={`transition-[opacity,filter] duration-500 ${active ? "pointer-events-none opacity-35 blur-[3px] select-none" : ""}`}
      >
        {children}
      </div>
      {active && (
        <div className="absolute inset-0 z-20 flex justify-center">
          <div className="sticky top-28 h-fit w-full max-w-lg px-4 pt-16">
            <RefreshBanner source={source} progress={progress} savedAt={savedAt} />
          </div>
        </div>
      )}
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

/** How often the page checks a running pull. Slower on Netlify, where every check is a billed request. */
const POLL_MS = PULL_VIA === "netlify" ? 3000 : 1000;
/** A requested pull that never shows up (e.g. the function didn't start) stops being waited for after this. */
const START_TIMEOUT_MS = 90_000;

type ProgressReply = (SyncProgressView & { latestRunId?: number }) | { running: false; latestRunId?: number };

/**
 * Pulls for one dashboard tab. `start()` asks the server for a pull (components/pull.ts); while one is pending, or
 * while `watch` is true (the server says one is running), the progress endpoint is polled. `onDone` runs when a pull
 * ends, so the page can reload its data from the database.
 */
export function usePull({
  entity,
  kind,
  year = null,
  watch,
  onDone,
}: {
  entity: string | null;
  kind: "ar" | "pnl";
  year?: number | null;
  watch: boolean;
  onDone: () => void;
}): { progress: SyncProgressView | null; pending: boolean; start: () => Promise<void>; startError: string | null } {
  const endpoint = kind === "ar" ? "/api/ar/progress" : "/api/pnl/progress";
  const [progress, setProgress] = useState<SyncProgressView | null>(null);
  const [pending, setPending] = useState<{ entity: string; baseline: number; since: number } | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const onDoneRef = useRef(onDone);
  const pendingRef = useRef(pending);
  useEffect(() => {
    onDoneRef.current = onDone;
    pendingRef.current = pending;
  });

  const check = async (id: string): Promise<ProgressReply> =>
    (await (await fetch(`${endpoint}?entity=${encodeURIComponent(id)}`, { cache: "no-store" })).json()) as ProgressReply;

  const start = async () => {
    if (!entity || pendingRef.current) return;
    setStartError(null);
    // The newest pull row before asking: a newer one that has finished means our pull came and went.
    const baseline = await check(entity).then((p) => p.latestRunId ?? 0, () => 0);
    const mine = { entity, baseline, since: Date.now() };
    pendingRef.current = mine;
    setPending(mine);
    try {
      if (!(await requestPull({ kind, entity, year }))) {
        pendingRef.current = null;
        setPending(null);
        onDoneRef.current();
      }
    } catch (e) {
      pendingRef.current = null;
      setPending(null);
      setStartError((e as Error).message);
    }
  };

  const active = Boolean(entity) && (watch || pending?.entity === entity);
  useEffect(() => {
    if (!entity || !active) return;
    let wasRunning = false;
    let stopped = false;
    const finish = () => {
      wasRunning = false;
      pendingRef.current = null;
      setPending(null);
      onDoneRef.current();
    };
    const tick = async () => {
      try {
        const p = await check(entity);
        if (stopped) return;
        setProgress(p.running ? (p as SyncProgressView) : null);
        const mine = pendingRef.current?.entity === entity ? pendingRef.current : null;
        if (p.running) wasRunning = true;
        else if (wasRunning || (mine && (p.latestRunId ?? 0) > mine.baseline)) finish();
        else if (mine && Date.now() - mine.since > START_TIMEOUT_MS) finish();
      } catch {
        // ignore; the page's own request reports errors
      }
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
      setProgress(null);
    };
    // check() only depends on endpoint
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, active, endpoint]);

  return { progress, pending: pending?.entity === entity && entity !== null, start, startError };
}
