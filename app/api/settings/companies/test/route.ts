import { PeakError, testCompany } from "@/lib/peak/client";
import { developerInput, route } from "@/lib/peak/route-helpers";
import { cleanSecret, connectionFor, readSettings, updateSettings, verification } from "@/lib/peak/settings-store";

// POST /api/settings/companies/test -> test a User Token. Saves nothing, except the "last tested" result of a saved company.
// { id?, userToken?, developer?: {...} | null }: blank fields fall back to the saved company;
// developer: null means "use the shared developer credentials".
export const POST = route(async (_req, body) => {
  const { settings } = await readSettings();
  const saved = typeof body.id === "string" ? settings.companies.find((c) => c.id === body.id) : undefined;
  if (body.id && !saved) throw new PeakError(404, "Company not found.");

  const userToken = cleanSecret(body.userToken, "User Token", false) ?? saved?.userToken;
  if (!userToken) throw new PeakError(400, "User Token is required.", "invalid");
  const conn =
    body.developer === null ? settings.developer : body.developer ? developerInput(body.developer, saved?.developer) : connectionFor(settings, saved);
  if (!conn) throw new PeakError(400, "No developer credentials to test with. Set them up first.", "invalid");

  const test = await testCompany(conn, userToken);
  // Only record the result when the saved credentials themselves were tested.
  if (saved && !body.userToken && body.developer === undefined) {
    await updateSettings((s) => {
      const c = s.companies.find((x) => x.id === saved.id);
      if (c) c.verified = verification(test);
    });
  }
  return test;
});
