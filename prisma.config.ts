import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma CLI settings (migrate, generate). The app connects with the same DATABASE_URL through lib/db.ts.
// Prisma 7 does not load env files itself, so read .env.local (where DATABASE_URL lives) here.
config({ path: ".env.local", quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Empty when unset so `prisma generate` (postinstall) still works on a fresh checkout.
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
