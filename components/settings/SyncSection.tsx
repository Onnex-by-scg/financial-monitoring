"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PAGE_WAIT_MAX_SECONDS,
  PEAK_PAGE_SIZE_MAX,
  PEAK_PAGE_SIZE_MIN,
  SYNC_MAX_MINUTES,
  SYNC_MIN_MINUTES,
  type SyncRunView,
  type SyncStatusView,
} from "@/lib/settings-types";
import { api, timeAgo } from "./api";
import { Alert, Button, Card, Toggle } from "./ui";

// Settings → Data sync: how often the sync service pulls PEAK / NetSuite into the database, plus its status.

const PRESETS = [5, 10, 15, 30, 60, 120, 360, 720, 1440];
const PAGE_SIZE_PRESETS = [10, 25, 50, 100];
const WAIT_PRESETS = [0, 2, 5, 10, 30];

type Form = { enabled: boolean; intervalMinutes: number; skipClosedUat: boolean; peakPageSize: number; pageWaitSeconds: number };

export function minutesLabel(m: number): string {
  if (m < 60) return `${m} min`;
  const h = m / 60;
  return Number.isInteger(h) ? `${h} h` : `${Math.floor(h)} h ${m % 60} min`;
}

const clock = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function SyncSection() {
  const [status, setStatus] = useState<SyncStatusView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [custom, setCustom] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pulling, setPulling] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await api.syncStatus();
      setStatus(s);
      setForm(
        (f) =>
          f ?? {
            enabled: s.config.enabled,
            intervalMinutes: s.config.intervalMinutes,
            skipClosedUat: s.config.skipClosedUat,
            peakPageSize: s.config.peakPageSize,
            pageWaitSeconds: s.config.pageWaitSeconds,
          },
      );
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // Loading the status on open (and polling while pulls run) is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const anyRunning = Boolean(status?.tabs.some((t) => t.running));
  useEffect(() => {
    const id = setInterval(() => void refresh(), anyRunning ? 2000 : 15000);
    return () => clearInterval(id);
  }, [refresh, anyRunning]);

  if (loadError) return <Alert kind="err" title="Couldn't load the sync status">{loadError}</Alert>;
  if (!status || !form) return <div className="h-64 animate-pulse rounded-2xl bg-white" />;

  const saved = status.config;
  const dirty =
    form.enabled !== saved.enabled ||
    form.intervalMinutes !== saved.intervalMinutes ||
    form.skipClosedUat !== saved.skipClosedUat ||
    form.peakPageSize !== saved.peakPageSize ||
    form.pageWaitSeconds !== saved.pageWaitSeconds;
  const fetchValid =
    Number.isInteger(form.peakPageSize) &&
    form.peakPageSize >= PEAK_PAGE_SIZE_MIN &&
    form.peakPageSize <= PEAK_PAGE_SIZE_MAX &&
    form.pageWaitSeconds >= 0 &&
    form.pageWaitSeconds <= PAGE_WAIT_MAX_SECONDS;
  const customMinutes = Number(custom);
  const customValid = custom === "" || (Number.isFinite(customMinutes) && customMinutes >= SYNC_MIN_MINUTES && customMinutes <= SYNC_MAX_MINUTES);
  const hasNetSuite = status.tabs.some((t) => t.provider === "netsuite");
  const hasPeak = status.tabs.some((t) => t.provider === "peak");

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await api.saveSync(form);
      await refresh();
      setMessage({
        kind: "ok",
        text: form.enabled ? `Saved. Every tab will be pulled every ${minutesLabel(form.intervalMinutes)}, starting from now.` : "Saved. Scheduled pulls are off.",
      });
    } catch (e) {
      setMessage({ kind: "err", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const pullNow = async () => {
    setPulling(true);
    try {
      await api.syncNow();
      await refresh();
    } finally {
      setPulling(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card
        eyebrow="Connections"
        title="Data sync"
      >
        {status.blockedBy && (
          <div className="mb-4">
            <Alert kind="warn" title="Scheduled pulls are off on this server">
              {status.blockedBy}
            </Alert>
          </div>
        )}

        <div className="space-y-5">
          <Toggle
            checked={form.enabled}
            onChange={(enabled) => setForm({ ...form, enabled })}
            label="Pull on a schedule"
          />

          <fieldset disabled={!form.enabled} className={form.enabled ? "" : "opacity-50"}>
            <legend className="mb-2 text-sm font-medium text-slate-800">Pull every</legend>
            <div className="flex flex-wrap items-center gap-2">
              {PRESETS.map((m) => {
                const on = form.intervalMinutes === m && custom === "";
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setCustom("");
                      setForm({ ...form, intervalMinutes: m });
                    }}
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                      on ? "border-brand bg-brand text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {minutesLabel(m)}
                  </button>
                );
              })}
              <label className="flex items-center gap-2 text-sm text-slate-600">
                or
                <input
                  type="number"
                  inputMode="numeric"
                  min={SYNC_MIN_MINUTES}
                  max={SYNC_MAX_MINUTES}
                  value={custom !== "" ? custom : PRESETS.includes(form.intervalMinutes) ? "" : String(form.intervalMinutes)}
                  placeholder="custom"
                  onChange={(e) => {
                    setCustom(e.target.value);
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= SYNC_MIN_MINUTES && n <= SYNC_MAX_MINUTES) setForm({ ...form, intervalMinutes: Math.round(n) });
                  }}
                  aria-label="Custom interval in minutes"
                  className={`w-24 rounded-lg border bg-white px-2.5 py-1.5 text-sm shadow-sm outline-none focus:ring-4 focus:ring-brand/15 ${
                    customValid ? "border-slate-300 focus:border-brand" : "border-red-400"
                  }`}
                />
                minutes
              </label>
            </div>
            {!customValid && (
              <p className="mt-1.5 text-xs text-red-600">
                Between {SYNC_MIN_MINUTES} minutes and {SYNC_MAX_MINUTES / 60} hours.
              </p>
            )}
            {hasNetSuite && form.intervalMinutes < 15 && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Under 15 minutes adds a lot of NetSuite calls.
              </p>
            )}
          </fieldset>

          {hasPeak && (
            <Toggle
              checked={form.skipClosedUat}
              onChange={(skipClosedUat) => setForm({ ...form, skipClosedUat })}
              label="Skip PEAK UAT while it's closed"
              hint="UAT is open Mon–Fri 08:00–22:00."
            />
          )}

          <ArFetch form={form} setForm={setForm} hasPeak={hasPeak} hasNetSuite={hasNetSuite} />

          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            <Button onClick={save} loading={saving} disabled={!dirty || !customValid || !fetchValid}>
              Save
            </Button>
            {dirty && <span className="text-xs text-slate-500">Unsaved changes</span>}
            {!saved.fromSettings && !dirty && <span className="text-xs text-slate-500">Default: {minutesLabel(saved.intervalMinutes)}</span>}
          </div>
          {message && <Alert kind={message.kind}>{message.text}</Alert>}
        </div>
      </Card>

      <Card
        title="Sync status"
        action={
          <Button variant="secondary" size="sm" onClick={pullNow} loading={pulling} disabled={anyRunning || !status.tabs.length}>
            {anyRunning ? "Pulling…" : "Pull all now"}
          </Button>
        }
      >
        <p className="mb-4 text-sm text-slate-600">
          Next pull:{" "}
          <b className="text-slate-900">
            {status.blockedBy || !saved.enabled ? "off" : status.nextRunAt ? `${clock(status.nextRunAt)} (${inMinutes(status.nextRunAt)})` : "after the server starts"}
          </b>
          {saved.enabled && !status.blockedBy && <span className="text-slate-500"> · every {minutesLabel(saved.intervalMinutes)}</span>}
        </p>

        {!status.tabs.length ? (
          <p className="text-sm text-slate-500">No PEAK company or NetSuite connection yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {status.tabs.map((t) => {
              const last = status.runs.find((r) => r.entityId === t.id && r.kind !== "pnl" && r.status !== "running");
              const lastPnl = status.runs.find((r) => r.entityId === t.id && r.kind === "pnl" && r.status !== "running");
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                  <span className="min-w-40 font-medium text-slate-900">
                    {t.name} <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-500">{t.provider === "netsuite" ? "NS" : "PEAK"}</span>
                  </span>
                  {t.running ? (
                    <span className="flex items-center gap-1.5 text-brand">
                      <span className="size-3 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
                      Pulling now…
                    </span>
                  ) : (
                    <span className="flex flex-col gap-0.5">
                      {last ? <RunSummary run={last} /> : <span className="text-slate-400">Never pulled</span>}
                      {lastPnl && <RunSummary run={lastPnl} />}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {status.runs.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-700 select-none">Recent pulls ({Math.min(status.runs.length, 20)})</summary>
            <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-slate-50 text-left text-[11px] tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Started</th>
                    <th className="px-3 py-2 font-semibold">Tab</th>
                    <th className="px-3 py-2 font-semibold">Why</th>
                    <th className="px-3 py-2 font-semibold">Result</th>
                    <th className="px-3 py-2 text-right font-semibold">Took</th>
                  </tr>
                </thead>
                <tbody>
                  {status.runs.slice(0, 20).map((r) => (
                    <tr key={r.id} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600">{clock(r.startedAt)}</td>
                      <td className="px-3 py-2">
                        {status.tabs.find((t) => t.id === r.entityId)?.name ?? r.entityId}
                        {r.kind === "pnl" && <span className="ml-1.5 text-xs text-slate-500">P&amp;L</span>}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{TRIGGER[r.trigger] ?? r.trigger}</td>
                      <td className="px-3 py-2">
                        <RunResult run={r} />
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap text-slate-500 tabular-nums">
                        {r.finishedAt ? duration(Date.parse(r.finishedAt) - Date.parse(r.startedAt)) : "…"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </Card>
    </div>
  );
}

const TRIGGER: Record<string, string> = { schedule: "Schedule", refresh: "Refresh button", "first-load": "First visit", api: "Pull now / API" };

function RunSummary({ run }: { run: SyncRunView }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 text-slate-600">
      <RunResult run={run} />
      <span className="text-slate-400">·</span>
      <span>{timeAgo(run.finishedAt ?? run.startedAt)}</span>
      <span className="text-slate-400">· {TRIGGER[run.trigger] ?? run.trigger}</span>
    </span>
  );
}

function RunResult({ run }: { run: SyncRunView }) {
  if (run.status === "ok" && run.kind === "pnl") return <span className="text-green-800">✓ P&amp;L{run.mode ? ` ${run.mode}` : ""}: {run.note ?? "done"}</span>;
  if (run.status === "ok")
    return (
      <span className="text-green-800">
        ✓ {run.invoices?.toLocaleString("en-US") ?? 0} open invoices{run.mode ? ` (${run.mode === "update" ? "update" : "full read"})` : ""}
      </span>
    );
  if (run.status === "skipped") return <span className="text-slate-500">– Skipped: {run.note}</span>;
  if (run.status === "partial") return <span className="text-slate-600">… {run.note}</span>;
  if (run.status === "running") return <span className="text-brand">Running…</span>;
  return (
    <span className="text-red-700" title={run.error ?? ""}>
      ⚠ {run.kind === "pnl" ? "P&L failed" : "Failed"}: {(run.error ?? "unknown error").slice(0, 90)}
      {(run.error?.length ?? 0) > 90 ? "…" : ""}
    </span>
  );
}

function inMinutes(iso: string): string {
  const m = Math.round((Date.parse(iso) - Date.now()) / 60000);
  return m <= 0 ? "due now" : `in ${minutesLabel(m)}`;
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

// ---------- AR fetch: page size and spacing ----------

/** One row of preset chips plus a custom number box. */
function NumberChoice({
  label,
  presets,
  value,
  onChange,
  format,
  min,
  max,
  unit,
}: {
  label: string;
  presets: number[];
  value: number;
  onChange: (n: number) => void;
  format: (n: number) => string;
  min: number;
  max: number;
  unit: string;
}) {
  const [custom, setCustom] = useState(presets.includes(value) ? "" : String(value));
  const n = Number(custom);
  const customValid = custom === "" || (Number.isInteger(n) && n >= min && n <= max);
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-slate-800">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        {presets.map((p) => {
          const on = value === p && custom === "";
          return (
            <button
              key={p}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setCustom("");
                onChange(p);
              }}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                on ? "border-brand bg-brand text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {format(p)}
            </button>
          );
        })}
        <label className="flex items-center gap-2 text-sm text-slate-600">
          or
          <input
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            value={custom}
            placeholder="custom"
            onChange={(e) => {
              setCustom(e.target.value);
              const v = Number(e.target.value);
              if (Number.isInteger(v) && v >= min && v <= max) onChange(v);
            }}
            aria-label={`${label}, custom`}
            className={`w-24 rounded-lg border bg-white px-2.5 py-1.5 text-sm shadow-sm outline-none focus:ring-4 focus:ring-brand/15 ${
              customValid ? "border-slate-300 focus:border-brand" : "border-red-400"
            }`}
          />
          {unit}
        </label>
      </div>
      {!customValid && (
        <p className="mt-1.5 text-xs text-red-600">
          {min}–{max} {unit}.
        </p>
      )}
    </div>
  );
}

function ArFetch({
  form,
  setForm,
  hasPeak,
  hasNetSuite,
}: {
  form: Form;
  setForm: (f: Form) => void;
  hasPeak: boolean;
  hasNetSuite: boolean;
}) {
  // A worked example, so the effect of small pages plus a wait is visible before saving.
  const exampleInvoices = 300;
  const pages = Math.ceil(exampleInvoices / form.peakPageSize);
  const waiting = Math.max(0, pages - 1) * form.pageWaitSeconds;
  return (
    <div className="space-y-4 rounded-xl border border-slate-200/80 p-4">
      <p className="text-sm font-semibold text-slate-900">AR fetch</p>
      {hasPeak && (
        <NumberChoice
          label="Invoices per page (PEAK)"
          presets={PAGE_SIZE_PRESETS}
          value={form.peakPageSize}
          onChange={(peakPageSize) => setForm({ ...form, peakPageSize })}
          format={(n) => String(n)}
          min={PEAK_PAGE_SIZE_MIN}
          max={PEAK_PAGE_SIZE_MAX}
          unit="rows"
        />
      )}
      <NumberChoice
        label="Wait between pages"
        presets={WAIT_PRESETS}
        value={form.pageWaitSeconds}
        onChange={(pageWaitSeconds) => setForm({ ...form, pageWaitSeconds })}
        format={(n) => (n === 0 ? "None" : `${n} s`)}
        min={0}
        max={PAGE_WAIT_MAX_SECONDS}
        unit="seconds"
      />
      <div className="space-y-1 text-xs text-slate-500">
        {hasPeak && (
          <p>
            {exampleInvoices} PEAK invoices → {pages} pages
            {waiting > 0 ? `, about ${waiting >= 60 ? `${Math.round(waiting / 6) / 10} min` : `${waiting} s`} of waiting` : ""}.
          </p>
        )}
        {hasNetSuite && <p>NetSuite pages are fixed at 1,000 invoices by its API; the wait applies between them.</p>}
      </div>
    </div>
  );
}

