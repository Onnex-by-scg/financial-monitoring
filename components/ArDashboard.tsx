"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BUCKETS,
  KPI_OVERDUE_LIMIT,
  summarize,
  toRow,
  type ArEntity,
  type ArResponse,
  type ArRow,
  type Bucket,
  type ProjectInfo,
  type Provider,
} from "@/lib/ar";
import { explainLoadError } from "@/lib/load-error";
import { BUCKET_STYLE, COLORS, fmtAmount, fmtCompact, fmtDate, fmtDateTime, fmtInt, fmtPct } from "@/lib/format";
import { Donut, HBars, LegendItem, VBars } from "./charts";
import { CustomerPicker, type CustomerOption } from "./CustomerPicker";
import { ProjectPicker } from "./ProjectPicker";
import { AnimatedNumber } from "./AnimatedNumber";
import { AppNav } from "./AppNav";
import { CompanySwitcher } from "./CompanySwitcher";
import { FirstPullCard, HeaderProgress, progressPercent, RefreshVeil, useSyncProgress, type SyncProgressView } from "./SyncProgress";
import { DebugButton, DebugContext, fieldsFor, PROVIDER_LABEL, type DebugSpec } from "./DebugPanel";

type ArGroup = "current" | "overdue";
type KpiGroup = "target" | "over";
// Project slicer value for invoices with no project.
const NO_PROJECT = "__none";
const NO_PROJECTS: ProjectInfo = { groupName: null, items: [], note: null };

type SortKey = "code" | "contactName" | "netAmount" | "remainAmount" | "creditDays" | "durationDays" | "overdueDays" | "dueDate";

