-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- Holds credentials: keep it away from Supabase's public REST API (the server connects as postgres and bypasses RLS).
ALTER TABLE "AppSetting" ENABLE ROW LEVEL SECURITY;
