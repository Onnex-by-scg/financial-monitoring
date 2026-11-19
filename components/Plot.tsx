"use client";

import { useEffect, useRef } from "react";
import type { Config, Data, Layout, PlotMouseEvent } from "plotly.js";
import { CI } from "@/lib/format";

// Thin client-only wrapper around plotly.js (basic bundle: bar + pie). Plotly needs `window`, so it is
// imported in an effect, not at module load. Plotly.react diffs, so re-renders are cheap.

type PlotlyModule = typeof import("plotly.js");
type PlotDiv = HTMLDivElement & { on?: (event: string, cb: (e: PlotMouseEvent) => void) => void; removeAllListeners?: (event: string) => void };

let plotlyPromise: Promise<PlotlyModule> | null = null;
const loadPlotly = () =>
  (plotlyPromise ??= import("plotly.js-basic-dist-min").then((m) => ((m as unknown as { default?: PlotlyModule }).default ?? m) as PlotlyModule));

const CONFIG: Partial<Config> = { displayModeBar: false, responsive: true, displaylogo: false };

/** CI styling shared by every chart: Lufga / Noto Sans Thai, recessive axes and grid, white tooltips. */
function baseLayout(height: number): Partial<Layout> {
  const font = typeof document === "undefined" ? "sans-serif" : getComputedStyle(document.body).fontFamily;
  return {
    height,
    autosize: true,
    margin: { l: 8, r: 8, t: 8, b: 8, pad: 0 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: font, size: 12, color: CI.ink },
    hoverlabel: { bgcolor: "#ffffff", bordercolor: CI.line, font: { family: font, size: 12, color: CI.ink }, align: "left" },
    showlegend: false,
    separators: ".,",
  };
}

export function Plot({
  data,
  layout,
  height,
  onClick,
  ariaLabel,
  className = "",
}: {
  data: Data[];
  layout?: Partial<Layout>;
  height: number;
  onClick?: (e: PlotMouseEvent) => void;
  ariaLabel: string;
  className?: string;
}) {
  const ref = useRef<PlotDiv>(null);
  const onClickRef = useRef(onClick);
  useEffect(() => {
    onClickRef.current = onClick;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    void loadPlotly().then((Plotly) => {
      if (cancelled) return;
      const base = baseLayout(height);
      // Updates (e.g. a filter) glide bars and lines to their new values; the first draw doesn't animate.
      const update = Boolean((el as PlotDiv & { data?: unknown }).data);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const transition = update && !reduce ? { transition: { duration: 500, easing: "cubic-in-out" as const } } : {};
      void Plotly.react(el, data, { ...base, ...layout, ...transition, margin: { ...base.margin, ...layout?.margin } }, CONFIG).then(() => {
        el.removeAllListeners?.("plotly_click");
        el.on?.("plotly_click", (e) => onClickRef.current?.(e));
      });
    });
    return () => {
      cancelled = true;
    };
  }, [data, layout, height]);

  // Follow the card's width (Plotly's own `responsive` only listens to window resizes).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => void loadPlotly().then((Plotly) => el.isConnected && Plotly.Plots.resize(el)));
    ro.observe(el);
    return () => {
      ro.disconnect();
      void loadPlotly().then((Plotly) => Plotly.purge(el));
    };
  }, []);

  return <div ref={ref} role="img" aria-label={ariaLabel} className={`w-full ${onClick ? "plot-clickable" : ""} ${className}`} style={{ height }} />;
}
