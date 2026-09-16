/**
 * Сессии против НАСТОЯЩЕЙ базы с включённым RLS.
 *
 * Моки здесь бессмысленны дважды: проверяется и поведение слоя, и то, что
 * политика изоляции распространяется на новую таблицу. Таблица без политики —
 * дыра, которую не видно: запросы работают, а второго рубежа нет.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, withTenant } from "@platform/db/prisma.js";

import {
  hashToken,
  hashesEqual,
  issueSession,
  revokeAllForUser,
  revokeSession,
  verifySession,
} from "./session.js";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined || DATABASE_URL === "" ? describe.skip : describe;

describe("хэш токена", () => {
  it("одинаков для одного токена и разный для разных", () => {
    expect(hashToken("абв")).toBe(hashToken("абв"));
    expect(hashToken("абв")).not.toBe(hashToken("абг"));
  });

  it("сравнение хэшей не падает на разной длине", () => {
    expect(hashesEqual(hashToken("а"), "00")).toBe(false);
  });
});

describeDb("жизненный цикл сессии", () => {
  const db = createPrismaClient(DATABASE_URL);
  const tenant = randomUUID();
  const other = randomUUID();
  let userId = "";
  let otherUserId = "";

  const now = new Date("2026-08-31T10:00:00.000Z");

  beforeAll(async () => {
    await db.tenant.createMany({
      data: [
        { id: tenant, slug: `s-${tenant.slice(0, 8)}`, displayName: "Свой" },
        { id: other, slug: `o-${other.slice(0, 8)}`, displayName: "Чужой" },
      ],
    });

    const user = await withTenant(db, tenant, (tx) =>
      tx.user.create({ data: { tenantId: tenant, email: "a@x.ru", displayName: "А" } }),
    );
    userId = user.id;

    const stranger = await withTenant(db, other, (tx) =>
      tx.user.create({ data: { tenantId: other, email: "b@x.ru", displayName: "Б" } }),
    );
    otherUserId = stranger.id;
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: { in: [tenant, other] } } });
    await db.$disconnect();
  });

  it("выдаёт токен и принимает его", async () => {
    const issued = await withTenant(db, tenant, (tx) => issueSession(tx, { tenantId: tenant, userId, now }));

    const check = await withTenant(db, tenant, (tx) => verifySession(tx, issued.token, now));

    expect(check.valid).toBe(true);
    expect(check.valid && check.userId).toBe(userId);
  });

  it("НЕ хранит токен в базе — только его хэш", async () => {
    // Дамп базы не должен давать рабочих сессий.
    const issued = await withTenant(db, tenant, (tx) => issueSession(tx, { tenantId: tenant, userId, now }));

    const row = await withTenant(db, tenant, (tx) =>
      tx.session.findUnique({ where: { id: issued.id } }),
    );

    expect(row).not.toBeNull();
    expect(JSON.stringify(row)).not.toContain(issued.token);
    expect(row!.tokenHash).toBe(hashToken(issued.token));
  });

  it("отвергает истёкшую сессию", async () => {
    // Срок проверяется при чтении, а не полагается на уборку просроченных:
    // уборка может отстать, а сессия без срока — это сессия без срока.
    const issued = await withTenant(db, tenant, (tx) =>
      issueSession(tx, { tenantId: tenant, userId, now, ttlHours: 1 }),
    );

    const позже = new Date(now.getTime() + 2 * 3_600_000);
    const check = await withTenant(db, tenant, (tx) => verifySession(tx, issued.token, позже));

    expect(check.valid).toBe(false);
    expect(check.valid === false && check.reason).toBe("истекла");
  });

  it("РАЗЛИЧАЕТ истёкшую и отозванную", async () => {
    // Первое — время вышло, второе — решение человека. Свести их к одному
    // «недействительна» значит потерять ответ на вопрос, почему выкинуло.
    const issued = await withTenant(db, tenant, (tx) => issueSession(tx, { tenantId: tenant, userId, now }));
    await withTenant(db, tenant, (tx) => revokeSession(tx, issued.token, now));

    const check = await withTenant(db, tenant, (tx) => verifySession(tx, issued.token, now));

    expect(check.valid === false && check.reason).toBe("отозвана");
  });

  it("отвергает выдуманный токен", async () => {
    const check = await withTenant(db, tenant, (tx) => verifySession(tx, "подделка", now));

    expect(check.valid === false && check.reason).toBe("не найдена");
  });

  it("выход со всех устройств отзывает все живые сессии", async () => {
    const a = await withTenant(db, tenant, (tx) => issueSession(tx, { tenantId: tenant, userId, now }));
    const b = await withTenant(db, tenant, (tx) => issueSession(tx, { tenantId: tenant, userId, now }));

    await withTenant(db, tenant, (tx) => revokeAllForUser(tx, userId, now));

    for (const issued of [a, b]) {
      const check = await withTenant(db, tenant, (tx) => verifySession(tx, issued.token, now));
      expect(check.valid).toBe(false);
    }
  });

  it("отзыв НЕ удаляет запись: след входа остаётся", async () => {
    const issued = await withTenant(db, tenant, (tx) => issueSession(tx, { tenantId: tenant, userId, now }));
    await withTenant(db, tenant, (tx) => revokeSession(tx, issued.token, now));

    const row = await withTenant(db, tenant, (tx) => tx.session.findUnique({ where: { id: issued.id } }));

    expect(row).not.toBeNull();
    expect(row!.revokedAt).not.toBeNull();
  });

  it("НЕ отдаёт сессию чужого арендатора", async () => {
    // Токен — глобально уникальная строка, и соблазн искать его без контекста
    // велик. RLS обязан закрыть это на втором рубеже.
    const чужая = await withTenant(db, other, (tx) =>
      issueSession(tx, { tenantId: other, userId: otherUserId, now }),
    );

    const check = await withTenant(db, tenant, (tx) => verifySession(tx, чужая.token, now));

    expect(check.valid).toBe(false);
    expect(check.valid === false && check.reason).toBe("не найдена");
  });
});
