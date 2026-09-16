/**
 * Конфигурация Prisma 7.
 *
 * Начиная с 7-й версии строка подключения задаётся здесь, а не в
 * `schema.prisma`: схема описывает структуру, конфигурация — окружение.
 * Автозагрузку `.env` Prisma 7 тоже убрал, поэтому загружаем явно.
 */
import { existsSync } from "node:fs";

import { defineConfig, env } from "prisma/config";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

/**
 * Миграции выполняются ВЛАДЕЛЬЦЕМ схемы, а не ролью приложения: роль приложения
 * ограничена намеренно, чтобы на неё действовал RLS (ADR-R-015). Если владелец
 * не задан, откатываемся на DATABASE_URL — удобно в одноролевых окружениях.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_OWNER_URL ?? env("DATABASE_URL"),
  },
});
