/**
 * Поставить Проверку из командной строки — тем же кодом, что и веб.
 *
 * ЗАЧЕМ ЭТО ОТДЕЛЬНЫМ ИНСТРУМЕНТОМ. Прогон на сервере запускался руками:
 * вставкой строк `check` и `job` в базу. Такая вставка — ВТОРАЯ постановка
 * Проверки рядом с настоящей, и она уже расходилась с ней: ключ
 * идемпотентности, запись в журнал, поиск живой задачи — всё это надо было
 * повторить и легко забыть. Забытая запись в журнал означает прогон без следа
 * «кто запустил», а забытый поиск живой задачи — два воркера на одной партии.
 *
 * Поэтому здесь ровно один вызов: `startCheck` — та же функция, которой
 * пользуются `/api/checks` и `/api/uploads`. Инструмент отвечает только за
 * разбор флагов и за поиск объекта по шифру.
 *
 *   npx tsx tooling/start-check.ts --object CX-DAG --mode агенты
 *
 * Режимы — словами формы: `быстрый`, `конвейер`, `агентный`, `агенты`.
 */
import { argv, env, exit } from "node:process";

import { createPrismaClient, withTenant } from "../platform/db/prisma.js";
import { режимПрогона, startCheck } from "../apps/web/lib/start-check.js";

function флаг(имя: string): string | undefined {
  const index = argv.indexOf(`--${имя}`);
  return index === -1 ? undefined : argv[index + 1];
}

async function main(): Promise<void> {
  const code = флаг("object");
  if (code === undefined) {
    console.error("Укажите объект: --object <шифр> [--mode агенты]");
    exit(2);
  }

  const url = env["DATABASE_URL"];
  if (url === undefined || url === "") {
    console.error("DATABASE_URL не задан: поставить Проверку некуда");
    exit(2);
  }

  const db = createPrismaClient(url);
  const { workflowId, mode } = режимПрогона(флаг("mode") ?? "конвейер");

  /**
   * АРЕНДАТОР НАЗЫВАЕТСЯ ЯВНО, потому что связь работает под RLS.
   *
   * Без контекста арендатора роль приложения не видит НИ ОДНОЙ строки, и
   * запрос отвечает «объекта нет» — то есть ровно так же, как на опечатку в
   * шифре. Такой ответ хуже отказа: он выглядит фактом.
   */
  const tenant = флаг("tenant");
  if (tenant === undefined) {
    console.error("Укажите арендатора: --tenant <uuid>. Под RLS без него не видно ни одного объекта.");
    exit(2);
  }

  /**
   * ОБЪЕКТ МОЖЕТ БЫТЬ ЗАВЕДЁН ЭТИМ ЖЕ ВЫЗОВОМ — но только по явной просьбе.
   *
   * Прогон эталонного кейса начинается с того, что папку кладут на сервер, а
   * записи объекта в базе ещё нет. Заводить её вставкой в psql значит обойти
   * RLS правами владельца и оставить объект без арендатора в журнале.
   * `--create «Название»` делает это тем же путём, что и веб.
   */
  const object =
    (await withTenant(db, tenant, (tx) =>
      tx.projectObject.findFirst({ where: { code }, orderBy: { createdAt: "desc" } }),
    )) ??
    (флаг("create") === undefined
      ? null
      : await withTenant(db, tenant, (tx) =>
          tx.projectObject.create({ data: { tenantId: tenant, code, name: флаг("create")! } }),
        ));

  if (object === null) {
    console.error(`Объекта с шифром «${code}» в базе нет. Завести: --create «Название объекта».`);
    exit(1);
  }

  const root = env["STROYINTELLECT_OBJECTS_ROOT"] ?? "/srv/stroyintellekt/objects";
  const objectPath = `${root}/${object.tenantId}/${object.code}`;

  const outcome = await startCheck({
    db,
    tenantId: object.tenantId,
    objectId: object.id,
    objectCode: object.code,
    objectPath,
    batch: флаг("batch") ?? "все",
    workflowId,
    mode,
    // Кто запустил: по умолчанию — сам арендатор. Прогон, поставленный
    // инструментом, а не человеком, так и виден в журнале.
    actorId: флаг("actor") ?? object.tenantId,
    now: new Date(),
  });

  const свежая = await withTenant(db, object.tenantId, (tx) =>
    tx.check.findFirst({ where: { objectId: object.id }, orderBy: { createdAt: "desc" } }),
  );

  console.log(`Объект ${object.code} · ${object.name}`);
  console.log(`Папка: ${objectPath}`);
  console.log(`Воркфлоу ${workflowId}, режим ${mode} → ${outcome}`);
  console.log(`Проверка: ${свежая?.id ?? "не найдена"}`);

  await db.$disconnect();
}

await main();
