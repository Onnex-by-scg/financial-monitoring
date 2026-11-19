"use client";

import { useMemo } from "react";
import type { Data, Layout, Shape } from "plotly.js";
import { CI, fmtAcct, PNL_COLORS } from "@/lib/format";
import { Plot } from "./Plot";

// Financial Performance charts (Plotly). Every chart has a value label on its marks and the same numbers sit in the
// Financial Summary table, so colour is never the only way to read a value. Losses are red and in (parentheses).

const pct = (v: number | null) => (v === null ? "" : `${v.toFixed(1)}%`);
const axisFont = { size: 11, color: CI.ink2 };

/**
 * Monthly revenue (bars, top) and net profit margin (line, bottom) on one shared month axis.
 * Two stacked panels rather than two y-axes over one plot area, so neither scale can be misread against the other.
 */
export function RevenueMarginChart({ labels, revenue, margin }: { labels: string[]; revenue: number[]; margin: (number | null)[] }) {
  const data = useMemo<Data[]>(
    () => [
      {
        type: "bar",
        name: "Revenue (THB)",
        x: labels,
        y: revenue,
        text: revenue.map(fmtAcct),
        textposition: "outside",
        cliponaxis: false,
        constraintext: "none",
        textfont: { size: 11, color: CI.ink2 },
        marker: { color: PNL_COLORS.revenue },
        hovertemplate: "<b>%{x}</b><br>Revenue: %{text} THB<extra></extra>",
      },
      {
        type: "scatter",
        mode: "text+lines+markers",
        name: "Net Profit Margin (%)",
        x: labels,
        y: margin,
        yaxis: "y2",
        text: margin.map(pct),
        textposition: "top center",
        cliponaxis: false,
        constraintext: "none",
        textfont: { size: 11, color: CI.ink2 },
        line: { color: PNL_COLORS.profit, width: 2 },
        marker: { size: 8, color: "#ffffff", line: { color: PNL_COLORS.profit, width: 2 } },
        connectgaps: false,
        hovertemplate: "<b>%{x}</b><br>Net profit margin: %{text}<extra></extra>",
      },
    ],
    [labels, revenue, margin],
  );
  const layout = useMemo<Partial<Layout>>(() => {
    const max = Math.max(1, ...revenue);
    const m = margin.filter((v): v is number => v !== null);
    const lo = Math.min(0, ...m);
    const hi = Math.max(0, ...m);
    const pad = Math.max(10, (hi - lo) * 0.35);
    return {
      bargap: 0.4,
      margin: { l: 64, r: 16, t: 20, b: 28 },
      xaxis: { anchor: "y2", fixedrange: true, tickfont: axisFont, ticks: "" },
      yaxis: {
        domain: [0.4, 1],
        range: [0, max * 1.2],
        fixedrange: true,
        tickfont: axisFont,
        gridcolor: CI.line,
        tickformat: ",.0f",
        title: { text: "Revenue (THB)", font: axisFont },
      },
      yaxis2: {
        domain: [0, 0.28],
        range: [lo - pad, hi + pad],
        fixedrange: true,
        tickfont: axisFont,
        ticksuffix: "%",
        zeroline: true,
        zerolinecolor: CI.ink2,
        gridcolor: CI.line,
        nticks: 3,
        title: { text: "Margin", font: axisFont },
      },
      dragmode: false,
    };
  }, [revenue, margin]);
  return (
    <Plot
      data={data}
      layout={layout}
      height={340}
      ariaLabel={labels.map((l, i) => `${l}: revenue ${fmtAcct(revenue[i])}, margin ${pct(margin[i]) || "n/a"}`).join("; ")}
    />
  );
}

/** One bar per month, profit up in teal, loss down in red, each labelled. */
export function ProfitBars({ labels, values, height = 300 }: { labels: string[]; values: number[]; height?: number }) {
  const data = useMemo<Data[]>(
    () => [
      {
        type: "bar",
        x: labels,
        y: values,
        text: values.map(fmtAcct),
        textposition: "outside",
        cliponaxis: false,
        constraintext: "none",
        textfont: { size: 11, color: values.map((v) => (v < 0 ? CI.red : CI.ink2)) as unknown as string },
        marker: { color: values.map((v) => (v < 0 ? PNL_COLORS.loss : PNL_COLORS.profit)) },
        hovertemplate: "<b>%{x}</b><br>Net profit: %{text} THB<extra></extra>",
      },
    ],
    [labels, values],
  );
  const layout = useMemo<Partial<Layout>>(() => {
    const hi = Math.max(0, ...values);
    const lo = Math.min(0, ...values);
    const pad = Math.max(1, hi - lo) * 0.15;
    return {
      bargap: 0.4,
      margin: { l: 64, r: 16, t: 16, b: 28 },
      xaxis: { fixedrange: true, tickfont: axisFont, ticks: "" },
      yaxis: {
        range: [lo - (lo < 0 ? pad : 0), hi + pad],
        fixedrange: true,
        tickfont: axisFont,
        gridcolor: CI.line,
        tickformat: ",.0f",
        zeroline: true,
        zerolinecolor: CI.ink2,
      },
      dragmode: false,
    };
  }, [values]);
  return <Plot data={data} layout={layout} height={height} ariaLabel={labels.map((l, i) => `${l}: ${fmtAcct(values[i])}`).join("; ")} />;
}

