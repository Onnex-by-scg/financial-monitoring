import type { Bucket } from "./ar";

const thb = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("en-US");

export const fmtAmount = (n: number) => thb.format(n);
export const fmtInt = (n: number) => int.format(n);
export const fmtPct = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "–");

/** 1,412,345 -> "1.41M", 433,564 -> "433.6K" */
export function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

/** 2026-10-30 -> 30/10/26, as in the Power BI report */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

export function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(new Date(iso))
    .replace(",", "");
}

// ONNEX by SCG corporate identity (CI deck "Colors System"). The deck lists Cobalt Blue as HEX 214EA2, but its own
// RGB (3, 78, 162) and swatch are #034EA2, which is used here.
export const CI = {
  cobalt: "#034EA2", // primary
  aqua: "#03BFD7", // primary
  green: "#26D07C", // Pantone 7479 C
  purple: "#4D49BE", // Pantone 2368 C
  grey: "#717C7D", // Pantone 444 C
  red: "#D6001C", // Pantone 2035 C
  mint: "#3EE8B5", // end of the CI-bar gradient
  ink: "#0B1F3A", // text (navy-tinted black)
  ink2: "#475569", // secondary text
  line: "#E2E8F0", // axes, borders
  /** The CI bar: cobalt → aqua → mint */
  gradient: "linear-gradient(90deg, #034EA2 0%, #1C7FD6 40%, #03BFD7 75%, #3EE8B5 100%)",
};

// Aging is ordinal severity: "Current" in brand cobalt, then one CI hue (red) from light to dark as invoices get
// later. Checked with the dataviz palette validator (adjacent steps distinguishable in normal and colour-blind vision);
// the light steps are always shown with a text label and a table, as the validator requires.
export const BUCKET_STYLE: Record<Bucket, { label: string; color: string; cell: string }> = {
  "0_Current": { label: "Current", color: CI.cobalt, cell: "" },
  "1_1-30": { label: "1–30 days", color: "#F9C0C4", cell: "bg-[#FDE3E5] text-[#7A0010]" },
  "2_31-60": { label: "31–60 days", color: "#EF7880", cell: "bg-[#F9C0C4] text-[#5C000C]" },
  "3_61-90": { label: "61–90 days", color: CI.red, cell: "bg-[#D6001C] text-white" },
  "4_>90": { label: "> 90 days", color: "#800012", cell: "bg-[#800012] text-white" },
};

// Status colours are reserved for state and always shown with ✓ / ⚠ and a label.
export const COLORS = {
  current: CI.cobalt,
  overdue: CI.red,
  target: CI.green,
  over: CI.red,
};

/** Whole baht, accounting style: 1,504,124 and losses as (57,389). */
export const fmtAcct = (n: number) => (Math.round(n) < 0 ? `(${int.format(Math.abs(Math.round(n)))})` : int.format(Math.round(n)));

/** 3,501,074 -> "3.50" (for "Million THB" tiles) */
export const fmtMillions = (n: number) => (n / 1e6).toFixed(2);

// Financial Performance: revenue in brand cobalt, profit in a teal from the CI aqua (darkened so labels and thin bars
// read on white), losses and deductions in CI red. Blue and teal differ strongly in lightness, so they stay apart in
// colour-blind vision too; every bar also carries a value label.
export const PNL_COLORS = {
  revenue: CI.cobalt,
  profit: "#0E8F9C",
  loss: CI.red,
};
