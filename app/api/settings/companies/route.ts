import { PeakError, testCompany } from "@/lib/peak/client";
import { developerInput, route, testFailed } from "@/lib/peak/route-helpers";
import { cleanName, cleanSecret, newId, publicSettings, readSettings, updateSettings, verification } from "@/lib/peak/settings-store";

// POST /api/settings/companies -> add a company: { name, userToken, developer?: {env, connectId, connectKey}, skipTest? }
// Without `developer`, the company uses the shared developer credentials.
export const POST = route(async (_req, body) => {
  const { settings } = await readSettings();
  const name = cleanName(body.name, settings.companies);
  const userToken = cleanSecret(body.userToken, "User Token", true)!;
  const own = body.developer ? developerInput(body.developer) : undefined;
  const conn = own ?? settings.developer;
  if (!conn) throw new PeakError(400, "Set up the developer credentials first, or give this company its own.", "invalid");

  const test = body.skipTest === true ? null : await testCompany(conn, userToken);
  if (test && !test.ok) throw testFailed(test);
  await updateSettings((s) => {
    s.companies.push({
      id: newId(),
      name,
      userToken,
      developer: own,
      verified: test ? verification(test) : undefined,
      createdAt: new Date().toISOString(),
    });
  });
  return { settings: await publicSettings(), test };
});
