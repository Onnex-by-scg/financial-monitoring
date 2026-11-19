import { testDeveloper } from "@/lib/peak/client";
import { developerInput, route, testFailed } from "@/lib/peak/route-helpers";
import { publicSettings, readSettings, updateSettings, verification } from "@/lib/peak/settings-store";

// POST /api/settings/developer -> test Connect ID / Key (blank fields use the saved values). Saves nothing,
// except the "last tested" result when the saved credentials themselves were tested.
export const POST = route(async (_req, body) => {
  const { settings } = await readSettings();
  const conn = developerInput(body, settings.developer);
  const test = await testDeveloper(conn);
  const saved = settings.developer;
  if (saved && conn.env === saved.env && conn.connectId === saved.connectId && conn.connectKey === saved.connectKey) {
    await updateSettings((s) => {
      if (s.developer) s.developer.verified = verification(test);
    });
  }
  return test;
});

// PUT /api/settings/developer -> test, then save the shared developer credentials. { skipTest: true } saves anyway.
export const PUT = route(async (_req, body) => {
  const { settings } = await readSettings();
  const conn = developerInput(body, settings.developer);
  const test = body.skipTest === true ? null : await testDeveloper(conn);
  if (test && !test.ok) throw testFailed(test);
  await updateSettings((s) => {
    s.developer = { ...conn, verified: test ? verification(test) : undefined };
  });
  return { settings: await publicSettings(), test };
});