/** Revenue and net profit side by side per quarter. */
export function QuarterBars({ labels, revenue, profit }: { labels: string[]; revenue: number[]; profit: number[] }) {
  const data = useMemo<Data[]>(
    () => [
      {
        type: "bar",
        name: "Revenue (THB)",
        x: labels,
        y: revenue,
        text: revenue.map(fmtAcct),
        textposition: "outside",
        cliponaxis: false,
        constraintext: "none",
        textfont: { size: 11, color: CI.ink2 },
        marker: { color: PNL_COLORS.revenue },
        hovertemplate: "<b>%{x}</b><br>Revenue: %{text} THB<extra></extra>",
      },
      {
        type: "bar",
        name: "Net Profit (THB)",
        x: labels,
        y: profit,
        text: profit.map(fmtAcct),
        textposition: "outside",
        cliponaxis: false,
        constraintext: "none",
        textfont: { size: 11, color: profit.map((v) => (v < 0 ? CI.red : CI.ink2)) as unknown as string },
        marker: { color: profit.map((v) => (v < 0 ? PNL_COLORS.loss : PNL_COLORS.profit)) },
        hovertemplate: "<b>%{x}</b><br>Net profit: %{text} THB<extra></extra>",
      },
    ],
    [labels, revenue, profit],
  );
  const layout = useMemo<Partial<Layout>>(() => {
    const hi = Math.max(1, ...revenue, ...profit);
    const lo = Math.min(0, ...profit);
    const pad = (hi - lo) * 0.15;
    return {
      barmode: "group",
      bargap: 0.35,
      bargroupgap: 0.12,
      margin: { l: 64, r: 8, t: 16, b: 40 },
      xaxis: { fixedrange: true, tickfont: axisFont, ticks: "" },
      yaxis: { range: [lo - (lo < 0 ? pad : 0), hi + pad], fixedrange: true, tickfont: axisFont, gridcolor: CI.line, tickformat: ",.0f", zerolinecolor: CI.ink2 },
      dragmode: false,
    };
  }, [revenue, profit]);
  return (
    <Plot
      data={data}
      layout={layout}
      height={300}
      ariaLabel={labels.map((l, i) => `${l}: revenue ${fmtAcct(revenue[i])}, net profit ${fmtAcct(profit[i])}`).join("; ")}
    />
  );
}

export interface WaterfallStep {
  label: string;
  /** Totals (Revenue, Gross Profit, Net Profit) stand on zero; deductions hang from the previous total. */
  kind: "total" | "minus";
  value: number;
}

function waterfallGeometry(steps: WaterfallStep[]) {
  const out: (WaterfallStep & { base: number; height: number; end: number })[] = [];
  let level = 0;
  for (const s of steps) {
    if (s.kind === "total") {
      level = s.value;
      out.push({ ...s, base: Math.min(0, s.value), height: Math.abs(s.value), end: s.value });
    } else {
      const start = level;
      level = start - s.value;
      out.push({ ...s, base: Math.min(start, level), height: Math.abs(s.value), end: level });
    }
  }
  return out;
}

/** Revenue → Net Profit bridge. Built from bars with a `base`, so it needs only Plotly's basic bundle. */
export function Waterfall({ steps }: { steps: WaterfallStep[] }) {
  const geo = useMemo(() => waterfallGeometry(steps), [steps]);

  const data = useMemo<Data[]>(
    () => [
      {
        type: "bar",
        x: geo.map((g) => g.label),
        y: geo.map((g) => g.height),
        base: geo.map((g) => g.base),
        text: geo.map((g) => fmtAcct(g.kind === "minus" ? -g.value : g.value)),
        textposition: "outside",
        cliponaxis: false,
        constraintext: "none",
        textfont: { size: 11, color: geo.map((g) => (g.kind === "minus" || g.value < 0 ? CI.red : CI.ink2)) as unknown as string },
        marker: {
          color: geo.map((g, i) =>
            g.kind === "minus" ? PNL_COLORS.loss : i === 0 ? PNL_COLORS.revenue : g.value < 0 ? PNL_COLORS.loss : PNL_COLORS.profit,
          ),
        },
        hovertemplate: "<b>%{x}</b><br>%{text} THB<extra></extra>",
      } as Data,
    ],
    [geo],
  );
  const layout = useMemo<Partial<Layout>>(() => {
    const tops = geo.map((g) => g.base + g.height);
    const hi = Math.max(1, ...tops);
    const lo = Math.min(0, ...geo.map((g) => g.base));
    const pad = (hi - lo) * 0.15;
    // Dashed connector from the end of each bar to the next one.
    const shapes: Partial<Shape>[] = geo.slice(0, -1).map((g, i) => ({
      type: "line",
      xref: "x",
      yref: "y",
      x0: i + 0.3,
      x1: i + 0.7,
      y0: g.end,
      y1: g.end,
      line: { color: CI.ink2, width: 1, dash: "dot" },
    }));
    return {
      bargap: 0.4,
      margin: { l: 64, r: 8, t: 16, b: 48 },
      xaxis: { fixedrange: true, tickfont: axisFont, ticks: "", type: "category" },
      yaxis: { range: [lo - (lo < 0 ? pad : 0), hi + pad], fixedrange: true, tickfont: axisFont, gridcolor: CI.line, tickformat: ",.0f", zerolinecolor: CI.ink2 },
      shapes,
      dragmode: false,
    };
  }, [geo]);
  return <Plot data={data} layout={layout} height={300} ariaLabel={steps.map((s) => `${s.label} ${s.kind === "minus" ? "minus " : ""}${fmtAcct(s.value)}`).join(", ")} />;
}
