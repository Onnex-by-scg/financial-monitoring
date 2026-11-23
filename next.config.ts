import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No cacheComponents / partialPrefetching: nothing here uses them (every page loads its data from the API in
  // the browser), and OpenNext's Cloudflare build doesn't support them yet (pages hang on Workers with them on).
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
