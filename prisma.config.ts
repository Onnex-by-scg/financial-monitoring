import { defineConfig } from "prisma/config";

// Prisma CLI settings (migrate, generate). The app opens the same file through lib/db.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? "file:./.peak/app.db" },
});
