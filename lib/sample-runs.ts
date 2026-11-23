import type { SyncRun } from "./generated/prisma/client";

// Made-up pull history for sample mode (lib/mode.ts), so Settings → Data sync has something to show.
// One AR pull per tab every 15 minutes, newest first, with a P&L pull after each PEAK one and the odd failure.

export function sampleRuns(targets: { id: string; provider: string }[], limit: number): SyncRun[] {
  const runs: SyncRun[] = [];
  const now = Date.now();
  let id = 1;
  for (let round = 0; runs.length < limit && round < 50; round++) {
    const roundStart = now - (round + 1) * 15 * 60_000;
    targets.forEach((t, i) => {
      const startedAt = new Date(roundStart + i * 20_000);
      const failed = (round + i) % 11 === 5;
      runs.push({
        id: id++,
        entityId: t.id,
        provider: t.provider,
        kind: "ar",
        trigger: round === 0 && i === 0 ? "refresh" : "schedule",
        status: failed ? "error" : "ok",
        mode: t.provider === "netsuite" ? (round % 8 === 0 ? "full" : "update") : null,
        startedAt,
        finishedAt: new Date(startedAt.getTime() + 4_000 + ((round * 7 + i * 3) % 9) * 1_000),
        invoices: failed ? null : 16 + ((round + i * 5) % 14),
        error: failed ? "Sample error: PEAK UAT is closed (Mon–Fri 08:00–22:00 Bangkok)." : null,
        errorStatus: failed ? 502 : null,
        note: null,
      });
      if (t.provider === "peak" && !failed) {
        const pnlStart = new Date(startedAt.getTime() + 9_000);
        runs.push({
          id: id++,
          entityId: t.id,
          provider: t.provider,
          kind: "pnl",
          trigger: "schedule",
          status: round % 4 === 0 ? "ok" : "skipped",
          mode: String(new Date(now).getFullYear()),
          startedAt: pnlStart,
          finishedAt: new Date(pnlStart.getTime() + 3_000),
          invoices: null,
          error: null,
          errorStatus: null,
          note: round % 4 === 0 ? null : "Months already up to date",
        });
      }
    });
  }
  return runs.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).slice(0, limit);
}
