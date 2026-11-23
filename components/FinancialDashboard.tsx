"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtAcct, fmtDateTime, fmtMillions, PNL_COLORS } from "@/lib/format";
import { explainLoadError } from "@/lib/load-error";
import { addTotals, MONTH_SHORT, PNL_LABEL, PNL_LINES, summarizePnl, type PnlLine, type PnlResponse } from "@/lib/pnl";
import { AppNav } from "./AppNav";
import { CompanySwitcher } from "./CompanySwitcher";
import { ProfitBars, QuarterBars, RevenueMarginChart, Waterfall, type WaterfallStep } from "./pnl-charts";
import { FirstPullCard, HeaderProgress, progressPercent, RefreshVeil, useSyncProgress, type SyncProgressView } from "./SyncProgress";

// Financial Performance: monthly P&L for one PEAK company. Read from the database, which the sync service fills from
// PEAK's trial balance (lib/sync/pnl-sync.ts).

type Tab = { id: string; name: string; provider: "peak" | "netsuite" };

const pctOf = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "–");

export default function FinancialDashboard() {
  const [tabs, setTabs] = useState<Tab[] | null>(null);
  const [entity, setEntity] = useState<string | null>(null);
  // null = this year (decided by the server, which also says which year that is)
  const [year, setYear] = useState<number | null>(null);
  const [data, setData] = useState<PnlResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; code: string | null } | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { companies?: { id: string; name: string }[]; netsuite?: { id: string; name: string }[] } | null) => {
        if (!s) return;
        setTabs([
          ...(s.companies ?? []).map((c) => ({ id: c.id, name: c.name, provider: "peak" as const })),
          ...(s.netsuite ?? []).map((n) => ({ id: n.id, name: n.name, provider: "netsuite" as const })),
        ]);
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(
    async (refresh = false) => {
      const id = ++latest.current;
      setLoading(true);
      setError(null);
      const q = new URLSearchParams();
      if (year) q.set("year", String(year));
      if (entity) q.set("entity", entity);
      if (refresh) q.set("refresh", "1");
      try {
        const res = await fetch(`/api/pnl?${q}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({ error: `Unexpected response (HTTP ${res.status})` }));
        if (id !== latest.current) return;
        if (!res.ok) throw Object.assign(new Error(json.error ?? `HTTP ${res.status}`), { code: json.code ?? null });
        setData(json as PnlResponse);
      } catch (e) {
        if (id !== latest.current) return;
        setError({ message: (e as Error).message, code: (e as Error & { code?: string | null }).code ?? null });
        setData((d) => (d && d.entity === entity && (year === null || d.year === year) ? d : null));
      } finally {
        if (id === latest.current) setLoading(false);
      }
    },
    [entity, year],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading is driven by the selected tab and year
    void load();
  }, [load]);

  const activeEntity = entity ?? data?.entity ?? tabs?.find((t) => t.provider === "peak")?.id ?? null;
  const refreshing = Boolean(data?.refreshing);
  const progress = useSyncProgress(
    activeEntity,
    loading || refreshing,
    () => {
      // A background pull finished: reload from the database (no new pull).
      if (refreshing) void load();
    },
    "/api/pnl/progress",
    refreshing ? (data?.lastSync?.at ?? null) : undefined,
  );
  const view = useMemo(() => (data ? buildView(data) : null), [data]);
  const cy = data?.currentYear;
  const years = cy ? [cy, cy - 1, cy - 2] : [];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 bg-white/95 shadow-sm backdrop-blur" style={{ viewTransitionName: "site-header" }}>
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-start gap-x-5 gap-y-3 px-6 py-3 md:flex-nowrap">
          <div className="flex min-w-0 flex-1 basis-full flex-wrap items-center gap-x-5 gap-y-3 md:basis-0">
          {tabs && tabs.length > 0 && (
            <>
              <CompanySwitcher
                items={tabs.map((t) => ({
                  id: t.id,
                  name: t.name,
                  provider: t.provider,
                  disabledReason: t.provider === "netsuite" ? "No profit & loss in NetSuite's API" : undefined,
                }))}
                value={activeEntity}
                onChange={setEntity}
              />
              <span className="hidden h-8 w-px bg-slate-200 xl:block" aria-hidden />
            </>
          )}
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              <span className="text-brand">Financial</span> <span className="text-aqua">·</span> Performance
            </h1>
            <p className="text-xs text-slate-500">
              {data?.businessName ?? data?.entityName ?? "–"} · Updated <span className="font-medium text-slate-700">{data ? fmtDateTime(data.fetchedAt) : "–"}</span>
            </p>
          </div>


          <div className="ml-auto flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Year
              <select
                value={year ?? data?.year ?? ""}
                onChange={(e) => setYear(Number(e.target.value))}
                className="h-[34px] rounded-md border border-slate-300 bg-white px-2 text-sm font-medium text-slate-900"
              >
                {years.map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </select>
            </label>
            <span className="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white">Unit: THB</span>
            {data?.source === "sample" && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">Sample data</span>}
            <button
              type="button"
              onClick={() => load(true)}
              disabled={loading || refreshing}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
            >
              {loading || refreshing ? (progress ? `Pulling… ${progressPercent(progress)}%` : "Loading…") : "Refresh"}
            </button>
            <Link href="/settings" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
              Settings
            </Link>
          </div>
          </div>
          {/* The page switch has its own slot, outside the wrapping row above, so nothing on the page can move it:
              top-right on wide screens, first row on phones. Same on every dashboard page (the active tab glides). */}
          <div className="order-first w-full md:order-none md:mt-2 md:w-auto md:shrink-0">
            <AppNav />
          </div>
        </div>
        <HeaderProgress active={Boolean(refreshing || progress)} progress={progress} source="PEAK" />
      </header>

      <main className="mx-auto max-w-[1600px] space-y-5 px-6 py-5">
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
            <div className="font-semibold">Couldn&apos;t load the profit &amp; loss from PEAK</div>
            <div className="mt-1 break-words">{error.message}</div>
            {error.code === "not_configured" ? (
              <Link href="/settings" className="mt-2 inline-block font-semibold underline">
                Open Settings
              </Link>
            ) : (
              <div className="mt-2 text-red-800">PEAK UAT is only open Mon–Fri 08:00–22:00 (Bangkok).</div>
            )}
          </div>
        )}
        {!error && data?.syncError && !refreshing && <SyncErrorNote error={data.syncError} onRetry={() => load(true)} />}
        {data?.warnings.map((w) => (
          <div key={w} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {w}
          </div>
        ))}

        {loading && !view && <Skeleton progress={progress} />}
        {view && data && view.months.length === 0 && <div className="rounded-xl bg-white p-8 text-center text-slate-500 shadow-sm">No months to show for {data.year}.</div>}

        {view && data && view.months.length > 0 && (
          <RefreshVeil active={refreshing} source="PEAK" progress={progress} savedAt={fmtDateTime(data.fetchedAt)}>
          <div className={`space-y-5 ${loading ? "opacity-60" : ""}`}>
            {/* KPI tiles */}
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi icon={<ChartIcon />} tone="cobalt" label="Revenue" value={fmtMillions(view.year.revenue)} unit="Million THB" sub={`${fmtAcct(view.year.revenue)} THB`} />
              <Kpi
                icon={<CoinsIcon />}
                tone={view.year.netProfit < 0 ? "red" : "cobalt"}
                label={view.year.netProfit < 0 ? "Net Loss" : "Net Profit"}
                value={fmtMillions(view.year.netProfit)}
                unit="Million THB"
                sub={`${fmtAcct(view.year.netProfit)} THB`}
              />
              <Kpi
                icon={<PieIcon />}
                tone="teal"
                label="Cost of Sales / Revenue"
                value={pctOf(view.year.costOfSales, view.year.revenue).replace("%", "")}
                unit="%"
                sub={`${fmtAcct(view.year.costOfSales)} / ${fmtAcct(view.year.revenue)} THB`}
              />
              <Kpi
                icon={<PercentIcon />}
                tone={view.year.netProfit < 0 ? "red" : "teal"}
                label="Net Profit Margin"
                value={pctOf(view.year.netProfit, view.year.revenue).replace("%", "")}
                unit="%"
                sub={`${fmtAcct(view.year.netProfit)} / ${fmtAcct(view.year.revenue)} THB`}
              />
            </section>

            <section className="grid gap-5 xl:grid-cols-2">
              <Card title={`Monthly Revenue & Net Profit Margin – ${data.year}`} unit="THB / %">
                <RevenueMarginChart labels={view.labels} revenue={view.months.map((m) => m.revenue)} margin={view.months.map((m) => (m.revenue ? (m.netProfit / m.revenue) * 100 : null))} />
                <Legend items={[{ color: PNL_COLORS.revenue, label: "Revenue (THB)" }, { color: PNL_COLORS.profit, label: "Net Profit Margin (%)", line: true }]} />
              </Card>
              <Card title={`Monthly Net Profit – ${data.year}`} unit="THB">
                <ProfitBars labels={view.labels} values={view.months.map((m) => m.netProfit)} height={340} />
                <Legend items={[{ color: PNL_COLORS.profit, label: "Profit" }, { color: PNL_COLORS.loss, label: "Loss (shown in brackets)" }]} />
              </Card>
            </section>

            <section className="grid gap-5 xl:grid-cols-3">
              <Card title="Quarterly Revenue vs Net Profit" unit="THB">
                <QuarterBars labels={view.quarters.map((q) => q.label)} revenue={view.quarters.map((q) => q.revenue)} profit={view.quarters.map((q) => q.netProfit)} />
                <Legend items={[{ color: PNL_COLORS.revenue, label: "Revenue (THB)" }, { color: PNL_COLORS.profit, label: "Net Profit (THB)" }]} />
                {view.quarters.some((q) => q.partial) && <p className="mt-1 text-center text-xs text-slate-500">* Quarter in progress: months so far only.</p>}
              </Card>
              <Card title="Waterfall: From Revenue to Net Profit" unit="THB">
                <Waterfall steps={view.waterfall} />
              </Card>
              <Card title="Financial Summary" unit="THB">
                <SummaryTable s={view.year} />
              </Card>
            </section>

            <AccountsCard data={data} />
          </div>
          </RefreshVeil>
        )}
      </main>

      <footer className="ci-bar mt-6 flex items-center justify-between px-6 py-2 text-xs font-medium text-white">
        <span>ONNEX by SCG CONFIDENTIAL © 2026 - Do Not Distribute</span>
        <span className="font-bold">ONNEX by SCG</span>
      </footer>
    </div>
  );
}

function buildView(data: PnlResponse) {
  const months = data.months.map((m) => ({ month: m.month, ...summarizePnl(m.totals) }));
  const labels = data.months.map((m) => MONTH_SHORT[Number(m.month.slice(5)) - 1]);
  const year = summarizePnl(addTotals(data.months));
  const quarters = [0, 1, 2, 3]
    .map((q) => {
      const ms = data.months.filter((m) => Math.floor((Number(m.month.slice(5)) - 1) / 3) === q);
      const s = summarizePnl(addTotals(ms));
      const first = MONTH_SHORT[q * 3];
      const last = MONTH_SHORT[q * 3 + 2];
      return { label: `Q${q + 1}${ms.length && ms.length < 3 ? "*" : ""}<br>(${first} – ${last})`, partial: ms.length > 0 && ms.length < 3, has: ms.length > 0, ...s };
    })
    .filter((q) => q.has);
  const waterfall: WaterfallStep[] = [
    { label: "Revenue", kind: "total", value: year.revenue },
    { label: "Cost of<br>Sales", kind: "minus", value: year.costOfSales },
    { label: "Gross<br>Profit", kind: "total", value: year.grossProfit },
    { label: "Operating<br>Expenses", kind: "minus", value: year.operatingExpenses },
    { label: "Finance<br>Cost", kind: "minus", value: year.financeCost },
    ...(year.incomeTax ? [{ label: "Income<br>Tax", kind: "minus" as const, value: year.incomeTax }] : []),
    { label: "Net<br>Profit", kind: "total", value: year.netProfit },
  ];
  return { months, labels, year, quarters, waterfall };
}

function SummaryTable({ s }: { s: ReturnType<typeof summarizePnl> }) {
  const rows: { label: string; value: number; cost?: boolean }[] = [
    { label: "Revenue", value: s.revenue },
    { label: "Cost of Sales", value: s.costOfSales, cost: true },
    { label: "Gross Profit", value: s.grossProfit },
    { label: "Operating Expenses", value: s.operatingExpenses, cost: true },
    { label: "Operating Profit (EBIT)", value: s.ebit },
    { label: "Finance Cost", value: s.financeCost, cost: true },
    ...(s.incomeTax ? [{ label: "Income Tax", value: s.incomeTax, cost: true }] : []),
  ];
  return (
    <table className="w-full overflow-hidden rounded-lg text-sm">
      <thead>
        <tr className="bg-brand text-left text-xs text-white">
          <th className="px-3 py-2 font-semibold">No.</th>
          <th className="px-3 py-2 font-semibold">Item</th>
          <th className="px-3 py-2 text-right font-semibold">Amount</th>
          <th className="px-3 py-2 text-right font-semibold">% of Revenue</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.label} className="border-b border-slate-100">
            <td className="px-3 py-2 text-slate-500">{i + 1}</td>
            <td className="px-3 py-2">{r.label}</td>
            <td className={`px-3 py-2 text-right font-semibold tabular-nums ${r.cost || r.value < 0 ? "text-ci-red" : "text-[#0E8F9C]"}`}>
              {fmtAcct(r.cost ? r.value : r.value)}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">{pctOf(r.value, s.revenue)}</td>
          </tr>
        ))}
        <tr className="ci-bar text-white">
          <td className="px-3 py-2.5 font-bold">{rows.length + 1}.</td>
          <td className="px-3 py-2.5 text-base font-bold">{s.netProfit < 0 ? "Net Loss" : "Net Profit"}</td>
          <td className="px-3 py-2.5 text-right text-base font-bold tabular-nums">{fmtAcct(s.netProfit)}</td>
          <td className="px-3 py-2.5 text-right text-base font-bold tabular-nums">{pctOf(s.netProfit, s.revenue)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** Every income and expense account that fed the numbers, with the rule that put it on its line. */
function AccountsCard({ data }: { data: PnlResponse }) {
  const byAccount = new Map<string, { code: string; name: string; line: PnlLine; rule: string; amount: number }>();
  for (const m of data.months)
    for (const a of m.accounts) {
      const cur = byAccount.get(a.code) ?? { ...a, amount: 0 };
      cur.amount += a.amount;
      byAccount.set(a.code, cur);
    }
  const accounts = [...byAccount.values()].sort((a, b) => PNL_LINES.indexOf(a.line) - PNL_LINES.indexOf(b.line) || a.code.localeCompare(b.code));
  return (
    <details className="rounded-xl bg-white p-5 shadow-sm">
      <summary className="cursor-pointer text-sm font-semibold text-slate-900">
        Accounts used ({accounts.length}) <span className="font-normal text-slate-500">· how the PEAK trial balance was mapped to each line</span>
      </summary>
      <p className="mt-3 text-xs text-slate-500">
        Source: <code>GET {data.debug.baseUrl}/api/v1/FinancialReports/trialbalance?fromMonth=yyyyMM&amp;toMonth=yyyyMM</code>, one call per month; amount =
        the month&apos;s <code>change</code> (income: credit − debit, expenses: debit − credit). Balance-sheet accounts (1xxxxx–3xxxxx) are left out.
      </p>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            <th className="py-1.5 pr-3">Line</th>
            <th className="py-1.5 pr-3">Account</th>
            <th className="py-1.5 pr-3">Name</th>
            <th className="py-1.5 pr-3">Why</th>
            <th className="py-1.5 text-right">{data.year} total (THB)</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.code} className="border-b border-slate-100">
              <td className="py-1.5 pr-3">{PNL_LABEL[a.line]}</td>
              <td className="py-1.5 pr-3 tabular-nums">{a.code}</td>
              <td className="py-1.5 pr-3">{a.name}</td>
              <td className="py-1.5 pr-3 text-xs text-slate-500">{a.rule}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtAcct(a.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function Card({ title, unit, children }: { title: string; unit?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl bg-white p-5 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {unit && <span className="text-xs text-slate-500">({unit})</span>}
      </div>
      {children}
    </section>
  );
}

function Legend({ items }: { items: { color: string; label: string; line?: boolean }[] }) {
  return (
    <div className="mt-2 flex flex-wrap justify-center gap-4 text-xs text-slate-600">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.line ? (
            <span className="relative inline-block h-0.5 w-5" style={{ background: i.color }}>
              <span className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-white" style={{ borderColor: i.color }} />
            </span>
          ) : (
            <span className="inline-block size-2.5 rounded-sm" style={{ background: i.color }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

const TONES = {
  cobalt: { circle: "bg-brand", text: "text-ink" },
  teal: { circle: "bg-[#0E8F9C]", text: "text-[#0B6F79]" },
  red: { circle: "bg-ci-red", text: "text-ci-red" },
};

function Kpi({ icon, tone, label, value, unit, sub }: { icon: React.ReactNode; tone: keyof typeof TONES; label: string; value: string; unit: string; sub: string }) {
  return (
    <div className="flex items-center gap-4 rounded-xl bg-white p-5 shadow-sm">
      <div className={`grid size-14 shrink-0 place-items-center rounded-full text-white ${TONES[tone].circle}`}>{icon}</div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-700">{label}</div>
        <div className={`flex items-baseline gap-1.5 ${TONES[tone].text}`}>
          <span className="text-3xl font-bold tabular-nums">{value}</span>
          <span className="text-sm font-medium">{unit}</span>
        </div>
        <div className="truncate text-xs text-slate-500 tabular-nums">{sub}</div>
      </div>
    </div>
  );
}

/** Last pull failed: the months shown are the ones saved before it. */
function SyncErrorNote({ error, onRetry }: { error: { message: string; status: number | null; at: string }; onRetry: () => void }) {
  const info = explainLoadError(error.message, error.status, "peak");
  return (
    <div role="alert" className="flex flex-wrap items-start gap-4 rounded-xl border border-red-200 bg-white p-4 text-sm shadow-sm">
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-slate-900">
          Last update failed ({fmtDateTime(error.at)}): {info.title}
        </div>
        <p className="mt-1 text-slate-600">{info.meaning} The numbers below are the last ones saved.</p>
        <details className="mt-2 text-xs text-slate-500">
          <summary className="cursor-pointer select-none">Technical details</summary>
          <div className="mt-1 font-mono break-words whitespace-pre-wrap text-slate-700">{error.message}</div>
        </details>
      </div>
      <button type="button" onClick={onRetry} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
        Try again
      </button>
    </div>
  );
}

function Skeleton({ progress }: { progress: SyncProgressView | null }) {
  return (
    <div className="space-y-5" aria-busy>
      <FirstPullCard source="PEAK" progress={progress} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-white shadow-sm" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="h-96 animate-pulse rounded-xl bg-white shadow-sm" />
        ))}
      </div>
    </div>
  );
}

const iconProps = { width: 26, height: 26, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
const ChartIcon = () => (
  <svg {...iconProps}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
);
const CoinsIcon = () => (
  <svg {...iconProps}>
    <ellipse cx="10" cy="6" rx="6" ry="3" />
    <path d="M4 6v6c0 1.7 2.7 3 6 3s6-1.3 6-3V6M4 12v6c0 1.7 2.7 3 6 3 1.2 0 2.3-.2 3.2-.5" />
    <circle cx="18" cy="17" r="4" />
  </svg>
);
const PieIcon = () => (
  <svg {...iconProps}>
    <path d="M21 12A9 9 0 1 1 12 3v9z" />
    <path d="M15 3.5A9 9 0 0 1 20.5 9H15z" />
  </svg>
);
const PercentIcon = () => (
  <svg {...iconProps}>
    <path d="M19 5 5 19" />
    <circle cx="7" cy="7" r="2.5" />
    <circle cx="17" cy="17" r="2.5" />
  </svg>
);
