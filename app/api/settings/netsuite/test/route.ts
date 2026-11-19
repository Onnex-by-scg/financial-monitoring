import { testNetSuite } from "@/lib/netsuite/client";
import { netsuiteInput } from "@/lib/netsuite/input";
import { PeakError } from "@/lib/peak/client";
import { route } from "@/lib/peak/route-helpers";
import { readSettings, updateSettings, verification } from "@/lib/peak/settings-store";

// POST /api/settings/netsuite/test -> { id?, accountId?, consumerKey?, ... }: blank fields fall back to the saved connection.
// Reads the Subsidiary list once. Saves nothing, except the "last tested" result of an unchanged saved connection.
export const POST = route(async (_req, body) => {
  const { settings } = await readSettings();
  const saved = typeof body.id === "string" ? settings.netsuite.find((n) => n.id === body.id) : undefined;
  if (body.id && !saved) throw new PeakError(404, "NetSuite connection not found.");
  const conn = netsuiteInput(body, saved);
  const test = await testNetSuite(conn);
  const edited = ["accountId", "consumerKey", "consumerSecret", "tokenId", "tokenSecret", "scriptId", "deployId"].some(
    (k) => typeof body[k] === "string" && (body[k] as string).trim(),
  );
  if (saved && !edited) {
    await updateSettings((s) => {
      const n = s.netsuite.find((x) => x.id === saved.id);
      if (n) n.verified = verification(test);
    });
  }
  return test;
});
