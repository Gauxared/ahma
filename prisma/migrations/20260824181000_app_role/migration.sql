-- Отдельная роль приложения (ADR-R-015).
--
-- RLS не действует на суперпользователя и на владельца с BYPASSRLS, поэтому
-- политика изоляции арендатора работает только если приложение подключается
-- ОГРАНИЧЕННОЙ ролью. Миграции по-прежнему идут владельцем.
--
-- Пароль здесь не задаётся: он приходит из секрета развёртывания через
-- `tooling/provision-db-role.ts`.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'stroyintellect_app') THEN
    CREATE ROLE stroyintellect_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO stroyintellect_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO stroyintellect_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO stroyintellect_app;

-- Будущие таблицы миграций тоже доступны приложению без ручного гранта.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO stroyintellect_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO stroyintellect_app;

-- Приложение не меняет структуру: DDL остаётся за владельцем.
REVOKE CREATE ON SCHEMA public FROM stroyintellect_app;
