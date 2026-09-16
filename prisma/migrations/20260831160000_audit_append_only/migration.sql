-- Журнал становится НЕИЗМЕНЯЕМЫМ на уровне базы (ТЗ §5.5, §11, §12.1л).
--
-- ПОЧЕМУ ПРАВ, А НЕ ДОГОВОРЁННОСТИ
--
-- «Мы не пишем UPDATE по журналу» — обещание, которое проверяется чтением всего
-- кода и перестаёт быть верным при первом же невнимательном изменении. Журнал,
-- который приложение МОЖЕТ переписать, юридически не журнал: он доказывает
-- ровно столько, сколько доказывает файл, доступный на запись тому, чьи
-- действия он фиксирует.
--
-- §12.1л требует подтверждать записями журнала обращения к внешним моделям.
-- Подтверждение имеет смысл только тогда, когда переписать запись нельзя.
--
-- УДАЛЕНИЕ ЗАПРЕЩЕНО ТОЖЕ
--
-- §11 требует глубины не менее 12 месяцев. Чистку старше срока делает владелец
-- схемы отдельной операцией обслуживания — то есть человек с другими правами,
-- а не приложение по ходу работы.

REVOKE UPDATE, DELETE ON "audit_event" FROM stroyintellect_app;

-- Умолчание для будущих таблиц выдаёт полный набор прав, поэтому запрет
-- проставляется явно и здесь: иначе повторное применение умолчаний вернёт
-- права обратно.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO stroyintellect_app;

REVOKE UPDATE, DELETE ON "audit_event" FROM stroyintellect_app;

-- Второй рубеж: правило на уровне таблицы. Права можно выдать заново по
-- недосмотру при провизионировании; правило переживёт это.
CREATE OR REPLACE FUNCTION audit_event_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Журнал неизменяем: запись % нельзя ни изменить, ни удалить (ТЗ §5.5, §12.1л)', OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_no_update
  BEFORE UPDATE ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION audit_event_immutable();

CREATE TRIGGER audit_event_no_delete
  BEFORE DELETE ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION audit_event_immutable();
