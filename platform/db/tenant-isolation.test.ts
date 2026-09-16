/**
 * Изоляция арендатора на уровне базы (ADR-R-015).
 *
 * Гейт M0 требует, чтобы кросс-арендное чтение ПАДАЛО. Тест работает против
 * настоящего PostgreSQL с включённым RLS: проверять политику моками бессмысленно.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, withTenant } from "./prisma.js";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined || DATABASE_URL === "" ? describe.skip : describe;

describeDb("RLS: арендатор видит только своё", () => {
  // Свой клиент на файл: общий синглтон рвётся чужим disconnect().
  const db = createPrismaClient(DATABASE_URL);
  const alpha = randomUUID();
  const beta = randomUUID();

  beforeAll(async () => {
    await db.tenant.createMany({
      data: [
        { id: alpha, slug: `alpha-${alpha.slice(0, 8)}`, displayName: "Альфа" },
        { id: beta, slug: `beta-${beta.slice(0, 8)}`, displayName: "Бета" },
      ],
    });

    await withTenant(db, alpha, async (tx) => {
      await tx.projectObject.create({ data: { tenantId: alpha, code: "A-1", name: "Объект Альфы" } });
    });

    await withTenant(db, beta, async (tx) => {
      await tx.projectObject.create({ data: { tenantId: beta, code: "B-1", name: "Объект Беты" } });
    });
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: { in: [alpha, beta] } } });
    await db.$disconnect();
  });

  it("возвращает объекты своего арендатора", async () => {
    const rows = await withTenant(db, alpha, (tx) => tx.projectObject.findMany());

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Объект Альфы");
  });

  it("НЕ возвращает объекты чужого арендатора", async () => {
    const rows = await withTenant(db, beta, (tx) => tx.projectObject.findMany({ where: { code: "A-1" } }));

    expect(rows).toEqual([]);
  });

  it("не даёт создать строку под чужим арендатором", async () => {
    await expect(
      withTenant(db, alpha, (tx) =>
        tx.projectObject.create({ data: { tenantId: beta, code: "A-2", name: "Подлог" } }),
      ),
    ).rejects.toThrow();
  });

  it("без контекста арендатора не видно ничего — fail closed", async () => {
    const rows = await db.projectObject.findMany();

    expect(rows).toEqual([]);
  });

  it("контекст не протекает между транзакциями пула", async () => {
    await withTenant(db, alpha, (tx) => tx.projectObject.findMany());

    const leaked = await db.projectObject.findMany();
    expect(leaked).toEqual([]);
  });

  it("отвергает некорректный идентификатор арендатора до запроса", async () => {
    await expect(withTenant(db, "не-uuid", async () => null)).rejects.toThrow(/Некорректный идентификатор/);
  });
});
