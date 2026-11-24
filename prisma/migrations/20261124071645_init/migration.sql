-- CreateEnum
CREATE TYPE "Role" AS ENUM ('MD', 'PRODUCTION_HEAD', 'CURING', 'LAB', 'BOILER', 'PLANNING', 'TRANSFER', 'ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "ResponsibilityArea" AS ENUM ('CURING_LOG', 'HOT_SET_TEST', 'BOILER_LOG', 'RECIPE_MASTER', 'PERSON_MASTER', 'PRODUCTION_HEAD', 'PRODUCT_MASTER', 'TRANSFER', 'MD');

-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('SFG_SYNC', 'IMPORT', 'MANUAL');

-- CreateEnum
CREATE TYPE "UnloadTimeSource" AS ENUM ('SFG', 'MANUAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DrumStatus" AS ENUM ('MADE', 'MISSING', 'IN_CURING', 'AWAITING_TEST', 'TEST_OVERDUE', 'FAILED', 'PASSED', 'REQUISITION_RAISED', 'SENT', 'DATA_ERROR', 'NOT_CURING_ITEM');

-- CreateEnum
CREATE TYPE "TrackerStatus" AS ENUM ('MISSING', 'LATE', 'CURED', 'DATA_ERROR');

-- CreateEnum
CREATE TYPE "DelayReason" AS ENUM ('TANK_FULL', 'BOILER_DOWN', 'NO_MANPOWER', 'DRUM_ON_HOLD', 'OTHER');

-- CreateEnum
CREATE TYPE "MatchMethod" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "TimeCheck" AS ENUM ('OK', 'UNDER_CURED', 'NO_RECIPE');

-- CreateEnum
CREATE TYPE "VisualCheck" AS ENUM ('OK', 'NOT_OK');

-- CreateEnum
CREATE TYPE "TestResult" AS ENUM ('PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "RecipeStatus" AS ENUM ('DRAFT', 'APPROVED', 'RETIRED');

-- CreateEnum
CREATE TYPE "CuringUnitType" AS ENUM ('TANK', 'AUTOCLAVE');

-- CreateEnum
CREATE TYPE "RequisitionStatus" AS ENUM ('RAISED', 'DISPATCHED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AlertTrigger" AS ENUM ('DRUM_NOT_IN_CURING', 'CURING_LOG_NOT_UPDATED', 'UNDER_CURED', 'TEST_OVERDUE', 'TEST_FAILED', 'PASSED_NO_REQUISITION', 'BOILER_READING_MISSED', 'NO_RECIPE', 'DAILY_MD_SUMMARY', 'JOB_FAILURE', 'FEED_STALE');

-- CreateEnum
CREATE TYPE "EscalationAnchor" AS ENUM ('FROM_UNLOAD', 'FROM_LAST_CURING_ENTRY', 'FROM_EVENT', 'FROM_TEST_DUE', 'FROM_SHIFT_END');

-- CreateEnum
CREATE TYPE "EscalationObject" AS ENUM ('DRUM', 'CURING_LOG', 'HOT_SET_TEST', 'BOILER_SHIFT', 'LINE');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "WhatsAppRoute" AS ENUM ('SHEET', 'API');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'CLOSE', 'REOPEN');

-- CreateEnum
CREATE TYPE "AuditSource" AS ENUM ('UI', 'JOB', 'IMPORT', 'API');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "roles" "Role"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMPTZ(3),
    "personId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persons" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "responsibilities" (
    "id" TEXT NOT NULL,
    "area" "ResponsibilityArea" NOT NULL,
    "personId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "responsibilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plants" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lines" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "erpCode" TEXT,
    "plantId" TEXT NOT NULL,
    "inScope" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_defs" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shift_defs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "curing_units" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CuringUnitType" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "curing_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boilers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "boilers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "sizeSqMm" INTEGER,
    "voltageKv" INTEGER,
    "isCuringItem" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "curing_recipes" (
    "id" TEXT NOT NULL,
    "compound" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "curingType" TEXT NOT NULL,
    "approvedCuringHrs" DECIMAL(6,2) NOT NULL,
    "waitBeforeTestHrs" DECIMAL(6,2) NOT NULL,
    "inUse" BOOLEAN NOT NULL DEFAULT true,
    "status" "RecipeStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMPTZ(3),
    "remarks" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "curing_recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drums" (
    "id" TEXT NOT NULL,
    "gridEntryId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "unloadDate" DATE NOT NULL,
    "unloadedAt" TIMESTAMPTZ(3),
    "unloadTimeSource" "UnloadTimeSource" NOT NULL DEFAULT 'UNKNOWN',
    "prodOrders" TEXT[],
    "mcNo" TEXT,
    "party" TEXT,
    "coreItem" TEXT NOT NULL,
    "productId" TEXT,
    "drumNo" TEXT NOT NULL,
    "drumSize" TEXT,
    "lengthM" DECIMAL(10,2) NOT NULL,
    "enteredBy" TEXT,
    "stockStatus" TEXT,
    "isCuringItem" BOOLEAN NOT NULL DEFAULT true,
    "status" "DrumStatus" NOT NULL DEFAULT 'MADE',
    "dataFlags" TEXT[],
    "source" "RecordSource" NOT NULL,
    "lastSyncAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "drums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "curing_logs" (
    "id" TEXT NOT NULL,
    "lotNo" TEXT,
    "cycleNo" INTEGER NOT NULL DEFAULT 1,
    "drumId" TEXT,
    "matchMethod" "MatchMethod",
    "matchedAt" TIMESTAMPTZ(3),
    "coreProductionDate" DATE,
    "productId" TEXT,
    "productName" TEXT,
    "coreDrumNo" TEXT NOT NULL,
    "lengthM" DECIMAL(10,2),
    "xlpeCompound" TEXT,
    "curingUnitId" TEXT,
    "chamberTankText" TEXT,
    "curingStartAt" TIMESTAMPTZ(3) NOT NULL,
    "curingEndAt" TIMESTAMPTZ(3),
    "recipeId" TEXT,
    "plannedCuringHrs" DECIMAL(6,2),
    "actualCuringHrs" DECIMAL(6,2),
    "hoursDeviation" DECIMAL(6,2),
    "timeCheck" "TimeCheck",
    "testDueAt" TIMESTAMPTZ(3),
    "testResult" "TestResult",
    "lotStatus" "DrumStatus",
    "visualCheck" "VisualCheck",
    "visualNote" TEXT,
    "requisitionId" TEXT,
    "sentDate" TIMESTAMPTZ(3),
    "remarks" TEXT,
    "mdRemarks" TEXT,
    "source" "RecordSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "curing_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hot_set_tests" (
    "id" TEXT NOT NULL,
    "curingLogId" TEXT NOT NULL,
    "drumId" TEXT,
    "lotNo" TEXT,
    "sampleEnd" TEXT,
    "testType" TEXT,
    "readings" JSONB,
    "hotSetPct" DECIMAL(6,2),
    "permanentSetPct" DECIMAL(6,2),
    "result" "TestResult" NOT NULL,
    "testedAt" TIMESTAMPTZ(3) NOT NULL,
    "testedBy" TEXT,
    "remarks" TEXT,
    "source" "RecordSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "hot_set_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boiler_readings" (
    "id" TEXT NOT NULL,
    "boilerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "shiftId" TEXT NOT NULL,
    "temperatureC" DECIMAL(6,2),
    "pressureBar" DECIMAL(6,2),
    "readings" JSONB,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,
    "recordedBy" TEXT,
    "remarks" TEXT,
    "source" "RecordSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "boiler_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "missing_drum_tracker" (
    "id" TEXT NOT NULL,
    "trackNo" SERIAL NOT NULL,
    "drumId" TEXT NOT NULL,
    "status" "TrackerStatus" NOT NULL,
    "curingLogId" TEXT,
    "curingStartAt" TIMESTAMPTZ(3),
    "hoursLate" DECIMAL(8,2),
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "lastAlertAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" "DelayReason",
    "remarks" TEXT,
    "mdRemarks" TEXT,
    "manualUpdatedBy" TEXT,
    "manualUpdatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "missing_drum_tracker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requisitions" (
    "id" TEXT NOT NULL,
    "reqNo" TEXT NOT NULL,
    "status" "RequisitionStatus" NOT NULL DEFAULT 'RAISED',
    "raisedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raisedBy" TEXT,
    "dispatchedAt" TIMESTAMPTZ(3),
    "receivedAt" TIMESTAMPTZ(3),
    "totalLengthM" DECIMAL(12,2),
    "remarks" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "requisitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_rules" (
    "id" TEXT NOT NULL,
    "trigger" "AlertTrigger" NOT NULL,
    "level" INTEGER NOT NULL,
    "anchor" "EscalationAnchor" NOT NULL,
    "delayMinutes" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "escalation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalations" (
    "id" TEXT NOT NULL,
    "trigger" "AlertTrigger" NOT NULL,
    "objectType" "EscalationObject" NOT NULL,
    "objectId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "firedAt" TIMESTAMPTZ(3),
    "resolvedAt" TIMESTAMPTZ(3),
    "alertId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "escalations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "trigger" "AlertTrigger" NOT NULL,
    "level" INTEGER,
    "personId" TEXT,
    "phone" TEXT,
    "message" TEXT NOT NULL,
    "objectRefs" TEXT[],
    "route" "WhatsAppRoute" NOT NULL,
    "isTest" BOOLEAN NOT NULL DEFAULT true,
    "status" "AlertStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerId" TEXT,
    "error" TEXT,
    "queuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_history" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "madeCount" INTEGER NOT NULL DEFAULT 0,
    "missingCount" INTEGER NOT NULL DEFAULT 0,
    "inCuringCount" INTEGER NOT NULL DEFAULT 0,
    "awaitingTestCount" INTEGER NOT NULL DEFAULT 0,
    "testOverdueCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "passedCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "inCuringKm" DECIMAL(10,3),
    "awaitingTestKm" DECIMAL(10,3),
    "passedKm" DECIMAL(10,3),
    "sentKm" DECIMAL(10,3),
    "passRatePct" DECIMAL(5,2),
    "complianceByLine" JSONB,
    "openEscalations" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'job:W0',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),
    "rowsRead" INTEGER NOT NULL DEFAULT 0,
    "rowsChanged" INTEGER NOT NULL DEFAULT 0,
    "alertsQueued" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "details" JSONB,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),
    "rowsRead" INTEGER NOT NULL DEFAULT 0,
    "rowsImported" INTEGER NOT NULL DEFAULT 0,
    "rowsRejected" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB,
    "importedBy" TEXT,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "field" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "changedBy" TEXT,
    "source" "AuditSource" NOT NULL,
    "changedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_EscalationRecipients" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_EscalationRecipients_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_personId_key" ON "users"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "persons_name_key" ON "persons"("name");

-- CreateIndex
CREATE UNIQUE INDEX "responsibilities_area_personId_key" ON "responsibilities"("area", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "plants_code_key" ON "plants"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lines_code_key" ON "lines"("code");

-- CreateIndex
CREATE UNIQUE INDEX "shift_defs_code_key" ON "shift_defs"("code");

-- CreateIndex
CREATE UNIQUE INDEX "curing_units_code_key" ON "curing_units"("code");

-- CreateIndex
CREATE UNIQUE INDEX "boilers_code_key" ON "boilers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");

-- CreateIndex
CREATE UNIQUE INDEX "products_name_key" ON "products"("name");

-- CreateIndex
CREATE INDEX "curing_recipes_compound_productId_curingType_status_inUse_idx" ON "curing_recipes"("compound", "productId", "curingType", "status", "inUse");

-- CreateIndex
CREATE UNIQUE INDEX "drums_gridEntryId_key" ON "drums"("gridEntryId");

-- CreateIndex
CREATE INDEX "drums_drumNo_unloadedAt_idx" ON "drums"("drumNo", "unloadedAt");

-- CreateIndex
CREATE INDEX "drums_drumNo_unloadDate_idx" ON "drums"("drumNo", "unloadDate");

-- CreateIndex
CREATE INDEX "drums_lineId_unloadDate_idx" ON "drums"("lineId", "unloadDate");

-- CreateIndex
CREATE INDEX "drums_status_idx" ON "drums"("status");

-- CreateIndex
CREATE INDEX "curing_logs_coreDrumNo_curingStartAt_idx" ON "curing_logs"("coreDrumNo", "curingStartAt");

-- CreateIndex
CREATE INDEX "curing_logs_curingStartAt_idx" ON "curing_logs"("curingStartAt");

-- CreateIndex
CREATE INDEX "curing_logs_testDueAt_idx" ON "curing_logs"("testDueAt");

-- CreateIndex
CREATE INDEX "curing_logs_lotStatus_idx" ON "curing_logs"("lotStatus");

-- CreateIndex
CREATE UNIQUE INDEX "curing_logs_drumId_cycleNo_key" ON "curing_logs"("drumId", "cycleNo");

-- CreateIndex
CREATE INDEX "hot_set_tests_curingLogId_testedAt_idx" ON "hot_set_tests"("curingLogId", "testedAt");

-- CreateIndex
CREATE UNIQUE INDEX "boiler_readings_boilerId_date_shiftId_key" ON "boiler_readings"("boilerId", "date", "shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "missing_drum_tracker_trackNo_key" ON "missing_drum_tracker"("trackNo");

-- CreateIndex
CREATE UNIQUE INDEX "missing_drum_tracker_drumId_key" ON "missing_drum_tracker"("drumId");

-- CreateIndex
CREATE UNIQUE INDEX "missing_drum_tracker_curingLogId_key" ON "missing_drum_tracker"("curingLogId");

-- CreateIndex
CREATE INDEX "missing_drum_tracker_status_closedAt_idx" ON "missing_drum_tracker"("status", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "requisitions_reqNo_key" ON "requisitions"("reqNo");

-- CreateIndex
CREATE INDEX "requisitions_status_idx" ON "requisitions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "escalation_rules_trigger_level_key" ON "escalation_rules"("trigger", "level");

-- CreateIndex
CREATE INDEX "escalations_resolvedAt_dueAt_idx" ON "escalations"("resolvedAt", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "escalations_trigger_objectType_objectId_level_key" ON "escalations"("trigger", "objectType", "objectId", "level");

-- CreateIndex
CREATE INDEX "alerts_status_queuedAt_idx" ON "alerts"("status", "queuedAt");

-- CreateIndex
CREATE INDEX "alerts_trigger_sentAt_idx" ON "alerts"("trigger", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "daily_history_date_key" ON "daily_history"("date");

-- CreateIndex
CREATE INDEX "job_runs_job_startedAt_idx" ON "job_runs"("job", "startedAt");

-- CreateIndex
CREATE INDEX "audit_logs_tableName_rowId_idx" ON "audit_logs"("tableName", "rowId");

-- CreateIndex
CREATE INDEX "audit_logs_changedAt_idx" ON "audit_logs"("changedAt");

-- CreateIndex
CREATE INDEX "_EscalationRecipients_B_index" ON "_EscalationRecipients"("B");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responsibilities" ADD CONSTRAINT "responsibilities_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lines" ADD CONSTRAINT "lines_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "plants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curing_recipes" ADD CONSTRAINT "curing_recipes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drums" ADD CONSTRAINT "drums_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drums" ADD CONSTRAINT "drums_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curing_logs" ADD CONSTRAINT "curing_logs_drumId_fkey" FOREIGN KEY ("drumId") REFERENCES "drums"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curing_logs" ADD CONSTRAINT "curing_logs_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curing_logs" ADD CONSTRAINT "curing_logs_curingUnitId_fkey" FOREIGN KEY ("curingUnitId") REFERENCES "curing_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curing_logs" ADD CONSTRAINT "curing_logs_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "curing_recipes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curing_logs" ADD CONSTRAINT "curing_logs_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "requisitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hot_set_tests" ADD CONSTRAINT "hot_set_tests_curingLogId_fkey" FOREIGN KEY ("curingLogId") REFERENCES "curing_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hot_set_tests" ADD CONSTRAINT "hot_set_tests_drumId_fkey" FOREIGN KEY ("drumId") REFERENCES "drums"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boiler_readings" ADD CONSTRAINT "boiler_readings_boilerId_fkey" FOREIGN KEY ("boilerId") REFERENCES "boilers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boiler_readings" ADD CONSTRAINT "boiler_readings_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shift_defs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missing_drum_tracker" ADD CONSTRAINT "missing_drum_tracker_drumId_fkey" FOREIGN KEY ("drumId") REFERENCES "drums"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missing_drum_tracker" ADD CONSTRAINT "missing_drum_tracker_curingLogId_fkey" FOREIGN KEY ("curingLogId") REFERENCES "curing_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "alerts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EscalationRecipients" ADD CONSTRAINT "_EscalationRecipients_A_fkey" FOREIGN KEY ("A") REFERENCES "escalation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EscalationRecipients" ADD CONSTRAINT "_EscalationRecipients_B_fkey" FOREIGN KEY ("B") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
