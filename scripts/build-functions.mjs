// Bundles netlify/pull-background.ts (and the lib/ code it uses) into netlify/functions/pull-background.mjs for
// Netlify. Run by `pnpm build`. A separate step because the lib code imports "server-only", which only resolves
// inside Next.js; here it's swapped for an empty module.
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "netlify", "functions");
await mkdir(outDir, { recursive: true });
const empty = path.join(root, "scripts", "server-only-stub.mjs");

await build({
  entryPoints: [path.join(root, "netlify", "pull-background.ts")],
  outfile: path.join(outDir, "pull-background.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  alias: { "server-only": empty },
  // pg's optional native driver isn't installed; pg falls back to its JavaScript client.
  external: ["pg-native"],
  // Some bundled CommonJS packages call require(); give the ES module one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
});
