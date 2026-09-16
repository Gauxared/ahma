/**
 * Поднятие демонстрационного контура одной командой — `pnpm demo:up`.
 *
 * ЗАЧЕМ
 *
 * За одну сессию работы над экранами трижды выяснялось, что показывать нечего:
 * база пуста, набора КП нет, прогонов нет. Каждый раз это от пятнадцати до
 * сорока минут выяснения, какой командой что заводится и какие у объекта
 * идентификаторы, — до первой строки интерфейса.
 *
 * ИДЕМПОТЕНТНО
 *
 * Скрипт можно запускать сколько угодно раз: он не плодит вторые копии. Это не
 * удобство, а условие применимости — сценарий, который при повторе ломает
 * данные, запускают один раз и дальше боятся.
 *
 * ЧТО НЕ ДЕЛАЕТ
 *
 * Не запускает агентов и не ходит в модель: прогон с обзором сметчика требует
 * поднятого endpoint и минут ожидания. Здесь только то, что считается
 * детерминированно и быстро. Обзор добавляется отдельно, воркером.
 *
 * НЕ ДЛЯ ПРОМЫШЛЕННОГО КОНТУРА: заводит пользователей с известным паролем.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import argon2 from "argon2";

import { ArtifactRepository } from "@platform/db/artifact-repository.js";
import { createPrismaClient, withTenant } from "@platform/db/prisma.js";
import { compareOffers, type CompareBundle } from "@platform/execution/compare-offers.js";

import { CLOSED_MEMBERSHIP, TENANTS, type TenantSeed } from "./demo-tenants.js";
import { readFileSync } from "node:fs";

const OBJECT_CODE = "KRG-1";
const OBJECT_PATH = "reference-system/input-1";
const OFFERS = "tests/fixtures/offers-berezovsky.json";

function step(text: string): void {
  process.stdout.write(`  ${text}\n`);
}

/**
 * Наполнение ОДНОГО арендатора.
 *
 * Вынесено в функцию, а не повторено для второго арендатора: копия
 * оркестровки разошлась бы с оригиналом на первой правке — то же правило, по
 * которому прогон протокола запускается командной строкой, а не повторяется
 * здесь.
 */
