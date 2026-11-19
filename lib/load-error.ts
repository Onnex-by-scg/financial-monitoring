// Turns the server's technical error text (lib/peak/client.ts, lib/netsuite/client.ts) into a plain explanation
// for the dashboard: what happened, what it means, and what to do. The original text stays available as
// "technical details". Matching is on the messages this app itself produces, so keep the patterns in step.

import type { Provider } from "./ar";

export interface LoadErrorInfo {
  title: string;
  /** One or two sentences in plain language. */
  meaning: string;
  /** What the user can do, in order. */
  steps: string[];
  /** Whether the Settings link is a useful next step. */
  settings: boolean;
  /** Whether trying again later can help (busy, timeout, closed hours). */
  retry: boolean;
}

export function explainLoadError(message: string, status: number | null, tabProvider: Provider): LoadErrorInfo {
  const m = message;
  // Server messages name their source; trust that over the tab (e.g. an error that arrives just after switching tabs).
  const provider: Provider = /NetSuite/.test(m) ? "netsuite" : /PEAK/.test(m) ? "peak" : tabProvider;
  const name = provider === "netsuite" ? "NetSuite" : "PEAK";

  // The browser couldn't reach this dashboard's own server.
  if (status === null && /failed to fetch|networkerror|load failed|fetch failed/i.test(m)) {
    return {
      title: "The dashboard server isn't responding",
      meaning: "Your browser couldn't reach this dashboard's own server, so nothing was asked from PEAK or NetSuite.",
      steps: ["Check that the dashboard is still running (npm run dev or npm start).", "Then reload the page."],
      settings: false,
      retry: true,
    };
  }

  if (provider === "netsuite") {
    if (/refused the login|INVALID_LOGIN/i.test(m))
      return {
        title: "NetSuite didn't accept the login",
        meaning: "NetSuite answered, but rejected the keys for this connection.",
        steps: [
          "In Settings, check the Account ID matches the environment (Sandbox IDs end in _SB1).",
          "Re-copy the Consumer Key/Secret and Token ID/Secret in full, with no spaces.",
          "Ask the NetSuite admin whether the access token was revoked.",
        ],
        settings: true,
        retry: false,
      };
    if (/busy|too many requests|REQUEST_LIMIT|CONCURRENCY/i.test(m) || status === 429)
      return {
        title: "NetSuite is busy right now",
        meaning: "NetSuite limits how many requests an account can run at once, and SCG's other integrations share that limit.",
        steps: ["Wait a minute, then click Try again."],
        settings: false,
        retry: true,
      };
    if (/access denied|can't run that RESTlet/i.test(m) || status === 403)
      return {
        title: "This NetSuite login isn't allowed to read invoices",
        meaning: "The keys work, but the role behind the access token can't run the invoice endpoint the dashboard uses (#46).",
        steps: ["Ask the NetSuite admin to give the token's role access to the RESTlet customscript_int_api_2."],
        settings: false,
        retry: false,
      };
    if (/didn't answer within/i.test(m))
      return {
        title: "NetSuite took too long to answer",
        meaning: "A page of invoices didn't arrive in time. NetSuite is sometimes slow when it is busy.",
        steps: ["Click Try again. Pages that already arrived aren't lost from the last saved copy."],
        settings: false,
        retry: true,
      };
    if (/SCRIPT_ERROR|NetSuite error/i.test(m))
      return {
        title: "NetSuite's integration script reported an error",
        meaning: "The login worked, but SCG's RESTlet code inside NetSuite failed while preparing the invoices.",
        steps: ["Try again in a few minutes.", "If it keeps happening, send the technical details below to the NetSuite developer."],
        settings: false,
        retry: true,
      };
  }

  if (provider === "peak") {
    if (/rate limit/i.test(m) || status === 429)
      return {
        title: "PEAK asked us to slow down",
        meaning: "PEAK allows only a few requests per minute and that limit was reached.",
        steps: ["Wait about a minute, then click Try again."],
        settings: false,
        retry: true,
      };
    if (/rejected the developer credentials/i.test(m))
      return {
        title: "PEAK didn't accept the developer credentials",
        meaning: "The Connect ID / Connect Key for this environment were refused.",
        steps: ["In Settings, check the Connect ID and Connect Key, and that UAT vs Production is right.", "Click Test on the company."],
        settings: true,
        retry: false,
      };
    if (/Could not reach PEAK/i.test(m))
      return {
        title: "PEAK can't be reached",
        meaning: "The dashboard server couldn't connect to PEAK. PEAK UAT is only open Mon–Fri 08:00–22:00 (Bangkok time).",
        steps: ["If it's outside those hours, try again during them.", "Otherwise check this computer's internet or VPN connection."],
        settings: false,
        retry: true,
      };
    if (/failed \((\d+|no resCode)\)/i.test(m))
      return {
        title: "PEAK refused one of the requests",
        meaning: "PEAK answered with an error code, often because the company's User Token is wrong or expired.",
        steps: ["In Settings, click Test on the company to check its User Token.", "If the test passes, try again later."],
        settings: true,
        retry: true,
      };
  }

  // Network problems between this server and NetSuite / PEAK (messages from unreachableMessage()).
  if (/doesn't exist \(DNS/i.test(m))
    return {
      title: `${name} account address not found`,
      meaning: "The Account ID points to a NetSuite address that doesn't exist, usually a typo or the wrong environment.",
      steps: ["In Settings, copy the Account ID exactly as it works in Postman (e.g. 1234567 or 1234567_SB1)."],
      settings: true,
      retry: false,
    };
  if (/TLS certificate/i.test(m))
    return {
      title: "A secure-connection check failed",
      meaning: "Something between this computer and the internet, often a corporate proxy, is intercepting the secure connection.",
      steps: ["Try another network, or ask IT for the proxy's root certificate (see the technical details)."],
      settings: false,
      retry: false,
    };
  if (/Couldn't connect|Couldn't look up|Could not reach/i.test(m))
    return {
      title: `Can't connect to ${name}`,
      meaning: `The dashboard server couldn't open a connection to ${name}. A firewall, VPN or proxy may be in the way.`,
      steps: ["Check this computer's internet / VPN connection.", "Then click Try again."],
      settings: false,
      retry: true,
    };

  return {
    title: `Couldn't load AR data from ${name}`,
    meaning: `${name} returned something the dashboard didn't expect.`,
    steps: ["Click Try again.", `If it keeps failing, open Settings and click Test on this ${provider === "netsuite" ? "NetSuite connection" : "company"}.`],
    settings: true,
    retry: true,
  };
}
