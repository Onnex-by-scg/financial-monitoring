import { PeakError } from "@/lib/peak/client";
import { sampleData } from "@/lib/sample";
import { readAr } from "@/lib/sync/ar-sync";
import { SAMPLE_MODE } from "@/lib/mode";

// GET /api/ar?entity=<company or NetSuite connection id>
// The tab's AR from the database (filled by the sync service, lib/sync/). Never pulls: the page asks for pulls
// separately (POST /api/pull, or the Netlify background function) and follows them via /api/ar/progress.
// 404 "not_pulled" = nothing saved for the tab yet.
// Sample mode (lib/mode.ts) serves made-up data instead (no database, no API calls).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");

  try {
    const data = SAMPLE_MODE ? sampleData(entity) : await readAr(entity);
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const e = err as PeakError;
    const status = err instanceof PeakError ? e.status : 500;
    const extra = err as { entity?: string; lastFailedAt?: string | null };
    return Response.json(
      { error: e.message, code: e.code ?? null, entity: extra.entity ?? null, lastFailedAt: extra.lastFailedAt ?? null },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
