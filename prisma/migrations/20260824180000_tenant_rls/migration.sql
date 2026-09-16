-- Изоляция арендатора на уровне строк (ADR-R-015).
--
-- Это ВТОРОЙ рубеж. Первый — PolicyDecisionPoint в приложении (ADR-R-016).
-- Два рубежа нужны потому, что §12.1л принимается по журналу и по факту
-- разделения контуров: ошибка в одном слое не должна открывать данные.
--
-- Владелец таблиц по умолчанию обходит RLS, поэтому включаем FORCE.
-- Приложение обязано выставлять stroyintellect.tenant_id в каждой транзакции;
-- при отсутствии настройки политика не пропускает НИЧЕГО (fail closed).

CREATE OR REPLACE FUNCTION stroyintellect_current_tenant()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('stroyintellect.tenant_id', true), '')::uuid
$$;

DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'app_user', 'app_group', 'membership', 'role_binding',
    'project_object', 'document', 'document_version',
    'check', 'gate_subject', 'agent_run',
    'artifact', 'formula_trace', 'job', 'model_call', 'audit_event'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = stroyintellect_current_tenant()) '
      'WITH CHECK ("tenantId" = stroyintellect_current_tenant())',
      target
    );
  END LOOP;
END
$$;

-- Знание может быть общим для инсталляции (tenantId IS NULL) либо принадлежать
-- арендатору. Общее видно всем, чужое — никому.
ALTER TABLE knowledge_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_source FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON knowledge_source
  USING ("tenantId" IS NULL OR "tenantId" = stroyintellect_current_tenant())
  WITH CHECK ("tenantId" IS NULL OR "tenantId" = stroyintellect_current_tenant());

ALTER TABLE knowledge_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_record FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON knowledge_record
  USING ("tenantId" IS NULL OR "tenantId" = stroyintellect_current_tenant())
  WITH CHECK ("tenantId" IS NULL OR "tenantId" = stroyintellect_current_tenant());
