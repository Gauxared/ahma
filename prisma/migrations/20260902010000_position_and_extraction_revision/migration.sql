-- Позиции и ревизии извлечения — запросы №2 и №3 фронтового трека.
--
-- До этой миграции извлечённые позиции жили ТОЛЬКО внутри артефакта Проверки,
-- и то счётчиками: «позиций 101, по шифру 98». Экран §5.5 «загрузка и разбор»
-- показать таблицу строк не мог — её негде было взять.
--
-- Ревизии извлечения вёл `ExtractionLedger` в памяти и терял на выходе
-- процесса. Подтверждение человеком привязано к ХЭШУ значения; хранить его в
-- памяти означало, что подтверждение не переживает перезапуск.
--
-- Миграция ТОЛЬКО ДОБАВЛЯЕТ: существующие данные не трогаются и не сбрасываются.

CREATE TABLE "position" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"          UUID NOT NULL,
  "documentVersionId" UUID NOT NULL,
  "ordinal"           TEXT NOT NULL,
  "section"           TEXT NOT NULL,
  "sourceName"        TEXT NOT NULL,
  "basis"             TEXT NOT NULL,
  "unit"              TEXT NOT NULL,
  -- Десятичные строки, не numeric: рубли считает decimal.js с точностью 34,
  -- и приводить их к типу базы значит заводить второе округление.
  "quantity"          TEXT,
  "amount"            TEXT NOT NULL,
  "sourceRow"         INTEGER NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "position"
  ADD CONSTRAINT "position_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "position"
  ADD CONSTRAINT "position_documentVersionId_fkey"
  FOREIGN KEY ("documentVersionId") REFERENCES "document_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "position_tenantId_documentVersionId_idx"
  ON "position" ("tenantId", "documentVersionId");

CREATE TABLE "extraction_revision" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"       UUID NOT NULL,
  "subject"        TEXT NOT NULL,
  "value"          TEXT NOT NULL,
  "unit"           TEXT,
  "sourceDocument" TEXT NOT NULL,
  "sourceLocator"  TEXT NOT NULL,
  "origin"         TEXT NOT NULL,
  "critical"       BOOLEAN NOT NULL,
  "contentHash"    CHAR(64) NOT NULL,
  "previousId"     UUID,
  "author"         TEXT,
  "reason"         TEXT,
  "confirmedBy"    TEXT,
  "confirmedAt"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "extraction_revision"
  ADD CONSTRAINT "extraction_revision_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "extraction_revision_tenantId_subject_idx"
  ON "extraction_revision" ("tenantId", "subject");

-- Изоляция арендатора (ADR-R-015). Новая таблица без политики — дыра, которую
-- не видно: запросы продолжают работать, а второй рубеж на ней отсутствует.
ALTER TABLE "position" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "position" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "position"
  USING ("tenantId" = stroyintellect_current_tenant())
  WITH CHECK ("tenantId" = stroyintellect_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON "position" TO stroyintellect_app;

ALTER TABLE "extraction_revision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "extraction_revision" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "extraction_revision"
  USING ("tenantId" = stroyintellect_current_tenant())
  WITH CHECK ("tenantId" = stroyintellect_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON "extraction_revision" TO stroyintellect_app;
