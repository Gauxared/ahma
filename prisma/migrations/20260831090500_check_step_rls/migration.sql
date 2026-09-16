-- Изоляция арендатора для таблицы шагов прогона (ADR-R-015).
--
-- Новая таблица без политики RLS — это дыра, которую не видно: запросы
-- продолжают работать, а второй рубеж изоляции на ней просто отсутствует.
-- Поэтому политика заводится рядом с таблицей, а не отдельной задачей «потом».

ALTER TABLE "CheckStep" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CheckStep" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "CheckStep"
  USING ("tenantId" = stroyintellect_current_tenant())
  WITH CHECK ("tenantId" = stroyintellect_current_tenant());