export default function ArDashboard() {
  const [entity, setEntity] = useState<string | null>(null);
  const [data, setData] = useState<ArResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; code: string | null; status: number | null } | null>(null);
  // Tabs come from Settings, not from the last AR response, so they stay usable when one tab fails to load.
  const [tabs, setTabs] = useState<ArEntity[] | null>(null);

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

  const [customer, setCustomer] = useState("all");
  const [project, setProject] = useState("all");
  const [arGroups, setArGroups] = useState<ArGroup[]>([]);
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [kpiGroup, setKpiGroup] = useState<KpiGroup | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "overdueDays", dir: -1 });

  // Only the latest request may update the screen: a slow response for a tab the user already left
  // (e.g. PEAK still loading after switching to a NetSuite tab) must not overwrite the current tab.
  const latestRequest = useRef(0);

  const load = useCallback(
    async (opts: { refresh?: boolean } = {}) => {
      const requestId = ++latestRequest.current;
      const isStale = () => requestId !== latestRequest.current;
      setLoading(true);
      setError(null);
      const q = new URLSearchParams();
      if (entity) q.set("entity", entity);
      if (opts.refresh) q.set("refresh", "1");
      try {
        const res = await fetch(`/api/ar?${q}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({ error: `Unexpected response (HTTP ${res.status})` }));
        if (isStale()) return;
        if (!res.ok) throw Object.assign(new Error(json.error ?? `HTTP ${res.status}`), { code: json.code ?? null, status: res.status });
        setData(json as ArResponse);
      } catch (e) {
        if (isStale()) return;
        const code = (e as Error & { code?: string | null }).code ?? null;
        setError({ message: (e as Error).message, code, status: (e as Error & { status?: number }).status ?? null });
        // Keep showing the data only when it's this tab's (a failed refresh); never another tab's numbers under this tab.
        setData((d) => (code !== "not_configured" && d && (!entity || d.entity === entity) ? d : null));
      } finally {
        if (!isStale()) setLoading(false);
      }
    },
    [entity],
  );

  useEffect(() => {
    // Fetching on mount and when the entity or source changes is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const resetFilters = () => {
    setCustomer("all");
    setProject("all");
    setArGroups([]);
    setBucket(null);
    setKpiGroup(null);
    setSearch("");
  };

  const allRows = useMemo(() => (data ? data.invoices.map((i) => toRow(i, data.asOf)) : []), [data]);

  // One entry per customer that has outstanding invoices (from Invoices.contactCode + Contacts/list names).
  const customers = useMemo<CustomerOption[]>(() => {
    const m = new Map<string, CustomerOption>();
    for (const r of allRows) {
      const c = m.get(r.contactCode) ?? { code: r.contactCode, name: r.contactName, amount: 0, overdue: 0, documents: 0, maxOverdueDays: 0 };
      c.amount += r.remainAmount;
      if (r.isOverdue) c.overdue += r.remainAmount;
      c.documents += 1;
      c.maxOverdueDays = Math.max(c.maxOverdueDays, r.overdueDays);
      m.set(r.contactCode, c);
    }
    return [...m.values()];
  }, [allRows]);

  // Slicers (customer, AR group) filter everything. Chart selections (bucket, KPI group) cross-filter too.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter(
      (r) =>
        (customer === "all" || r.contactCode === customer) &&
        (project === "all" || (project === NO_PROJECT ? r.projects.length === 0 : r.projects.some((p) => p.code === project))) &&
        (arGroups.length === 0 || arGroups.includes(r.isOverdue ? "overdue" : "current")) &&
        (!bucket || r.bucket === bucket) &&
        (!kpiGroup || (kpiGroup === "target") === r.onTarget) &&
        (!q || `${r.code} ${r.contactCode} ${r.contactName} ${r.reference} ${r.projects.map((p) => `${p.code} ${p.name}`).join(" ")}`.toLowerCase().includes(q)),
    );
  }, [allRows, customer, project, arGroups, bucket, kpiGroup, search]);

  const s = useMemo(() => summarize(rows), [rows]);

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "th");
      return c * sort.dir || b.overdueDays - a.overdueDays;
    });
    return out;
  }, [rows, sort]);

  const topCustomers = useMemo(() => {
    const m = new Map<string, { name: string; current: number; overdue: number }>();
    for (const r of rows) {
      const e = m.get(r.contactCode) ?? { name: r.contactName, current: 0, overdue: 0 };
      e[r.isOverdue ? "overdue" : "current"] += r.remainAmount;
      m.set(r.contactCode, e);
    }
    return [...m]
      .sort((a, b) => b[1].current + b[1].overdue - (a[1].current + a[1].overdue))
      .slice(0, 8)
      .map(([code, v]) => ({
        key: code,
        label: v.name,
        parts: [
          { name: "Current", value: v.current, color: COLORS.current },
          { name: "Overdue", value: v.overdue, color: COLORS.overdue },
        ],
      }));
  }, [rows]);

  // Every known project with its share of the filtered AR. A split invoice counts in each of its projects by percent.
  const projectInfo = data?.projects ?? NO_PROJECTS;
  const projectStats = useMemo(() => {
    const m = new Map<string, { code: string; name: string; documents: number; current: number; overdue: number }>();
    const entry = (code: string, name: string) => {
      if (!m.has(code)) m.set(code, { code, name, documents: 0, current: 0, overdue: 0 });
      return m.get(code)!;
    };
    for (const p of projectInfo.items) entry(p.code, p.name);
    for (const r of rows) {
      const side = r.isOverdue ? "overdue" : "current";
      let used = 0;
      for (const p of r.projects) {
        const e = entry(p.code, p.name);
        e[side] += (r.remainAmount * p.percent) / 100;
        e.documents += 1;
        used += p.percent;
      }
      if (used < 99.99) {
        const e = entry(NO_PROJECT, "No project");
        e[side] += (r.remainAmount * (100 - Math.max(0, used))) / 100;
        e.documents += 1;
      }
    }
    return [...m.values()]
      .map((e) => ({ ...e, amount: e.current + e.overdue }))
      .sort((a, b) => Number(a.code === NO_PROJECT) - Number(b.code === NO_PROJECT) || b.amount - a.amount || a.name.localeCompare(b.name, "th"));
  }, [rows, projectInfo]);
  const hasProjects = projectStats.some((p) => p.code !== NO_PROJECT);

  const filtersActive = customer !== "all" || project !== "all" || arGroups.length > 0 || bucket || kpiGroup || search;
  const filterText = [
    customer !== "all" && `customer = ${customers.find((c) => c.code === customer)?.name ?? customer}`,
    project !== "all" && `project = ${project === NO_PROJECT ? "No project" : (projectStats.find((p) => p.code === project)?.name ?? project)}`,
    arGroups.length > 0 && `AR group = ${arGroups.join(", ")}`,
    bucket && `bucket = ${BUCKET_STYLE[bucket].label}`,
    kpiGroup && `KPI = ${kpiGroup}`,
    search && `search = "${search}"`,
  ]
    .filter(Boolean)
    .join(" · ");

  // What each chart reads from PEAK and how it computes what it draws (opened by its Debug button).
  const provider: Provider = data?.debug.provider ?? "peak";
  const FIELDS = fieldsFor(provider);
  const base = [FIELDS.status, FIELDS.code, FIELDS.isVoid, FIELDS.remainAmount, FIELDS.netAmount, FIELDS.exchangeRate];
  const asOfRule = `overdueDays = max(0, asOf(${data?.asOf}) − dueDate)`;
  const debug = {
    total: (): DebugSpec => ({
      title: "Total AR outstanding",
      fields: [...base, FIELDS.contactCode],
      formula: ["total = Σ remainAmount × exchangeRate  (over all rows below)", "documents = count(rows)", "customers = count(distinct contactCode)"],
      plotted: { total: s.total, documents: s.documents, customers: s.customers },
      rows,
    }),
    current: (): DebugSpec => ({
      title: "Current (not yet due)",
      fields: [...base, FIELDS.dueDate],
      formula: [asOfRule, "current = Σ remainAmount where overdueDays = 0", "share = current ÷ total"],
      plotted: { current: s.current, total: s.total, share: s.total ? s.current / s.total : null },
      rows: rows.filter((r) => !r.isOverdue),
    }),
    overdue: (): DebugSpec => ({
      title: "Overdue",
      fields: [...base, FIELDS.dueDate],
      formula: [asOfRule, "overdue = Σ remainAmount where overdueDays > 0", "share = overdue ÷ total"],
      plotted: { overdue: s.overdue, total: s.total, share: s.total ? s.overdue / s.total : null },
      rows: rows.filter((r) => r.isOverdue),
    }),
    aging: (): DebugSpec => ({
      title: "Aging bucket",
      fields: [...base, FIELDS.dueDate, FIELDS.contactCode],
      formula: [
        asOfRule,
        "bucket = 0 → Current, 1–30, 31–60, 61–90, > 90",
        "# Docs = count per bucket; # Cust. = distinct contactCode per bucket; Amount = Σ remainAmount per bucket",
      ],
      plotted: s.buckets,
      rows,
    }),
    kpi: (): DebugSpec => ({
      title: "ESCO KPI: Target vs. Over",
      fields: [...base, FIELDS.dueDate, FIELDS.contactCode],
      formula: [
        asOfRule,
        `Target = overdueDays ≤ ${KPI_OVERDUE_LIMIT};  Over = overdueDays > ${KPI_OVERDUE_LIMIT}`,
        "# Docs and Amount = count and Σ remainAmount per group",
        "# Cust.: a customer is Over if ANY of its invoices is Over, otherwise Target",
        "% on target = Target amount ÷ total",
      ],
      plotted: { ...s.kpi, onTargetShare: s.total ? s.kpi.target.amount / s.total : null },
      rows,
    }),
    topCustomers: (): DebugSpec => ({
      title: "Top customers by amount due",
      fields: [...base, FIELDS.dueDate, FIELDS.contactCode, FIELDS.contactName],
      formula: [
        asOfRule,
        "group by contactCode; current / overdue = Σ remainAmount split by overdueDays > 0",
        "sort by current + overdue desc; keep top 8",
        provider === "netsuite" ? "label = inv_customer_name (same response)" : "label = Contacts/list name joined on contactCode",
      ],
      plotted: topCustomers.map((c) => ({ contactCode: c.key, name: c.label, current: c.parts[0].value, overdue: c.parts[1].value })),
      rows,
    }),
    projects: (): DebugSpec => ({
      title: "AR by project",
      fields: [...base, FIELDS.dueDate, FIELDS.projectList, FIELDS.project],
      formula: [
        asOfRule,
        "project amount = Σ remainAmount × percent ÷ 100 over the invoices assigned to it (split invoices count in each project)",
        "current / overdue split by overdueDays > 0; # Docs = invoices touching the project",
        "No project = invoices without a project, plus any share not assigned (percent < 100)",
        "projects with no outstanding invoices are listed with 0",
      ],
      plotted: projectStats,
      rows,
    }),
    documents: (): DebugSpec => ({
      title: "Outstanding documents (table)",
      fields: [...base, FIELDS.issuedDate, FIELDS.dueDate, FIELDS.contactCode, FIELDS.contactName, FIELDS.project, FIELDS.reference, FIELDS.link],
      formula: ["Credit (Days) = dueDate − issuedDate", "Duration (Days) = max(0, asOf − issuedDate)", asOfRule, "cell colour = aging bucket of overdueDays"],
      plotted: sorted.map((r) => ({
        code: r.code,
        contactCode: r.contactCode,
        netAmount: r.netAmount,
        remainAmount: r.remainAmount,
        creditDays: r.creditDays,
        durationDays: r.durationDays,
        overdueDays: r.overdueDays,
        bucket: r.bucket,
      })),
      rows: sorted,
    }),
  };
  const entities = tabs ?? data?.entities ?? [];
  const activeEntity = entity ?? data?.entity ?? entities[0]?.id ?? null;
  const activeProvider: Provider = entities.find((e) => e.id === activeEntity)?.provider ?? provider;
  const syncProgress = useSyncProgress(
    activeEntity,
    loading || Boolean(data?.refreshing),
    () => {
      // A background pull finished: reload this tab from the database (no new pull).
      if (data?.refreshing) void load();
    },
    "/api/ar/progress",
    data?.refreshing ? (data.lastSync?.at ?? null) : undefined,
  );

  return (
    <div className="min-h-screen bg-[#F3F6FA] text-ink">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/90 backdrop-blur" style={{ viewTransitionName: "site-header" }}>
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-start gap-x-5 gap-y-3 px-6 py-3 md:flex-nowrap">
          <div className="flex min-w-0 flex-1 basis-full flex-wrap items-center gap-x-5 gap-y-3 md:basis-0">
          {entities.length > 0 && (
            <>
              <CompanySwitcher
                items={entities}
                value={activeEntity}
                onChange={(id) => {
                  setEntity(id);
                  resetFilters();
                }}
              />
              <span className="hidden h-8 w-px bg-slate-200 xl:block" aria-hidden />
            </>
          )}
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              <span className="text-brand">AR</span> <span className="text-aqua">·</span> ESCO
            </h1>
            <p className="text-xs text-slate-500">
              Last updated <span className="font-medium text-slate-700">{data ? fmtDateTime(data.fetchedAt) : "–"}</span>
              {data && (
                <>
                  {" · "}aged as of <span className="font-medium text-slate-700">{fmtDate(data.asOf)}</span>
                </>
              )}
              {data?.businessName && (
                <>
                  {" · "}
                  {provider === "netsuite" ? "subsidiary" : "business"} <span className="font-medium text-slate-700">{data.businessName}</span>
                </>
              )}
            </p>
          </div>


          <div className="ml-auto flex flex-wrap items-center gap-2">
            <SourceBadge data={data} />
            <button
              type="button"
              onClick={() => load({ refresh: true })}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshIcon spinning={loading} />
              {loading || data?.refreshing ? (syncProgress ? `Pulling… ${progressPercent(syncProgress)}%` : "Loading…") : "Refresh"}
            </button>
            <Link
              href="/settings"
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-slate-50"
              title="PEAK and NetSuite connections"
            >
              <GearIcon />
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
        <HeaderProgress active={Boolean(data?.refreshing || syncProgress)} progress={syncProgress} source={PROVIDER_LABEL[activeProvider]} />
      </header>

      <main className="mx-auto max-w-[1600px] px-6 py-5">
        {error?.code === "not_configured" && <ConnectPrompt message={error.message} />}
        {!error && data?.syncError && !data.refreshing && (
          <LoadErrorCard
            error={data.syncError}
            provider={activeProvider}
            staleSince={data.fetchedAt}
            failedAt={data.syncError.at}
            loading={loading}
            onRetry={() => load({ refresh: true })}
          />
        )}
        {error && error.code !== "not_configured" && (
          <LoadErrorCard
            error={error}
            provider={activeProvider}
            staleSince={data && data.entity === activeEntity ? data.fetchedAt : null}
            loading={loading}
            onRetry={() => load({ refresh: true })}
          />
        )}
        {data?.warnings.map((w) => (
          <div key={w} className="slide-down mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            ⚠ {w}
          </div>
        ))}

        {!data && loading && !error && <LoadingSkeleton provider={activeProvider} progress={syncProgress} />}

        {data && (
          <DebugContext.Provider value={{ data, filters: filterText }}>
            <RefreshVeil active={Boolean(data.refreshing)} source={PROVIDER_LABEL[activeProvider]} progress={syncProgress} savedAt={fmtDateTime(data.fetchedAt)}>
            <div key={data.entity} className={`space-y-5 transition-opacity duration-300 ${loading ? "opacity-60" : ""}`}>
              {/* Filters: one row above everything they filter */}
              <section aria-label="Filters" className="rounded-2xl border border-slate-200/70 bg-white p-3 shadow-sm rise-in" style={{ "--d": "0ms" } as React.CSSProperties}>
                {/* Row 1: who and what (pickers + search). Row 2: AR group and Aging on one line. */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="w-full sm:w-72">
                    <CustomerPicker options={customers} value={customer} onChange={setCustomer} />
                  </div>

                  {hasProjects && (
                    <div className="w-full sm:w-72">
                      <ProjectPicker options={projectStats} value={project} onChange={setProject} noProjectCode={NO_PROJECT} />
                    </div>
                  )}

                  <label className="relative min-w-[200px] flex-1">
                    <span className="sr-only">Search</span>
                    <SearchIcon />
                    <input
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search document, customer, project…"
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white pr-3 pl-9 text-sm shadow-sm"
                    />
                  </label>

                  {filtersActive && (
                    <button type="button" onClick={resetFilters} className="rounded-lg px-3 py-2 text-sm font-semibold text-brand hover:bg-brand-soft">
                      Clear filters
                    </button>
                  )}
                </div>

                <div className="mt-3 flex items-center gap-3 overflow-x-auto border-t border-slate-100 pt-3 whitespace-nowrap lg:gap-5">
                  <div className="flex shrink-0 items-center gap-2.5">
                    <span className="hidden text-[11px] font-semibold tracking-wide text-slate-400 uppercase lg:inline">AR group</span>
                    <div role="group" aria-label="AR group" className="flex gap-1 rounded-lg bg-slate-100 p-1">
                      {(["current", "overdue"] as const).map((g) => {
                        const on = arGroups.includes(g);
                        return (
                          <button
                            key={g}
                            type="button"
                            aria-pressed={on}
                            onClick={() => setArGroups(on ? arGroups.filter((x) => x !== g) : [...arGroups, g])}
                            className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-semibold capitalize transition lg:px-3 ${
                              on ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"
                            }`}
                          >
                            <span className="inline-block size-2 rounded-full" style={{ background: g === "current" ? COLORS.current : COLORS.overdue }} />
                            {g}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <span className="h-6 w-px shrink-0 bg-slate-200" aria-hidden />

                  <div className="flex shrink-0 items-center gap-2.5">
                    <span className="hidden text-[11px] font-semibold tracking-wide text-slate-400 uppercase lg:inline">Aging</span>
                    <div role="group" aria-label="Aging bucket" className="flex gap-1 rounded-lg bg-slate-100 p-1">
                      {BUCKETS.map((b) => {
                        const on = bucket === b;
                        return (
                          <button
                            key={b}
                            type="button"
                            aria-pressed={on}
                            onClick={() => setBucket(on ? null : b)}
                            className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-semibold transition lg:px-3 ${
                              on ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"
                            }`}
                          >
                            <span className="inline-block size-2 rounded-full" style={{ background: BUCKET_STYLE[b].color }} />
                            {BUCKET_STYLE[b].label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>

              {/* Headline numbers */}
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-brand to-[#1C7FD6] p-5 text-white shadow-sm rise-in" style={{ "--d": "60ms" } as React.CSSProperties}>
                  <div className="pointer-events-none absolute -right-12 -bottom-16 size-40 rounded-full bg-white/10" aria-hidden />
                  <div className="relative flex items-start justify-between gap-2">
                    <div className="text-sm font-medium text-blue-100">Total AR outstanding (THB)</div>
                    <DebugButton spec={debug.total} tone="dark" />
                  </div>
                  <AnimatedNumber value={s.total} format={fmtAmount} className="relative mt-3 block text-3xl font-bold tracking-tight tabular-nums" />
                  <div className="relative mt-3 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-white/20" aria-hidden>
                    <div className="bar-anim h-full bg-white" style={{ width: `${share(s.current, s.total)}%` }} />
                    <div className="bar-anim h-full bg-[#FF8A95]" style={{ width: `${share(s.overdue, s.total)}%` }} />
                  </div>
                  <div className="relative mt-2 text-xs text-blue-100">
                    {fmtInt(s.documents)} documents · {fmtInt(s.customers)} customers
                  </div>
                </div>
                <Kpi
                  label="Current (not yet due)"
                  icon={<ClockIcon />}
                  value={s.current}
                  format={fmtAmount}
                  delay={120}
                  share={share(s.current, s.total)}
                  sub={`${fmtPct(s.current, s.total)} of AR`}
                  color={COLORS.current}
                  debug={debug.current}
                />
                <Kpi
                  label="Overdue"
                  icon={<AlertIcon />}
                  value={s.overdue}
                  format={fmtAmount}
                  delay={180}
                  share={share(s.overdue, s.total)}
                  sub={`${fmtPct(s.overdue, s.total)} of AR`}
                  color={COLORS.overdue}
                  debug={debug.overdue}
                />
                <Kpi
                  label={`KPI: ≤ ${KPI_OVERDUE_LIMIT} days overdue`}
                  icon={<CheckIcon />}
                  value={s.total ? (100 * s.kpi.target.amount) / s.total : NaN}
                  format={pctText}
                  delay={240}
                  share={share(s.kpi.target.amount, s.total)}
                  sub={`✓ ${fmtInt(s.kpi.target.documents)} on target · ⚠ ${fmtInt(s.kpi.over.documents)} over`}
                  color={COLORS.target}
                  debug={debug.kpi}
                />
              </section>

              {/* Aging + ESCO KPI */}
              <section className="grid gap-5 *:min-w-0 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] rise-in" style={{ "--d": "300ms" } as React.CSSProperties}>
                <Card title="Aging bucket" subtitle="Click a bar or row to filter" debug={debug.aging}>
                  <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <VBars
                      bars={s.buckets.map((b) => ({
                        key: b.bucket,
                        label: BUCKET_STYLE[b.bucket].label,
                        value: b.amount,
                        color: BUCKET_STYLE[b.bucket].color,
                        detail: `${fmtInt(b.documents)} documents · ${fmtInt(b.customers)} customers · ${fmtPct(b.amount, s.total)} of AR`,
                      }))}
                      format={fmtCompact}
                      selected={bucket}
                      onSelect={(k) => setBucket(bucket === k ? null : (k as Bucket))}
                      height={300}
                    />
                    <div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-[11px] tracking-wide text-slate-500 uppercase">
                            <th className="py-2 font-semibold">Bucket</th>
                            <th className="py-2 text-right font-semibold">Docs</th>
                            <th className="py-2 text-right font-semibold">Cust.</th>
                            <th className="py-2 text-right font-semibold">Amount (THB)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.buckets.map((b) => {
                            const on = bucket === b.bucket;
                            return (
                              <tr
                                key={b.bucket}
                                onClick={() => setBucket(on ? null : b.bucket)}
                                className={`cursor-pointer border-b border-slate-100 transition ${on ? "bg-slate-100" : "hover:bg-slate-50"} ${
                                  bucket && !on ? "opacity-50" : ""
                                }`}
                              >
                                <td className="py-2">
                                  <span className="flex items-center gap-2">
                                    <span className="inline-block size-2.5 rounded-full" style={{ background: BUCKET_STYLE[b.bucket].color }} />
                                    {BUCKET_STYLE[b.bucket].label}
                                  </span>
                                </td>
                                <td className="py-2 text-right tabular-nums">{fmtInt(b.documents)}</td>
                                <td className="py-2 text-right tabular-nums">{fmtInt(b.customers)}</td>
                                <td className="py-2 text-right tabular-nums">{fmtAmount(b.amount)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="font-semibold">
                            <td className="pt-2.5">Total</td>
                            <td className="pt-2.5 text-right tabular-nums">{fmtInt(s.documents)}</td>
                            <td className="pt-2.5 text-right tabular-nums">{fmtInt(s.customers)}</td>
                            <td className="pt-2.5 text-right tabular-nums">{fmtAmount(s.total)}</td>
                          </tr>
                        </tfoot>
                      </table>
                      <p className="mt-3 text-xs text-slate-500">Customers are counted once per bucket, so the column adds up to more than the total.</p>
                    </div>
                  </div>
                </Card>

                <Card title="ESCO KPI" subtitle={`ลูกหนี้ไม่เกินกำหนดชำระ หรือค้างชำระไม่เกิน ${KPI_OVERDUE_LIMIT} วัน`} debug={debug.kpi}>
                  <div className="flex flex-col gap-5">
                    <div className="flex flex-col items-center gap-2">
                      <Donut
                        size={170}
                        thickness={24}
                        slices={[
                          {
                            key: "target",
                            label: "Target",
                            icon: "✓",
                            value: s.kpi.target.amount,
                            color: COLORS.target,
                            detail: `${s.kpi.target.documents} documents`,
                          },
                          {
                            key: "over",
                            label: "Over",
                            icon: "⚠",
                            value: s.kpi.over.amount,
                            color: COLORS.over,
                            detail: `${s.kpi.over.documents} documents`,
                          },
                        ]}
                        format={fmtAmount}
                        selected={kpiGroup}
                        onSelect={(k) => setKpiGroup(kpiGroup === k ? null : (k as KpiGroup))}
                        center={
                          <>
                            <span className="text-xl font-bold tabular-nums">{fmtPct(s.kpi.target.amount, s.total)}</span>
                            <span className="text-[11px] text-slate-500">on target</span>
                          </>
                        }
                      />
                      <div className="flex gap-3">
                        <LegendItem color={COLORS.target} icon="✓" label="Target" />
                        <LegendItem color={COLORS.over} icon="⚠" label="Over" />
                      </div>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-[11px] tracking-wide text-slate-500 uppercase">
                          <th className="py-2 font-semibold">Group</th>
                          <th className="py-2 text-right font-semibold">Docs</th>
                          <th className="py-2 text-right font-semibold">Cust.</th>
                          <th className="py-2 text-right font-semibold">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(["target", "over"] as const).map((g) => {
                          const k = s.kpi[g];
                          const on = kpiGroup === g;
                          return (
                            <tr
                              key={g}
                              onClick={() => setKpiGroup(on ? null : g)}
                              className={`cursor-pointer border-b border-slate-100 ${on ? "bg-slate-100" : "hover:bg-slate-50"} ${kpiGroup && !on ? "opacity-50" : ""}`}
                            >
                              <td className="py-2">
                                <KpiLabel group={g} />
                              </td>
                              <td className="py-2 text-right tabular-nums">{fmtInt(k.documents)}</td>
                              <td className="py-2 text-right tabular-nums">{fmtInt(k.customers)}</td>
                              <td className="py-2 text-right tabular-nums">{fmtAmount(k.amount)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="font-semibold">
                          <td className="pt-2.5">Total</td>
                          <td className="pt-2.5 text-right tabular-nums">{fmtInt(s.documents)}</td>
                          <td className="pt-2.5 text-right tabular-nums">{fmtInt(s.customers)}</td>
                          <td className="pt-2.5 text-right tabular-nums">{fmtAmount(s.total)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </Card>
              </section>

              {/* Who and what the AR is for */}
              <section className={`grid gap-5 *:min-w-0 ${hasProjects ? "xl:grid-cols-2" : ""} rise-in`} style={{ "--d": "380ms" } as React.CSSProperties}>
                <Card
                  title="Top customers by amount due"
                  subtitle="Click a customer to filter"
                  debug={debug.topCustomers}
                  actions={
                    <div className="flex gap-3">
                      <LegendItem color={COLORS.current} label="Current" />
                      <LegendItem color={COLORS.overdue} label="Overdue" />
                    </div>
                  }
                >
                  {topCustomers.length ? (
                    <HBars rows={topCustomers} format={fmtCompact} selected={customer === "all" ? null : customer} onSelect={(k) => setCustomer(customer === k ? "all" : k)} />
                  ) : (
                    <Empty />
                  )}
                  {!hasProjects && <p className="mt-3 text-xs text-slate-500">Projects: {projectInfo.note ?? "no invoice is assigned to a project."}</p>}
                </Card>

                {hasProjects && (
                  <ProjectsCard
                    stats={projectStats}
                    info={projectInfo}
                    total={s.total}
                    selected={project === "all" ? null : project}
                    onSelect={(k) => setProject(project === k ? "all" : k)}
                    debug={debug.projects}
                  />
                )}
              </section>

              <div className="rise-in" style={{ "--d": "460ms" } as React.CSSProperties}>
                <DocumentTable rows={sorted} sort={sort} setSort={setSort} total={s.total} debug={debug.documents} />
              </div>
            </div>
            </RefreshVeil>
          </DebugContext.Provider>
        )}
      </main>
      <footer className="ci-bar mt-6 flex items-center justify-between px-6 py-2 text-xs text-white">
        <span>ONNEX by SCG CONFIDENTIAL © 2026 - Do Not Distribute</span>
        <span className="font-semibold tracking-wide">ONNEX by SCG</span>
      </footer>
    </div>
  );
}


/** "61.1%", or "–" when there is no AR to divide by. */
const pctText = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : "–");

/** Percentage (0–100) of a part, for share bars. */
const share = (part: number, total: number) => (total > 0 ? Math.max(0, Math.min(100, (100 * part) / total)) : 0);

function DocumentTable({
  rows,
  sort,
  setSort,
  total,
  debug,
}: {
  rows: ArRow[];
  sort: { key: SortKey; dir: 1 | -1 };
  setSort: (s: { key: SortKey; dir: 1 | -1 }) => void;
  total: number;
  debug: () => DebugSpec;
}) {
  const cols: { key: SortKey; label: string; num?: boolean }[] = [
    { key: "code", label: "Document" },
    { key: "contactName", label: "Customer" },
    { key: "netAmount", label: "Amount (THB)", num: true },
    { key: "remainAmount", label: "Amount due (THB)", num: true },
    { key: "creditDays", label: "Credit (days)", num: true },
    { key: "durationDays", label: "Duration (days)", num: true },
    { key: "overdueDays", label: "Overdue (days)", num: true },
    { key: "dueDate", label: "Due date" },
  ];
  const netTotal = rows.reduce((a, r) => a + r.netAmount, 0);

  return (
    <Card
      title="Outstanding documents"
      subtitle={`${fmtInt(rows.length)} documents · click a column to sort`}
      debug={debug}
      actions={
        <div className="hidden flex-wrap gap-3 md:flex">
          {BUCKETS.slice(1).map((b) => (
            <LegendItem key={b} color={BUCKET_STYLE[b].color} label={`Overdue ${BUCKET_STYLE[b].label}`} />
          ))}
        </div>
      }
    >
      <div className="-mx-5 -mb-5 max-h-[600px] overflow-auto rounded-b-2xl border-t border-slate-200">
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] tracking-wide text-slate-500 uppercase">
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={`border-b border-slate-200 px-4 py-2.5 font-semibold ${c.num ? "text-right" : "text-left"}`}>
                  <button
                    type="button"
                    className={`inline-flex items-center gap-1 uppercase hover:text-slate-900 ${sort.key === c.key ? "text-slate-900" : ""}`}
                    onClick={() => setSort({ key: c.key, dir: sort.key === c.key ? (-sort.dir as 1 | -1) : c.num ? -1 : 1 })}
                  >
                    {c.label}
                    <span aria-hidden className="w-2 text-brand">
                      {sort.key === c.key ? (sort.dir === 1 ? "▲" : "▼") : ""}
                    </span>
                  </button>
                </th>
              ))}
              <th className="border-b border-slate-200 px-4 py-2.5 text-left font-semibold">Project / Ref.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className="border-b border-slate-100 transition hover:bg-brand-soft/40">
                <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                  {r.link ? (
                    <a href={r.link} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                      {r.code}
                    </a>
                  ) : (
                    r.code
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <div className="leading-snug text-slate-900">{r.contactName}</div>
                  <div className="text-xs text-slate-400">{r.contactCode}</div>
                </td>
                <td className="px-4 py-2.5 text-right text-slate-600 tabular-nums">{fmtAmount(r.netAmount)}</td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmtAmount(r.remainAmount)}</td>
                <td className="px-4 py-2.5 text-right text-slate-600 tabular-nums">{r.creditDays}</td>
                <td className="px-4 py-2.5 text-right text-slate-600 tabular-nums">{r.durationDays}</td>
                <td className="px-4 py-2.5 text-right" title={BUCKET_STYLE[r.bucket].label}>
                  <span
                    className={`inline-flex min-w-11 justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
                      BUCKET_STYLE[r.bucket].cell || "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {r.overdueDays}
                  </span>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap text-slate-600 tabular-nums">{fmtDate(r.dueDate)}</td>
                <td className="px-4 py-2.5 text-slate-600">
                  {r.projects.length ? (
                    r.projects.map((p) => (
                      <div key={p.code} className="whitespace-nowrap text-slate-800" title={p.code}>
                        {p.name}
                        {p.percent < 100 && <span className="text-slate-400"> {p.percent}%</span>}
                      </div>
                    ))
                  ) : (
                    <div className="text-slate-400">–</div>
                  )}
                  {r.reference && <div className="text-xs text-slate-400">Ref. {r.reference}</div>}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={9}>
                  <Empty />
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="sticky bottom-0 bg-white font-semibold shadow-[0_-1px_0_#e2e8f0]">
            <tr>
              <td className="px-4 py-2.5" colSpan={2}>
                Total
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">{fmtAmount(netTotal)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{fmtAmount(total)}</td>
              <td colSpan={5} />
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

type ProjectStat = { code: string; name: string; documents: number; current: number; overdue: number; amount: number };

function ProjectsCard({
  stats,
  info,
  total,
  selected,
  onSelect,
  debug,
}: {
  stats: ProjectStat[];
  info: ProjectInfo;
  total: number;
  selected: string | null;
  onSelect: (code: string) => void;
  debug: () => DebugSpec;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const top = stats.filter((p) => p.amount > 0).slice(0, 8);
  const label = (p: ProjectStat) => (p.code === NO_PROJECT ? "No project" : p.name);
  return (
    <Card
      title="AR by project"
      subtitle={`${info.groupName ? `PEAK classification group “${info.groupName}” · ` : ""}Click a project to filter`}
      debug={debug}
      actions={
        <div role="group" aria-label="View" className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5 text-xs font-semibold">
          {(["chart", "table"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`rounded-md px-2.5 py-1 capitalize transition ${view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
            >
              {v}
            </button>
          ))}
        </div>
      }
    >
      {view === "chart" ? (
        <>
          <div className="mb-2 flex gap-3">
            <LegendItem color={COLORS.current} label="Current" />
            <LegendItem color={COLORS.overdue} label="Overdue" />
          </div>
          {top.length ? (
            <HBars
              rows={top.map((p) => ({
                key: p.code,
                label: label(p),
                parts: [
                  { name: "Current", value: p.current, color: COLORS.current },
                  { name: "Overdue", value: p.overdue, color: COLORS.overdue },
                ],
              }))}
              format={fmtCompact}
              selected={selected}
              onSelect={onSelect}
            />
          ) : (
            <Empty />
          )}
        </>
      ) : (
        <div className="max-h-[360px] overflow-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-[11px] tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold">Project</th>
                <th className="border-b border-slate-200 px-3 py-2 text-right font-semibold">Docs</th>
                <th className="border-b border-slate-200 px-3 py-2 text-right font-semibold">Overdue</th>
                <th className="border-b border-slate-200 px-3 py-2 text-right font-semibold">Amount due</th>
                <th className="border-b border-slate-200 px-3 py-2 text-right font-semibold">Share</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((p) => {
                const on = selected === p.code;
                return (
                  <tr
                    key={p.code}
                    onClick={() => onSelect(p.code)}
                    className={`cursor-pointer border-b border-slate-100 ${on ? "bg-slate-100" : "hover:bg-slate-50"} ${
                      selected && !on ? "opacity-50" : ""
                    } ${p.amount ? "" : "text-slate-400"}`}
                  >
                    <td className="px-3 py-2">
                      {p.code !== NO_PROJECT && <span className="mr-1.5 text-slate-400">{p.code}</span>}
                      {label(p)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtInt(p.documents)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtAmount(p.overdue)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{fmtAmount(p.amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtPct(p.amount, total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">
        {fmtInt(stats.filter((p) => p.code !== NO_PROJECT).length)} projects
        {view === "chart" ? " · top 8 with an amount due shown; switch to Table for all" : " · projects with nothing outstanding are greyed out"}. An
        invoice split between projects counts in each by its percent.
      </p>
    </Card>
  );
}

/** "Couldn't load" banner in plain language; the server's own message is under Technical details. */
function LoadErrorCard({
  error,
  provider,
  staleSince,
  failedAt,
  loading,
  onRetry,
}: {
  error: { message: string; status: number | null };
  provider: Provider;
  staleSince: string | null;
  failedAt?: string;
  loading: boolean;
  onRetry: () => void;
}) {
  const info = explainLoadError(error.message, error.status, provider);
  return (
    <div role="alert" className="slide-down mb-4 rounded-2xl border border-red-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-ci-red" aria-hidden>
          <AlertIcon />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-900">
            {failedAt ? `Last update failed (${fmtDateTime(failedAt)}): ` : ""}
            {info.title}
          </h2>
          <p className="mt-1 text-sm text-slate-600">{info.meaning}</p>
          {staleSince && (
            <p className="mt-1 text-sm text-slate-600">
              The numbers below are the last ones saved, at <b>{fmtDateTime(staleSince)}</b>.
            </p>
          )}
          <div className="mt-3 text-sm">
            <div className="font-semibold text-slate-800">What you can do</div>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-slate-700">
              {info.steps.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
          </div>
          <details className="mt-3 text-xs text-slate-500">
            <summary className="cursor-pointer select-none hover:text-slate-700">Technical details</summary>
            <div className="mt-1.5 rounded-lg bg-slate-50 p-3 font-mono break-words whitespace-pre-wrap text-slate-700">
              {PROVIDER_LABEL[provider]}
              {error.status ? ` · HTTP ${error.status}` : ""}
              {"\n"}
              {error.message}
            </div>
          </details>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onRetry}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
          >
            <RefreshIcon spinning={loading} light />
            {loading ? "Trying…" : "Try again"}
          </button>
          {info.settings && (
            <Link href="/settings" className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold shadow-sm hover:bg-slate-50">
              Open Settings
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceBadge({ data }: { data: ArResponse | null }) {
  if (!data) return null;
  const { label, style } = {
    sample: { label: "Sample data", style: "bg-amber-100 text-amber-900" },
    "peak-uat": { label: "PEAK · UAT", style: "bg-violet-100 text-violet-900" },
    "peak-production": { label: "PEAK · Production", style: "bg-emerald-100 text-emerald-900" },
    "netsuite-sandbox": { label: "NetSuite · Sandbox", style: "bg-violet-100 text-violet-900" },
    "netsuite-production": { label: "NetSuite · Production", style: "bg-emerald-100 text-emerald-900" },
  }[data.source];
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>{label}</span>;
}

function KpiLabel({ group }: { group: KpiGroup }) {
  return group === "target" ? (
    <span className="inline-flex items-center gap-1.5 font-medium text-green-800">
      <span className="inline-block size-2.5 rounded-full" style={{ background: COLORS.target }} />✓ Target
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 font-medium text-red-800">
      <span className="inline-block size-2.5 rounded-full" style={{ background: COLORS.over }} />⚠ Over
    </span>
  );
}

function Card({
  title,
  subtitle,
  debug,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  debug?: () => DebugSpec;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3">
          {actions}
          {debug && <DebugButton spec={debug} />}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Headline tile: icon, value, a share bar (part of total AR) and a line of context. */
function Kpi({
  label,
  icon,
  value,
  format,
  share: pct,
  sub,
  color,
  delay = 0,
  debug,
}: {
  label: string;
  icon: React.ReactNode;
  value: number;
  format: (n: number) => string;
  share: number;
  sub: string;
  color: string;
  /** Entrance delay (ms), so the tiles rise one after another. */
  delay?: number;
  debug?: () => DebugSpec;
}) {
  return (
    <div className="rise-in rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm" style={{ "--d": `${delay}ms` } as React.CSSProperties}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 text-sm font-medium text-slate-600">
          <span className="flex size-8 items-center justify-center rounded-lg" style={{ background: `${color}1A`, color }} aria-hidden>
            {icon}
          </span>
          {label}
        </div>
        {debug && <DebugButton spec={debug} />}
      </div>
      <AnimatedNumber value={value} format={format} className="mt-3 block text-[26px] leading-tight font-bold tracking-tight tabular-nums" />
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        <div className="bar-anim h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="mt-2 text-xs text-slate-500">{sub}</div>
    </div>
  );
}

function Empty() {
  return <div className="py-8 text-center text-sm text-slate-500">No outstanding documents match these filters.</div>;
}

const iconProps = { viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function ClockIcon() {
  return (
    <svg {...iconProps} className="size-4.5">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6.5V10l2.5 1.8" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg {...iconProps} className="size-4.5">
      <path d="M10 3.2 2.8 16h14.4L10 3.2Z" />
      <path d="M10 8.2v3.4M10 13.9v.1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg {...iconProps} className="size-4.5">
      <circle cx="10" cy="10" r="7" />
      <path d="m7.2 10.2 1.9 1.9 3.8-4" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg {...iconProps} className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden>
      <circle cx="9" cy="9" r="5.5" />
      <path d="m13.2 13.2 3.3 3.3" />
    </svg>
  );
}

function RefreshIcon({ spinning, light = false }: { spinning: boolean; light?: boolean }) {
  return (
    <svg {...iconProps} className={`size-4 ${light ? "text-white" : "text-slate-500"} ${spinning ? "animate-spin" : ""}`} aria-hidden>
      <path d="M16.2 10a6.2 6.2 0 1 1-1.9-4.5" />
      <path d="M16.2 3.8v3.6h-3.6" />
    </svg>
  );
}

function LoadingSkeleton({ provider, progress }: { provider: Provider; progress: SyncProgressView | null }) {
  return (
    <div className="space-y-5">
      <FirstPullCard source={PROVIDER_LABEL[provider]} progress={progress} />
      <div className="grid animate-pulse gap-4 opacity-60 xl:grid-cols-4" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-2xl bg-white" />
        ))}
      </div>
    </div>
  );
}

function GearIcon() {
  // Heroicons "cog-6-tooth" (20px solid)
  return (
    <svg viewBox="0 0 20 20" className="size-4 text-slate-500" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
      />
    </svg>
  );
}

/** Shown instead of the dashboard until PEAK or NetSuite is set up in Settings. */
function ConnectPrompt({ message }: { message: string }) {
  return (
    <div className="mx-auto mt-10 max-w-xl rounded-2xl bg-white p-8 text-center shadow-sm">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-soft text-2xl">🔌</div>
      <h2 className="mt-4 text-xl font-bold">Connect PEAK or NetSuite</h2>
      <p className="mt-2 text-sm text-slate-600">{message}</p>
      <p className="mt-1 text-sm text-slate-500">
        PEAK needs the developer credentials (Connect ID and Connect Key) and a User Token per company. NetSuite needs the Account ID and the four
        token-based authentication keys.
      </p>
      <Link href="/settings" className="mt-6 inline-block rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">
        Start setup →
      </Link>
    </div>
  );
}
