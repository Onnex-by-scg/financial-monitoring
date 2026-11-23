import { PeakError } from "@/lib/peak/client";
import { samplePnl } from "@/lib/sample-pnl";
import { readPnl } from "@/lib/sync/pnl-sync";
import { SAMPLE_MODE } from "@/lib/mode";

// GET /api/pnl?entity=<PEAK company id>&year=2026
// Monthly profit & loss for one PEAK company, read from the database (the sync service fills it from PEAK's
// trial balance). Never pulls: autoPull: true tells the page to ask for one (months missing or old).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const thisYear = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric" }).format(new Date()));
  const y = Number(url.searchParams.get("year") ?? thisYear);
  const year = Number.isInteger(y) && y >= 2000 && y <= thisYear ? y : thisYear;

  try {
    const data =
      SAMPLE_MODE ? samplePnl(year) : await readPnl(url.searchParams.get("entity"), year);
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const e = err as PeakError;
    const status = err instanceof PeakError ? e.status : 500;
    return Response.json({ error: e.message, code: e.code ?? null }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
