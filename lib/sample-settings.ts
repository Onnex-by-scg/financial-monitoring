import type { Settings } from "./peak/settings-store";
import { SAMPLE_ENTITIES } from "./sample";

// Settings for sample mode (lib/mode.ts): the same companies the sample dashboard shows, plus one NetSuite
// connection so every Settings section has something to show. All keys are fake and never leave the server.

const at = "2026-01-05T03:00:00.000Z";
const verified = (message: string, businessName: string | null = null) => ({ ok: true, message, businessName, at });

export function sampleSettings(): Settings {
  return {
    version: 1,
    developer: {
      env: "uat",
      connectId: "sample-connect-id-0000",
      connectKey: "sample-connect-key-0000",
      verified: verified("Sample mode: no request was sent to PEAK."),
    },
    companies: SAMPLE_ENTITIES.map((name) => ({
      id: name,
      name,
      userToken: `sample-user-token-${name.replace(/\W/g, "").toLowerCase()}`,
      verified: verified("Sample mode: no request was sent to PEAK.", `${name} (sample)`),
      createdAt: at,
    })),
    netsuite: [
      {
        id: "ns-sample",
        name: "Sample NetSuite",
        accountId: "1234567_SB1",
        consumerKey: "sample-consumer-key-0000",
        consumerSecret: "sample-consumer-secret-0000",
        tokenId: "sample-token-id-0000",
        tokenSecret: "sample-token-secret-0000",
        scriptId: "customscript_int_api",
        deployId: "1",
        verified: verified("Sample mode: no request was sent to NetSuite."),
        createdAt: at,
      },
    ],
    sync: { enabled: true, intervalMinutes: 15, skipClosedUat: true },
  };
}
