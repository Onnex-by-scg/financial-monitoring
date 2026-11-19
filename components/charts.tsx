"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Data, Layout } from "plotly.js";
import { CI } from "@/lib/format";
import { Plot } from "./Plot";

// Dashboard charts, drawn with Plotly. Every chart sits next to a table or legend with the same numbers,
// so colour is never the only way to read a value.

export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
  icon?: string;
  /** Extra tooltip line */
  detail?: string;
}

/** Faded version of a colour, for marks that aren't selected. */
const dim = (hex: string) => `${hex}4D`;


/** Donut (Plotly pie with a hole) with a 2px surface gap between segments and an HTML centre label. */
export function Donut({
  slices,
  size = 180,
  thickness = 26,
  center,
  format,
  onSelect,
  selected,
}: {
  slices: Slice[];
  size?: number;
  thickness?: number;
  center?: ReactNode;
  format: (n: number) => string;
  onSelect?: (key: string) => void;
  selected?: string | null;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const data = useMemo<Data[]>(
    () => [
      total === 0
        ? { type: "pie", values: [1], marker: { colors: [CI.line] }, hole: 1 - (2 * thickness) / size, textinfo: "none", hoverinfo: "skip", sort: false }
        : {
            type: "pie",
            values: slices.map((s) => s.value),
            labels: slices.map((s) => s.label),
            customdata: slices.map((s) => [format(s.value), s.detail ?? "", s.icon ?? ""]) as unknown as number[],
            marker: {
              colors: slices.map((s) => (selected && selected !== s.key ? dim(s.color) : s.color)),
              line: { color: "#ffffff", width: 2 },
            },
            hole: 1 - (2 * thickness) / size,
            sort: false,
            direction: "clockwise",
            rotation: 0,
            textinfo: "none",
            hovertemplate: "<b>%{customdata[2]} %{label}</b><br>%{customdata[0]}<br>%{percent} of total<br><span style='color:#64748b'>%{customdata[1]}</span><extra></extra>",
          },
    ],
    [slices, total, selected, format, size, thickness],
  );
  const layout = useMemo<Partial<Layout>>(() => ({ width: size, margin: { l: 0, r: 0, t: 0, b: 0 } }), [size]);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <Plot
        data={data}
        layout={layout}
        height={size}
        ariaLabel={slices.map((s) => `${s.label} ${format(s.value)}`).join(", ")}
        onClick={onSelect && total > 0 ? (e) => onSelect(slices[e.points[0].pointNumber as number].key) : undefined}
      />
      {center && <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div>}
    </div>
  );
}

/**
 * Ranked horizontal bars, one row per item: name and total on one line, the bar (stacked parts) under it.
 * Plain HTML rather than Plotly, so long Thai names never collide with the bars at any card width.
 * Bars are scaled to the largest total; parts are separated by a 2px gap.
 */
export function HBars({
  rows,
  format,
  onSelect,
  selected,
}: {
  rows: { key: string; label: string; parts: { value: number; color: string; name: string }[] }[];
  format: (n: number) => string;
  onSelect?: (key: string) => void;
  selected?: string | null;
}) {
  const totals = rows.map((r) => r.parts.reduce((s, p) => s + p.value, 0));
  const max = Math.max(1, ...totals);
  // Bars grow in from zero on first show, then glide to new lengths when filters change (CSS .bar-anim).
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const f = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(f);
  }, []);
  return (
    <ol className="space-y-3">
      {rows.map((r, i) => {
        const dimmed = Boolean(selected && selected !== r.key);
        const tip = [r.label, ...r.parts.map((p) => `${p.name}: ${format(p.value)}`), `Total: ${format(totals[i])}`].join("\n");
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-slate-700">
                <span className="mr-2 inline-block w-4 text-right text-xs text-slate-400 tabular-nums">{i + 1}</span>
                {r.label}
              </span>
              <span className="shrink-0 font-semibold text-slate-900 tabular-nums">{format(totals[i])}</span>
            </div>
            <div className="bar-anim mt-1.5 ml-6 flex h-2.5" style={{ width: grown ? `calc((100% - 1.5rem) * ${totals[i] / max})` : 0 }}>
              {r.parts.map((p, j) => (
                <span
                  key={p.name}
                  className="bar-anim h-full rounded-[3px]"
                  style={{
                    flexGrow: p.value,
                    flexBasis: 0,
                    minWidth: p.value > 0 ? 3 : 0,
                    // 2px gap between visible parts only, so a part shrinking to zero leaves no gap behind.
                    marginLeft: j > 0 && p.value > 0 && r.parts.slice(0, j).some((q) => q.value > 0) ? 2 : 0,
                    background: p.color,
                  }}
                />
              ))}
            </div>
          </>
        );
        return (
          <li key={r.key} className={`transition-opacity ${dimmed ? "opacity-35" : ""}`} title={tip}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(r.key)}
                aria-pressed={selected === r.key}
                className={`block w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-slate-50 ${selected === r.key ? "bg-brand-soft/60" : ""}`}
              >
                {body}
              </button>
            ) : (
              <div className="px-2 py-1.5">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Vertical bars, one per category, value labelled on top (used for the aging buckets). */
export function VBars({
  bars,
  format,
  onSelect,
  selected,
  height = 190,
}: {
  bars: { key: string; label: string; value: number; color: string; detail?: string }[];
  format: (n: number) => string;
  onSelect?: (key: string) => void;
  selected?: string | null;
  height?: number;
}) {
  const data = useMemo<Data[]>(
    () => [
      {
        type: "bar",
        x: bars.map((b) => b.label),
        y: bars.map((b) => b.value),
        text: bars.map((b) => format(b.value)),
        textposition: "outside",
        cliponaxis: false,
        textfont: { size: 12, color: CI.ink2 },
        customdata: bars.map((b) => [format(b.value), b.detail ?? ""]) as unknown as number[],
        marker: { color: bars.map((b) => (selected && selected !== b.key ? dim(b.color) : b.color)), line: { color: "#ffffff", width: 1 } },
        hovertemplate: "<b>%{x}</b><br>%{customdata[0]}<br><span style='color:#64748b'>%{customdata[1]}</span><extra></extra>",
      },
    ],
    [bars, selected, format],
  );
  const layout = useMemo<Partial<Layout>>(() => {
    const max = Math.max(1, ...bars.map((b) => b.value));
    return {
      bargap: 0.35,
      margin: { l: 16, r: 16, t: 20, b: 4 },
      xaxis: { fixedrange: true, automargin: true, tickfont: { size: 11, color: CI.ink2 }, ticks: "", showline: true, linecolor: CI.line },
      yaxis: { visible: false, range: [0, max * 1.18], fixedrange: true },
      dragmode: false,
    };
  }, [bars]);

  return (
    <Plot
      data={data}
      layout={layout}
      height={height}
      ariaLabel={bars.map((b) => `${b.label} ${format(b.value)}`).join(", ")}
      onClick={onSelect ? (e) => onSelect(bars[e.points[0].pointNumber as number].key) : undefined}
    />
  );
}

export function LegendItem({ color, label, icon }: { color: string; label: string; icon?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
      <span className="inline-block size-2.5 rounded-sm" style={{ background: color }} />
      {icon && <span aria-hidden>{icon}</span>}
      {label}
    </span>
  );
}
