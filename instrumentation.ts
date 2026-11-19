// Runs once when the Next.js server starts (see node_modules/next/dist/docs/01-app/02-guides/instrumentation.md).
// Starts the sync scheduler, which pulls PEAK / NetSuite into the database on a timer.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startScheduler } = await import("./lib/sync/scheduler");
  startScheduler();
}
