// OpenNext settings for the Cloudflare Workers build (`pnpm opennextjs-cloudflare build`, or `pnpm run build` on
// Cloudflare's builder: scripts/build.mjs).
// No incremental cache: nothing is cached between requests (every page loads its data from the API on each visit),
// so it needs no extra Cloudflare resources (no R2 bucket or KV namespace).
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

const config = {
  ...defineCloudflareConfig({}),
  // The Next.js build itself. Not "build", which on Cloudflare's builder runs this OpenNext build (a loop).
  buildCommand: "pnpm run build:next",
};

export default config;
