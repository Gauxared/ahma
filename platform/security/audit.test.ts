/**
 * Журнал против НАСТОЯЩЕЙ базы.
 *
 * Главное здесь — не то, что запись создаётся, а то, что её НЕЛЬЗЯ изменить и
 * удалить. Проверять это моком бессмысленно вдвойне: гарантию даёт база, а не
 * код, и именно базу надо спросить.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, withTenant } from "@platform/db/prisma.js";

import { recordAudit, RETENTION_MONTHS } from "./audit.js";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined || DATABASE_URL === "" ? describe.skip : describe;

describe("глубина хранения", () => {
  it("названа числом по §11", () => {
    // Срок хранения — требование договора, и его место там, где о журнале
    // говорят, а не в задаче обслуживания.
    expect(RETENTION_MONTHS).toBe(12);
  });
});

describeDb("журнал неизменяем", () => {
  const db = createPrismaClient(DATABASE_URL);
  const tenant = randomUUID();
  const другой = randomUUID();
  let eventId = "";

  beforeAll(async () => {
    await db.tenant.createMany({
      data: [
        { id: tenant, slug: `a-${tenant.slice(0, 8)}`, displayName: "Аудит" },
        { id: другой, slug: `b-${другой.slice(0, 8)}`, displayName: "Чужой" },
      ],
    });

    const outcome = await withTenant(db, tenant, (tx) =>
      recordAudit(tx, tenant, {
        action: "check.started",
        resourceKind: "check",
        resourceId: "проверка-1",
      }),
    );

    expect(outcome.written).toBe(true);
    eventId = outcome.written ? outcome.id : "";
  });

  afterAll(async () => {
    // Уборка идёт ПОД ВЛАДЕЛЬЦЕМ СХЕМЫ, а не под ролью приложения.
    //
    // Это не обход собственного запрета, а его прямое следствие: приложение не
    // может удалить запись журнала ни при каких условиях, включая каскад при
    // удалении арендатора. Отключение клиента и чистка по §11 — операции
    // обслуживания, и выполняет их тот, у кого есть соответствующий доступ.
    //
    // Тест, убирающий за собой под ролью приложения, доказывал бы обратное.
    const ownerUrl = process.env.DATABASE_OWNER_URL;
    await db.$disconnect();

    if (ownerUrl === undefined || ownerUrl === "") return;

    const owner = createPrismaClient(ownerUrl);
    try {
      await owner.tenant.deleteMany({ where: { id: { in: [tenant, другой] } } });
    } finally {
      await owner.$disconnect();
    }
  });

  it("записывает событие", async () => {
    const rows = await withTenant(db, tenant, (tx) => tx.auditEvent.findMany());

    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("check.started");
  });

  it("НЕ ДАЁТ ИЗМЕНИТЬ запись", async () => {
    // «Мы не пишем UPDATE по журналу» — обещание, которое перестаёт быть верным
    // при первом невнимательном изменении. Здесь его нарушение невозможно.
    await expect(
      withTenant(db, tenant, (tx) =>
        tx.auditEvent.update({ where: { id: eventId }, data: { action: "подделка" } }),
      ),
    ).rejects.toThrow();
  });

  it("НЕ ДАЁТ УДАЛИТЬ запись ИЗ ПРИЛОЖЕНИЯ", async () => {
    // §11 требует глубины 12 месяцев. Чистку старше срока делает владелец схемы
    // отдельной операцией, а не приложение по ходу работы.
    await expect(
      withTenant(db, tenant, (tx) => tx.auditEvent.delete({ where: { id: eventId } })),
    ).rejects.toThrow();
  });

  it("НЕ показывает события чужого арендатора", async () => {
    await withTenant(db, другой, (tx) =>
      recordAudit(tx, другой, { action: "check.started", resourceKind: "check" }),
    );

    const свои = await withTenant(db, tenant, (tx) => tx.auditEvent.findMany());

    expect(свои).toHaveLength(1);
  });

  it("НЕ пишет содержимое документа, только его хэш", async () => {
    // Копия данных в журнале превращает его в ещё одно хранилище тех же
    // сведений — с теми же требованиями к защите и без возможности удалить по
    // требованию.
    const outcome = await withTenant(db, tenant, (tx) =>
      recordAudit(tx, tenant, {
        action: "document.received",
        resourceKind: "document",
        resourceId: "смета.xlsx",
        payloadHash: "a".repeat(64),
      }),
    );

    expect(outcome.written).toBe(true);

    const row = await withTenant(db, tenant, (tx) =>
      tx.auditEvent.findFirst({ where: { action: "document.received" } }),
    );

    expect(row?.payloadHash).toBe("a".repeat(64));
  });

  it("ВОЗВРАЩАЕТ неудачу записи, а не бросает и не молчит", async () => {
    // Сбой журнала не должен ронять состоявшееся действие, но и «ок» вместо
    // ошибки был бы худшим вариантом из трёх.
    const outcome = await withTenant(db, tenant, (tx) =>
      recordAudit(tx, "00000000-0000-0000-0000-000000000000", {
        action: "check.started",
        resourceKind: "check",
      }),
    );

    expect(outcome.written).toBe(false);
    expect(outcome.written === false && outcome.error.length).toBeGreaterThan(0);
  });
});
