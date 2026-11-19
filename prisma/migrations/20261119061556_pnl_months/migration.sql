-- CreateTable
CREATE TABLE "PnlMonth" (
    "entityId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "credKey" TEXT NOT NULL,
    "totals" TEXT NOT NULL,
    "accounts" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL,

    PRIMARY KEY ("entityId", "month")
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SyncRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entityId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ar',
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mode" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "invoices" INTEGER,
    "error" TEXT,
    "errorStatus" INTEGER,
    "note" TEXT
);
INSERT INTO "new_SyncRun" ("entityId", "error", "errorStatus", "finishedAt", "id", "invoices", "mode", "note", "provider", "startedAt", "status", "trigger") SELECT "entityId", "error", "errorStatus", "finishedAt", "id", "invoices", "mode", "note", "provider", "startedAt", "status", "trigger" FROM "SyncRun";
DROP TABLE "SyncRun";
ALTER TABLE "new_SyncRun" RENAME TO "SyncRun";
CREATE INDEX "SyncRun_entityId_startedAt_idx" ON "SyncRun"("entityId", "startedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
