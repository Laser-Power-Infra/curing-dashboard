-- CreateTable
CREATE TABLE "boiler_temp_log" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "time" TEXT,
    "shift" TEXT,
    "tank1C" DECIMAL(6,2),
    "tank2C" DECIMAL(6,2),
    "tank3C" DECIMAL(6,2),
    "fuel" TEXT,
    "operator" TEXT,
    "remarks" TEXT,
    "rowKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boiler_temp_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "boiler_temp_log_rowKey_key" ON "boiler_temp_log"("rowKey");

-- CreateIndex
CREATE INDEX "boiler_temp_log_date_idx" ON "boiler_temp_log"("date");

