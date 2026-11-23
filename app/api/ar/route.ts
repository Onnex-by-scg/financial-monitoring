import { PeakError } from "@/lib/peak/client";
import { sampleData } from "@/lib/sample";
import { readAr } from "@/lib/sync/ar-sync";
import { SAMPLE_MODE } from "@/lib/mode";

// GET /api/ar?entity=<company or NetSuite connection id>[&refresh=1]
// The tab's AR from the database (filled by the sync service, lib/sync/). refresh=1 starts a pull in the
// background and returns the saved data at once with refreshing: true; the page polls /api/ar/progress.
// Sample mode (lib/mode.ts) serves made-up data instead (no database, no API calls).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");

  try {
    const data = SAMPLE_MODE ? sampleData(entity) : await readAr(entity, { refresh: url.searchParams.get("refresh") === "1" });
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const e = err as PeakError;
    const status = err instanceof PeakError ? e.status : 500;
    return Response.json({ error: e.message, code: e.code ?? null }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
