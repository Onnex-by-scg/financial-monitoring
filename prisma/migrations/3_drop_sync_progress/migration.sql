-- Undoes 2_sync_progress: pulls went back to running inside the app (progress in server memory), so the
-- columns used by the Netlify background function are no longer needed.
ALTER TABLE "SyncRun" DROP COLUMN "progress";
ALTER TABLE "SyncRun" DROP COLUMN "heartbeatAt";
