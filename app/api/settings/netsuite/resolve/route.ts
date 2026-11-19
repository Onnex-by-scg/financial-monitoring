import dns from "node:dns/promises";
import { restletHost } from "@/lib/netsuite/client";
import { cleanAccountId } from "@/lib/netsuite/input";
import { PeakError } from "@/lib/peak/client";
import { route } from "@/lib/peak/route-helpers";

// GET /api/settings/netsuite/resolve?account=1234567_SB1 -> does the RESTlet host exist?
// DNS lookup only: nothing is sent to NetSuite. Lets the setup guide flag a wrong Account ID before testing.
export const GET = route(async (req) => {
  const accountId = cleanAccountId(new URL(req.url).searchParams.get("account") ?? "");
  if (!accountId) throw new PeakError(400, "account is required.", "invalid");
  const host = restletHost(accountId);
  try {
    await dns.lookup(host);
    return { host, found: true, code: null };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? "ERROR";
    // ENOTFOUND = the name doesn't exist; anything else (EAI_AGAIN…) means DNS itself failed, so we can't tell.
    return { host, found: code === "ENOTFOUND" ? false : null, code };
  }
});
