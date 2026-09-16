-- CreateEnum
CREATE TYPE "SubjectKind" AS ENUM ('user', 'group');

-- CreateEnum
CREATE TYPE "CheckMode" AS ENUM ('express', 'standard', 'expert');

-- CreateEnum
CREATE TYPE "CheckStatus" AS ENUM ('queued', 'running', 'awaiting_human', 'completed', 'cancelled', 'failed');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'completed', 'failed', 'dead', 'cancelled');

-- CreateTable
CREATE TABLE "tenant" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_group" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "app_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "groupId" UUID NOT NULL,

    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_binding" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "subjectKind" "SubjectKind" NOT NULL,
    "subjectId" UUID NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "role_binding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_object" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_object_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "objectId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_version" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "acquisition" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_source" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_capability" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "capability" TEXT NOT NULL,
    "sections" TEXT[],

    CONSTRAINT "source_capability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_record" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "sourceId" UUID NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "section" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" DECIMAL(20,6),
    "unit" TEXT,
    "year" INTEGER,
    "status" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "staleAfterDays" INTEGER NOT NULL DEFAULT 90,
    "payload" JSONB,
    "supersededById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "objectId" UUID NOT NULL,
    "workflowId" TEXT NOT NULL,
    "mode" "CheckMode" NOT NULL,
    "status" "CheckStatus" NOT NULL DEFAULT 'queued',
    "completeness" TEXT NOT NULL DEFAULT 'full',
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "check_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gate_subject" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "checkId" UUID NOT NULL,
    "subjectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "reason" TEXT,
    "returnedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gate_subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_run" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "checkId" UUID NOT NULL,
    "agentId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "threadId" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "promptHash" CHAR(64),
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" JSONB,

    CONSTRAINT "agent_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifact" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "checkId" UUID,
    "operationId" TEXT NOT NULL,
    "operationVersion" INTEGER NOT NULL,
    "variant" TEXT,
    "completeness" TEXT NOT NULL,
    "inputHashes" TEXT[],
    "degradations" JSONB NOT NULL DEFAULT '[]',
    "body" JSONB NOT NULL,
    "producedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formula_trace" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "artifactId" UUID,
    "formulaId" TEXT NOT NULL,
    "formulaVersion" INTEGER NOT NULL,
    "inputs" JSONB NOT NULL,
    "output" DECIMAL(20,6) NOT NULL,
    "unit" TEXT,
    "rounding" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formula_trace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "checkId" UUID,
    "type" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "notBefore" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_call" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "process" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "contour" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dataClasses" TEXT[],
    "anonymized" BOOLEAN NOT NULL DEFAULT false,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costMinor" INTEGER,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "resourceKind" TEXT NOT NULL,
    "resourceId" TEXT,
    "reason" TEXT,
    "payloadHash" CHAR(64),
    "traceId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_slug_key" ON "tenant"("slug");

-- CreateIndex
CREATE INDEX "app_user_tenantId_idx" ON "app_user"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_tenantId_email_key" ON "app_user"("tenantId", "email");

-- CreateIndex
CREATE INDEX "app_group_tenantId_idx" ON "app_group"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "app_group_tenantId_slug_key" ON "app_group"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "membership_tenantId_idx" ON "membership"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "membership_userId_groupId_key" ON "membership"("userId", "groupId");

-- CreateIndex
CREATE INDEX "role_binding_tenantId_idx" ON "role_binding"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "role_binding_tenantId_subjectKind_subjectId_roleId_key" ON "role_binding"("tenantId", "subjectKind", "subjectId", "roleId");

-- CreateIndex
CREATE INDEX "project_object_tenantId_idx" ON "project_object"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "project_object_tenantId_code_key" ON "project_object"("tenantId", "code");

-- CreateIndex
CREATE INDEX "document_tenantId_objectId_idx" ON "document"("tenantId", "objectId");

-- CreateIndex
CREATE INDEX "document_version_tenantId_idx" ON "document_version"("tenantId");

-- CreateIndex
CREATE INDEX "document_version_contentHash_idx" ON "document_version"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "document_version_documentId_revision_key" ON "document_version"("documentId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_source_slug_key" ON "knowledge_source"("slug");

-- CreateIndex
CREATE INDEX "source_capability_capability_idx" ON "source_capability"("capability");

-- CreateIndex
CREATE UNIQUE INDEX "source_capability_sourceId_capability_key" ON "source_capability"("sourceId", "capability");

-- CreateIndex
CREATE INDEX "knowledge_record_capability_section_idx" ON "knowledge_record"("capability", "section");

-- CreateIndex
CREATE INDEX "knowledge_record_sourceId_supersededById_idx" ON "knowledge_record"("sourceId", "supersededById");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_record_contentHash_key" ON "knowledge_record"("contentHash");

-- CreateIndex
CREATE INDEX "check_tenantId_objectId_idx" ON "check"("tenantId", "objectId");

-- CreateIndex
CREATE INDEX "check_tenantId_status_idx" ON "check"("tenantId", "status");

-- CreateIndex
CREATE INDEX "gate_subject_tenantId_idx" ON "gate_subject"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "gate_subject_checkId_subjectId_key" ON "gate_subject"("checkId", "subjectId");

-- CreateIndex
CREATE INDEX "agent_run_tenantId_checkId_idx" ON "agent_run"("tenantId", "checkId");

-- CreateIndex
CREATE INDEX "artifact_tenantId_checkId_idx" ON "artifact"("tenantId", "checkId");

-- CreateIndex
CREATE INDEX "artifact_tenantId_operationId_idx" ON "artifact"("tenantId", "operationId");

-- CreateIndex
CREATE INDEX "formula_trace_tenantId_artifactId_idx" ON "formula_trace"("tenantId", "artifactId");

-- CreateIndex
CREATE UNIQUE INDEX "job_idempotencyKey_key" ON "job"("idempotencyKey");

-- CreateIndex
CREATE INDEX "job_status_notBefore_idx" ON "job"("status", "notBefore");

-- CreateIndex
CREATE INDEX "job_tenantId_checkId_idx" ON "job"("tenantId", "checkId");

-- CreateIndex
CREATE INDEX "model_call_tenantId_contour_at_idx" ON "model_call"("tenantId", "contour", "at");

-- CreateIndex
CREATE INDEX "audit_event_tenantId_at_idx" ON "audit_event"("tenantId", "at");

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_group" ADD CONSTRAINT "app_group_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "app_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_binding" ADD CONSTRAINT "role_binding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_object" ADD CONSTRAINT "project_object_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "project_object"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_version" ADD CONSTRAINT "document_version_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_capability" ADD CONSTRAINT "source_capability_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "knowledge_source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_record" ADD CONSTRAINT "knowledge_record_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "knowledge_source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_record" ADD CONSTRAINT "knowledge_record_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "knowledge_record"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check" ADD CONSTRAINT "check_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check" ADD CONSTRAINT "check_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "project_object"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_subject" ADD CONSTRAINT "gate_subject_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "check"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "check"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "check"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "check"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_call" ADD CONSTRAINT "model_call_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