async function seed(db: ReturnType<typeof createPrismaClient>, tenant: TenantSeed): Promise<void> {
  const TENANT = tenant.id;

  await db.tenant.upsert({
    where: { id: TENANT },
    update: { displayName: tenant.displayName },
    create: { id: TENANT, slug: tenant.slug, displayName: tenant.displayName },
  });
  step(`арендатор ${tenant.slug} — «${tenant.displayName}»`);

  const { objectId, userId } = await withTenant(db, TENANT, async (tx) => {
    const object = await tx.projectObject.upsert({
      where: { tenantId_code: { tenantId: TENANT, code: OBJECT_CODE } },
      update: {},
      create: { tenantId: TENANT, code: OBJECT_CODE, name: "ЖДПП Зауралье", region: "Курганская обл." },
    });

    let firstUser = "";

    for (const person of tenant.users) {
      // Хэш считается на пользователя, а не один на всех: пароли у арендаторов
      // разные, и общий хэш молча выдал бы демо-входу чужой пароль.
      const passwordHash = await argon2.hash(person.password);

      const user = await tx.user.upsert({
        where: { tenantId_email: { tenantId: TENANT, email: person.email } },
        update: { passwordHash, displayName: person.name },
        create: { tenantId: TENANT, email: person.email, displayName: person.name, passwordHash },
      });
      if (firstUser === "") firstUser = user.id;

      for (const role of person.roles) {
        await tx.roleBinding.upsert({
          where: {
            tenantId_subjectKind_subjectId_roleId: {
              tenantId: TENANT,
              subjectKind: "user",
              subjectId: user.id,
              roleId: role,
            },
          },
          update: {},
          create: { tenantId: TENANT, subjectKind: "user", subjectId: user.id, roleId: role },
        });
      }
    }

    return { objectId: object.id, userId: firstUser };
  });

  /**
   * Лишние входы удаляются — только у арендатора с закрытым составом.
   *
   * Повод настоящий: адрес демо-входа был написан с опечаткой
   * (`demo@strinel.ru`), исправление создало ВТОРОГО пользователя, и вход по
   * неверному адресу продолжал работать. Наполнение, которое умеет добавлять и
   * не умеет убирать, оставляет за собой такие хвосты молча.
   *
   * Привязки роли удаляются ОТДЕЛЬНО: `RoleBinding.subjectId` — обычный UUID
   * без внешнего ключа на пользователя, каскад его не заберёт, и остался бы
   * грант, указывающий в никуда.
   */
  if (CLOSED_MEMBERSHIP.includes(tenant.slug)) {
    const keep = tenant.users.map((person) => person.email);

    const removed = await withTenant(db, TENANT, async (tx) => {
      const stale = await tx.user.findMany({
        where: { email: { notIn: keep } },
        select: { id: true, email: true },
      });

      for (const person of stale) {
        await tx.roleBinding.deleteMany({ where: { subjectKind: "user", subjectId: person.id } });
        await tx.user.delete({ where: { id: person.id } });
      }

      return stale.map((person) => person.email);
    });

    if (removed.length > 0) step(`  лишние входы удалены: ${removed.join(", ")}`);
  }

  for (const person of tenant.users) {
    step(`  вход ${tenant.slug} / ${person.email} / ${person.password} — роли: ${person.roles.join(", ")}`);
  }

  // ── Прогон протокола: такты, гейты, предметы ──
  //
  // Через командную строку, а не повторением её логики здесь: копия оркестровки
  // разошлась бы с оригиналом на первой правке протокола.
  const already = await withTenant(db, TENANT, (tx) =>
    tx.check.count({ where: { workflowId: "full-check" } }),
  );

  if (already > 0) {
    step(`прогон протокола уже есть (${already}) — пропущен`);
  } else {
    try {
      execFileSync(
        "pnpm",
        ["si", "protocol", "--object", OBJECT_PATH, "--run", "new", "--tenant", TENANT, "--object-id", objectId],
        { stdio: "pipe" },
      );
    } catch {
      // Протокол возвращает 2, когда шаги заблокированы, — это НЕ ошибка
      // запуска, а содержательный результат: курганский прогон и должен
      // упереться в возвращённый ВОР. Прогон при этом сохранён.
    }
    step("прогон протокола full-check");
  }

  // ── Сравнение предложений ──
  const bundle = JSON.parse(readFileSync(OFFERS, "utf8")) as CompareBundle;
  const comparisons = await withTenant(db, TENANT, (tx) =>
    tx.check.count({ where: { workflowId: "compare-offers" } }),
  );

  if (comparisons > 0) {
    step(`сравнение КП уже есть (${comparisons}) — пропущено`);
  } else {
    await withTenant(db, TENANT, async (tx) => {
      const check = await tx.check.create({
        data: {
          tenantId: TENANT,
          objectId,
          workflowId: "compare-offers",
          mode: "standard",
          createdBy: userId,
          status: "completed",
          finishedAt: new Date(),
          completeness: "single",
        },
      });

      await new ArtifactRepository().save(
        tx,
        {
          id: randomUUID(),
          tenantId: TENANT,
          // ФИКСТУРА, И ОНА ПОМЕЧЕНА КАК ФИКСТУРА.
          //
          // Предложения берутся из `tests/fixtures/offers-berezovsky.json` —
          // они ВЫДУМАНЫ и относятся к другому объекту. На показе вопрос «чьи
          // это КП» неизбежен, и ответ «придуманные» после демонстрации хуже,
          // чем пометка до неё. `variant` для этого и есть в схеме артефакта;
          // экран сравнения читает его и говорит вслух.
          operation: { id: "compare-offers", version: 1, variant: "образец" },
          completeness: "single",
          inputHashes: [],
          degradations: [],
          body: compareOffers(bundle),
          producedAt: new Date().toISOString(),
        } as never,
        [],
        check.id,
      );
    });
    step("сравнение КП на трёх предложениях");
  }

  // ── Обход объекта: ставится в очередь, исполняет воркер ──
  const queued = await withTenant(db, TENANT, (tx) => tx.job.count({ where: { type: "check" } }));

  if (queued > 0) {
    step(`задача обхода уже ставилась (${queued}) — пропущена`);
  } else {
    const { JobQueue } = await import("@platform/queue/job-queue.js");
    await withTenant(db, TENANT, async (tx) => {
      const check = await tx.check.create({
        data: {
          tenantId: TENANT,
          objectId,
          workflowId: "check-object",
          mode: "standard",
          createdBy: userId,
          status: "queued",
        },
      });

      await new JobQueue().enqueue(tx, {
        tenantId: TENANT,
        type: "check",
        payload: { objectPath: OBJECT_PATH, objectCode: OBJECT_CODE },
        idempotencyKey: `demo:check:${check.id}`,
        now: new Date(),
        checkId: check.id,
      });
    });
    step("обход объекта поставлен в очередь");
  }

}

void (async () => {
  const db = createPrismaClient(process.env["DATABASE_URL"]);

  process.stdout.write("Демо-контур СтройИнтеллект\n\n");

  // По одному арендатору за раз, а не параллельно: наполнение ставит задачи в
  // очередь и вызывает командную строку, и одновременные прогоны боролись бы за
  // один и тот же воркер.
  for (const tenant of TENANTS) {
    await seed(db, tenant);
    process.stdout.write("\n");
  }

  process.stdout.write(
    [
      "Готово. Дальше:",
      "  pnpm dev:web                     веб на :3000",
      "  pnpm dev:worker                  воркер выполнит обход (с агентом, если поднят endpoint)",
      "",
      "Показ ведут демо-входом: организация без имени клиента и все права.",
      `  объект: http://localhost:3000/objects/${OBJECT_CODE}`,
      "",
    ].join("\n"),
  );

  await db.$disconnect();
})();
