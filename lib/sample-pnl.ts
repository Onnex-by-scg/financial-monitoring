import { bangkokToday, round2 } from "./ar";
import { classifyAccount, emptyTotals, monthsFor, type PnlAccount, type PnlMonth, type PnlResponse } from "./pnl";

// Made-up P&L for PEAK_USE_SAMPLE=1 (no PEAK calls). Account codes follow a Thai chart of accounts.
const REVENUE = [99_246, 104_449, 151_512, 152_853, 305_411, 594_525, 348_846, 348_846, 348_846, 348_846, 348_846, 348_846];

export function samplePnl(year: number): PnlResponse {
  const months: PnlMonth[] = monthsFor(year, bangkokToday()).map((ym, i) => {
    const rev = REVENUE[i];
    const lines: [string, string, number][] = [
      ["410101", "รายได้จากการให้บริการ", round2(rev * 0.96)],
      ["420101", "รายได้อื่น", round2(rev * 0.04)],
      ["510101", "ต้นทุนบริการ", round2(rev * 0.43)],
      ["530101", "เงินเดือนและค่าจ้าง", 52_000],
      ["530301", "ค่าเช่าสำนักงาน", 18_000],
      ["531001", "ค่าเสื่อมราคา", round2(rev * 0.05)],
      ["540101", "ดอกเบี้ยจ่าย", i < 8 ? 18_500 : 63_000],
    ];
    const totals = emptyTotals();
    const accounts: PnlAccount[] = lines.map(([code, name, amount]) => {
      const k = classifyAccount(code, name)!;
      totals[k.line] = round2(totals[k.line] + amount);
      return { code, name, line: k.line, amount, rule: k.rule };
    });
    return { month: `${ym.slice(0, 4)}-${ym.slice(4)}`, totals, accounts };
  });
  return {
    entity: "sample",
    entityName: "Sample",
    businessName: "Sample data",
    source: "sample",
    year,
    currentYear: Number(bangkokToday().slice(0, 4)),
    months,
    fetchedAt: new Date().toISOString(),
    warnings: [],
    debug: { baseUrl: "(sample data, no PEAK calls)", calls: [] },
  };
}
