// OpenNext settings for the Cloudflare Workers build (`pnpm opennextjs-cloudflare build`).
// No incremental cache: nothing is cached between requests (every page loads its data from the API on each visit),
// so it needs no extra Cloudflare resources (no R2 bucket or KV namespace).
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
