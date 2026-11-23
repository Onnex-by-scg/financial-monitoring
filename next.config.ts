import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Where the page sends pull requests (components/pull.ts): the Netlify background function when built on Netlify
  // (Netlify sets NETLIFY=true during its build), otherwise the app's own POST /api/pull.
  env: { NEXT_PUBLIC_PULL_VIA: process.env.NETLIFY === "true" ? "netlify" : "app" },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
