-- CreateTable
CREATE TABLE "ArSnapshot" (
    "entityId" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "credKey" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "businessName" TEXT,
    "source" TEXT NOT NULL,
    "asOf" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL,
    "projects" TEXT NOT NULL,
    "warnings" TEXT NOT NULL,
    "debug" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "ArInvoice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "contactCode" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "issuedDate" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "netAmount" REAL NOT NULL,
    "remainAmount" REAL NOT NULL,
    "link" TEXT,
    "projects" TEXT NOT NULL,
    CONSTRAINT "ArInvoice_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "ArSnapshot" ("entityId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entityId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
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

-- CreateTable
CREATE TABLE "SyncState" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ArInvoice_entityId_idx" ON "ArInvoice"("entityId");

-- CreateIndex
CREATE INDEX "SyncRun_entityId_startedAt_idx" ON "SyncRun"("entityId", "startedAt");
