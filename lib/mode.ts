// Sample mode: for working on the UI locally with made-up data. Turned on by PEAK_USE_SAMPLE=1 (`pnpm dev:sample`
// sets it). While it's on, nothing leaves this machine:
//  - AR and P&L come from lib/sample.ts / lib/sample-pnl.ts;
//  - Settings live in memory (lib/peak/settings-store.ts), seeded with sample companies, and reset on restart;
//  - connection tests pass without calling PEAK or NetSuite, and pulls do nothing;
//  - the database is never opened (lib/db.ts throws if anything tries).
//
// It is ignored in production builds (`next build` / `next start`, e.g. Netlify), so a stray PEAK_USE_SAMPLE
// there can't hide the real data: production always uses Supabase and the real PEAK / NetSuite APIs.

const requested = process.env.PEAK_USE_SAMPLE === "1";
const production = process.env.NODE_ENV === "production";

export const SAMPLE_MODE = requested && !production;

if (requested && production) {
  console.warn("PEAK_USE_SAMPLE=1 is ignored in production: using the database and the real PEAK / NetSuite APIs.");
}
