import { PeakError, testCompany } from "@/lib/peak/client";
import { deleteEntityData } from "@/lib/sync/ar-sync";
import { deletePnlData } from "@/lib/sync/pnl-sync";
import { developerInput, route, testFailed } from "@/lib/peak/route-helpers";
import { cleanName, cleanSecret, publicSettings, readSettings, updateSettings, verification } from "@/lib/peak/settings-store";

const idFrom = (req: Request) => decodeURIComponent(new URL(req.url).pathname.split("/").pop() ?? "");

// PATCH /api/settings/companies/:id -> { name?, userToken?, developer?: {...} | null, skipTest? }
// Blank userToken / Connect fields keep the saved values. developer: null switches to the shared credentials.
export const PATCH = route(async (req, body) => {
  const id = idFrom(req);
  const { settings } = await readSettings();
  const saved = settings.companies.find((c) => c.id === id);
  if (!saved) throw new PeakError(404, "Company not found.");

  const name = body.name === undefined ? saved.name : cleanName(body.name, settings.companies, id);
  const userToken = cleanSecret(body.userToken, "User Token", false) ?? saved.userToken;
  const own = body.developer === null ? undefined : body.developer ? developerInput(body.developer, saved.developer) : saved.developer;
  const conn = own ?? settings.developer;
  if (!conn) throw new PeakError(400, "No developer credentials for this company.", "invalid");

  const credsChanged = userToken !== saved.userToken || JSON.stringify(own ?? null) !== JSON.stringify(saved.developer ?? null);
  const test = credsChanged && body.skipTest !== true ? await testCompany(conn, userToken) : null;
  if (test && !test.ok) throw testFailed(test);

  await updateSettings((s) => {
    const c = s.companies.find((x) => x.id === id);
    if (!c) return;
    c.name = name;
    c.userToken = userToken;
    c.developer = own ? { env: own.env, connectId: own.connectId, connectKey: own.connectKey } : undefined;
    if (test) c.verified = verification(test);
    else if (credsChanged) c.verified = undefined;
  });
  return { settings: await publicSettings(), test };
});

// DELETE /api/settings/companies/:id
export const DELETE = route(async (req) => {
  const id = idFrom(req);
  const { settings } = await readSettings();
  if (!settings.companies.some((c) => c.id === id)) throw new PeakError(404, "Company not found.");
  await updateSettings((s) => {
    s.companies = s.companies.filter((c) => c.id !== id);
  });
  await deleteEntityData(id); // don't leave its invoices in the database
  await deletePnlData(id); // nor its profit & loss months
  return { settings: await publicSettings() };
});
