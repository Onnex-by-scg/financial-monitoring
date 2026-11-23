-- Pull progress and heartbeat in the database, so pulls running in a Netlify background function can be
-- followed from any other function instance (lib/sync/runs.ts).
ALTER TABLE "SyncRun" ADD COLUMN "progress" TEXT;
ALTER TABLE "SyncRun" ADD COLUMN "heartbeatAt" TIMESTAMP(3);
