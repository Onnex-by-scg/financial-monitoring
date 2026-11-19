import { testNetSuite } from "@/lib/netsuite/client";
import { netsuiteInput, pickConnection } from "@/lib/netsuite/input";
import { route, testFailed } from "@/lib/peak/route-helpers";
import { cleanName, newId, publicSettings, readSettings, updateSettings, verification } from "@/lib/peak/settings-store";

// POST /api/settings/netsuite -> add a NetSuite connection:
// { name, accountId, consumerKey, consumerSecret, tokenId, tokenSecret, scriptId?, deployId?, skipTest? }
export const POST = route(async (_req, body) => {
  const { settings } = await readSettings();
  const name = cleanName(body.name, settings.netsuite, undefined, "connection");
  const conn = netsuiteInput(body);
  const test = body.skipTest === true ? null : await testNetSuite(conn);
  if (test && !test.ok) throw testFailed(test);
  await updateSettings((s) => {
    s.netsuite.push({ id: newId(), name, ...pickConnection(conn), verified: test ? verification(test) : undefined, createdAt: new Date().toISOString() });
  });
  return { settings: await publicSettings(), test };
});
