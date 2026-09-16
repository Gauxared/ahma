/**
 * ЗАВЕСТИ ОРГАНИЗАЦИЮ И ВХОДЫ В НЕЁ — из командной строки.
 *
 * ЗАЧЕМ ОТДЕЛЬНО ОТ `demo-up.ts`. Тот поднимает ДЕМО-КОНТУР целиком: заводит
 * объект, гоняет протокол, ставит обход в очередь, а у арендатора `demo`
 * удаляет входы, которых нет в его перечне. Запускать его на работающем
 * сервере, чтобы добавить пару тестовых входов, значит занять единственный
 * воркер чужой задачей и рискнуть чужими данными.
 *
 * Здесь только одно действие: организация и люди в ней.
 *
 * ЗАЧЕМ ОТДЕЛЬНО ОТ ЭКРАНА «ДОСТУП». Экран заводит организацию с ОДНИМ первым
 * администратором — и правильно делает: это единственное действие, пересекающее
 * границу арендатора, и оно устроено уже остальных. Но завести десяток тестовых
 * входов через форму — десять заходов руками, и опечатка в адресе даёт
 * работающий вход, о котором никто не помнит.
 *
 * РАЗБОР И ЗАПИСЬ — ТЕ ЖЕ, ЧТО У ЭКРАНА (`@web/lib/access`). Свои проверки
 * адреса и пароля разошлись бы с проверками формы, и вход, заведённый здесь,
 * однажды перестал бы соответствовать тому, что форма считает допустимым.
 *
 * СУЩЕСТВУЮЩИЙ ВХОД НЕ ТРОГАЕТСЯ. Ни пароль, ни роли: повторный запуск с тем же
 * адресом молча сбросил бы пароль работающему человеку. Такой вход называется
 * вслух и пропускается.
 *
 * НЕ ДЛЯ БОЕВОГО КОНТУРА С НАСТОЯЩИМИ КЛИЕНТАМИ: пароль приходит аргументом
 * командной строки и остаётся в истории оболочки.
 *
 * Пример:
 *
 *   npx tsx tooling/add-users.ts \
 *     --organisation proba --name 'ООО «Проба»' \
 *     --user 'Иван Тестов:ivan@proba.ru:СекретСекрет:admin'
 */
import { argv, env, exit, stdout } from "node:process";

import { loadRoles } from "@platform/config/roles.js";
import { createPrismaClient, withTenant } from "@platform/db/prisma.js";

import { createUser, parseTenant, parseUser } from "@web/lib/access.js";

function флаг(name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

/** Все значения повторяющегося флага: `--user A --user B`. */
function флаги(name: string): readonly string[] {
  const значения: string[] = [];

  for (const [index, значение] of argv.entries()) {
    if (значение === `--${name}` && argv[index + 1] !== undefined) значения.push(argv[index + 1]!);
  }

  return значения;
}

function шаг(текст: string): void {
  stdout.write(`  ${текст}\n`);
}

async function main(): Promise<void> {
  const slug = флаг("organisation");
  const название = флаг("name");
  const описания = флаги("user");

  if (slug === undefined || название === undefined || описания.length === 0) {
    stdout.write(
      [
        "Заведение организации и входов в неё.",
        "",
        "  --organisation <адрес>     адрес организации: строчная латиница, цифры, дефис",
        "  --name '<Название>'        как организация называется для человека",
        "  --user 'Имя:адрес:пароль:роль'   можно повторять; роли — из config/roles",
        "",
      ].join("\n"),
    );
    exit(2);
  }

  const url = env["DATABASE_URL"];
  if (url === undefined || url === "") {
    stdout.write("DATABASE_URL не задан: заводить некуда\n");
    exit(2);
  }

  const организация = parseTenant({ slug, name: название });
  if (!организация.ok) {
    stdout.write(`организация не заведена: ${организация.reason}\n`);
    exit(2);
  }

  const роли = loadRoles().bundle.roles.map((role) => role.id);
  const люди = описания.map((описание) => {
    // Разделитель — двоеточие, и полей ровно четыре. Имя с двоеточием внутри
    // сломало бы разбор молча, поэтому режем на четыре и не больше.
    const [имя = "", адрес = "", пароль = "", роль = ""] = описание.split(":");
    return { описание, разобран: parseUser({ email: адрес, name: имя, password: пароль, role: роль }, роли) };
  });

  const плохие = люди.filter((человек) => !человек.разобран.ok);
  if (плохие.length > 0) {
    for (const человек of плохие) {
      const причина = человек.разобран.ok ? "" : человек.разобран.reason;
      stdout.write(`вход «${человек.описание}» не заведён: ${причина}\n`);
    }
    // Ни один вход не заводится, если хоть один описан неверно: половина
    // заведённой организации хуже незаведённой — её не отличить от целой.
    exit(2);
  }

  const db = createPrismaClient(url);

  try {
    const существующая = await db.tenant.findUnique({ where: { slug: организация.value.slug } });

    const арендатор =
      существующая ??
      (await db.tenant.create({
        data: { slug: организация.value.slug, displayName: организация.value.displayName },
      }));

    шаг(
      существующая === null
        ? `организация ${арендатор.slug} — «${арендатор.displayName}» заведена`
        : `организация ${арендатор.slug} — «${арендатор.displayName}» уже была`,
    );

    await withTenant(db, арендатор.id, async (tx) => {
      for (const человек of люди) {
        if (!человек.разобран.ok) continue;
        const вход = человек.разобран.value;

        const был = await tx.user.findUnique({
          where: { tenantId_email: { tenantId: арендатор.id, email: вход.email } },
          select: { id: true },
        });

        if (был !== null) {
          шаг(`вход ${вход.email} уже есть — пароль и роли не тронуты`);
          continue;
        }

        await createUser(tx, арендатор.id, вход);
        шаг(`вход ${вход.email} · ${вход.displayName} · роли: ${вход.roleIds.join(", ")}`);
      }
    });

    stdout.write(`\nВход: организация «${арендатор.slug}», адрес и пароль — как заданы выше.\n`);
  } finally {
    await db.$disconnect();
  }
}

await main();
