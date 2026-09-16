/**
 * Выдаёт роли приложения пароль и право входа.
 *
 * Роль создаётся миграцией без пароля намеренно: секрет не должен лежать в
 * версионируемом SQL. Здесь он приходит из окружения развёртывания.
 *
 * Запуск: DATABASE_OWNER_URL=... STROYINTELLECT_DB_APP_PASSWORD=... \
 *         pnpm tsx tooling/provision-db-role.ts
 */
import { existsSync } from "node:fs";

import { Client } from "pg";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const ownerUrl = process.env.DATABASE_OWNER_URL;
const password = process.env.STROYINTELLECT_DB_APP_PASSWORD;
const role = process.env.STROYINTELLECT_DB_APP_ROLE ?? "stroyintellect_app";

if (ownerUrl === undefined || ownerUrl === "") {
  throw new Error("DATABASE_OWNER_URL не задан: провизионирование роли выполняется владельцем схемы");
}

if (password === undefined || password === "") {
  throw new Error("STROYINTELLECT_DB_APP_PASSWORD не задан");
}

if (!/^[a-z_][a-z0-9_]*$/.test(role)) {
  throw new Error(`Недопустимое имя роли: ${JSON.stringify(role)}`);
}

const client = new Client({ connectionString: ownerUrl });
await client.connect();

try {
  // ALTER ROLE — utility-команда, плейсхолдеры в ней недопустимы. Имя роли уже
  // провалидировано регулярным выражением, пароль экранируется драйвером.
  await client.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD ${client.escapeLiteral(password)}`);

  const check = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1",
    [role],
  );

  const row = check.rows[0];
  if (row === undefined) {
    throw new Error(`Роль ${role} не найдена после ALTER`);
  }

  if (row.rolsuper || row.rolbypassrls) {
    throw new Error(
      `Роль ${role} обходит RLS (superuser=${row.rolsuper}, bypassrls=${row.rolbypassrls}). ` +
        "Изоляция арендатора не будет работать.",
    );
  }

  console.log(`Роль ${role} готова: вход разрешён, RLS применяется.`);
} finally {
  await client.end();
}
