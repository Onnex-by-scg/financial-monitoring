// `pnpm run build`. On Cloudflare's builder (Workers Builds sets WORKERS_CI=1) this runs the OpenNext build,
// which runs `pnpm build:next` (open-next.config.ts) and then packages the result for Workers in .open-next/, so
// the deploy step (`npx wrangler deploy`) finds it. Anywhere else (Netlify, a local `pnpm build`) it is the plain
// Next.js build. This way both hosts can keep the build command `pnpm run build`.

import { execSync } from "node:child_process";

const onCloudflare = Boolean(process.env.WORKERS_CI);
const command = onCloudflare ? "pnpm exec opennextjs-cloudflare build" : "pnpm run build:next";
console.log(`> ${command}${onCloudflare ? " (Cloudflare Workers build)" : ""}`);
execSync(command, { stdio: "inherit" });
