// Where the server is running. The app is deployed to Cloudflare Workers (through @opennextjs/cloudflare) and
// also runs as a normal Node server (`pnpm dev`, `pnpm start`). Workers differ in ways the code has to respect:
//  - nothing runs between requests, so there's no in-process timer (a Cron Trigger starts scheduled pulls);
//  - a database connection opened while handling one request can't be used by another;
//  - work after the response (after()) is cut about 30 seconds after the response goes out;
//  - there is no project folder on disk.

/** True inside a Cloudflare Worker (local `wrangler dev` / `pnpm preview` included). */
export const ON_WORKERS = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

/** True on a serverless host (Cloudflare Workers, or Netlify's AWS Lambda), where background work is cut short. */
export const SERVERLESS = ON_WORKERS || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
