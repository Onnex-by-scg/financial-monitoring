-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "ArSnapshot" (
    "entityId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "credKey" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "businessName" TEXT,
    "source" TEXT NOT NULL,
    "asOf" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "projects" TEXT NOT NULL,
    "warnings" TEXT NOT NULL,
    "debug" TEXT NOT NULL,

    CONSTRAINT "ArSnapshot_pkey" PRIMARY KEY ("entityId")
);

-- CreateTable
CREATE TABLE "ArInvoice" (
    "id" SERIAL NOT NULL,
    "entityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "contactCode" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "issuedDate" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "netAmount" DOUBLE PRECISION NOT NULL,
    "remainAmount" DOUBLE PRECISION NOT NULL,
    "link" TEXT,
    "projects" TEXT NOT NULL,

    CONSTRAINT "ArInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" SERIAL NOT NULL,
    "entityId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ar',
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "invoices" INTEGER,
    "error" TEXT,
    "errorStatus" INTEGER,
    "note" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PnlMonth" (
    "entityId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "credKey" TEXT NOT NULL,
    "totals" TEXT NOT NULL,
    "accounts" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PnlMonth_pkey" PRIMARY KEY ("entityId","month")
);

-- CreateTable
CREATE TABLE "SyncState" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "ArInvoice_entityId_idx" ON "ArInvoice"("entityId");

-- CreateIndex
CREATE INDEX "SyncRun_entityId_startedAt_idx" ON "SyncRun"("entityId", "startedAt");

-- AddForeignKey
ALTER TABLE "ArInvoice" ADD CONSTRAINT "ArInvoice_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "ArSnapshot"("entityId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Supabase serves the public schema over its REST API with the anon key. These tables are only for the
-- dashboard's server (which connects as postgres and bypasses RLS), so turn RLS on with no policies:
-- the REST API then returns nothing from them.
ALTER TABLE "ArSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ArInvoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PnlMonth" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncState" ENABLE ROW LEVEL SECURITY;
