import { deleteEntityData } from "@/lib/sync/ar-sync";
import { testNetSuite } from "@/lib/netsuite/client";
import { netsuiteInput, pickConnection, sameConnection } from "@/lib/netsuite/input";
import { PeakError } from "@/lib/peak/client";
import { route, testFailed } from "@/lib/peak/route-helpers";
import { cleanName, publicSettings, readSettings, updateSettings, verification } from "@/lib/peak/settings-store";

const idFrom = (req: Request) => decodeURIComponent(new URL(req.url).pathname.split("/").pop() ?? "");

// PATCH /api/settings/netsuite/:id -> { name?, accountId?, consumerKey?, ..., skipTest? }. Blank secrets keep the saved values.
export const PATCH = route(async (req, body) => {
  const id = idFrom(req);
  const { settings } = await readSettings();
  const saved = settings.netsuite.find((n) => n.id === id);
  if (!saved) throw new PeakError(404, "NetSuite connection not found.");

  const name = body.name === undefined ? saved.name : cleanName(body.name, settings.netsuite, id, "connection");
  const conn = netsuiteInput(body, saved);
  const changed = !sameConnection(conn, saved);
  const test = changed && body.skipTest !== true ? await testNetSuite(conn) : null;
  if (test && !test.ok) throw testFailed(test);

  await updateSettings((s) => {
    const n = s.netsuite.find((x) => x.id === id);
    if (!n) return;
    Object.assign(n, { name, ...pickConnection(conn) });
    if (test) n.verified = verification(test);
    else if (changed) n.verified = undefined;
  });
  return { settings: await publicSettings(), test };
});

// DELETE /api/settings/netsuite/:id
export const DELETE = route(async (req) => {
  const id = idFrom(req);
  const { settings } = await readSettings();
  if (!settings.netsuite.some((n) => n.id === id)) throw new PeakError(404, "NetSuite connection not found.");
  await updateSettings((s) => {
    s.netsuite = s.netsuite.filter((n) => n.id !== id);
  });
  await deleteEntityData(id); // don't leave its invoices in the database
  return { settings: await publicSettings() };
});
