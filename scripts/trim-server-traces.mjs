// Runs after `next build` (package.json "build"). Removes packages the server never loads from Next's file traces
// (.next/server/**/*.nft.json), which list the files a deployment copies next to the server code.
//
// Why: the Prisma client is generated for Cloudflare Workers (prisma/schema.prisma: runtime = "cloudflare"), and
// its WebAssembly import makes Turbopack trace every file in the project, build tools included. The Cloudflare
// build (opennextjs-cloudflare) bundles every traced .wasm file into the Worker, which then goes over the Worker
// size limit. `outputFileTracingExcludes` in next.config can't do this: it doesn't apply to instrumentation.ts.

import fs from "node:fs";
import path from "node:path";

const SERVER_DIR = path.join(process.cwd(), ".next", "server");

// The Prisma CLI and engines (the client uses its own copy of the query compiler, in lib/generated/prisma),
// Prisma's other databases' compilers, and the build/lint tools.
const UNUSED = [
  /\/node_modules\/prisma\//,
  /\/node_modules\/@prisma\/(engines|studio-core|config|dev|get-platform|fetch-engine)\//,
  /\/node_modules\/@prisma\/client\/runtime\/[^/]*(\.wasm|wasm-base64[^/]*)$/,
  /\/node_modules\/(wrangler|miniflare|workerd|esbuild|typescript|sharp|eslint[^/]*)\//,
  /\/node_modules\/@(cloudflare|esbuild|img|typescript-eslint)\//,
];

function* traceFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* traceFiles(full);
    else if (entry.name.endsWith(".nft.json")) yield full;
  }
}

if (fs.existsSync(SERVER_DIR)) {
  let removed = 0;
  for (const file of traceFiles(SERVER_DIR)) {
    const trace = JSON.parse(fs.readFileSync(file, "utf8"));
    const kept = trace.files.filter((f) => !UNUSED.some((re) => re.test(f.replace(/\\/g, "/"))));
    if (kept.length !== trace.files.length) {
      removed += trace.files.length - kept.length;
      fs.writeFileSync(file, JSON.stringify({ ...trace, files: kept }));
    }
  }
  console.log(`[trim-server-traces] left ${removed} unused files out of the server traces`);
}
