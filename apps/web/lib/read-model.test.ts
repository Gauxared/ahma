/**
 * Read-модель веб-просмотра против НАСТОЯЩЕЙ базы с включённым RLS.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ТЕСТ, ЕСЛИ RLS УЖЕ ПРОВЕРЕН
 *
 * `tenant-isolation.test.ts` доказывает, что политика в базе работает. Он не
 * доказывает, что ВЕБ ходит через неё: read-модель могла бы обратиться к
 * клиенту напрямую, минуя `withTenant`, и на своей машине это выглядело бы
 * исправным — данные-то возвращаются.
 *
 * Утечка между арендатерами обнаруживается не тогда, когда её ищут, а тогда,
 * когда один заказчик увидит объект другого. Поэтому проверяется именно путь
 * веба, а не только политика под ним.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, withTenant } from "@platform/db/prisma";

import { listObjects, NoTenantConfigured, readObject } from "./read-model";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined || DATABASE_URL === "" ? describe.skip : describe;

describeDb("веб-просмотр не пересекает границу арендатора", () => {
  const db = createPrismaClient(DATABASE_URL);
  const свой = randomUUID();
  const чужой = randomUUID();
  beforeAll(async () => {
    await db.tenant.createMany({
      data: [
        { id: свой, slug: `web-own-${свой.slice(0, 8)}`, displayName: "Свой" },
        { id: чужой, slug: `web-other-${чужой.slice(0, 8)}`, displayName: "Чужой" },
      ],
    });

    await withTenant(db, свой, (tx) =>
      tx.projectObject.create({ data: { tenantId: свой, code: "WEB-OWN", name: "Свой объект" } }),
    );
    await withTenant(db, чужой, (tx) =>
      tx.projectObject.create({ data: { tenantId: чужой, code: "WEB-OTHER", name: "Чужой объект" } }),
    );
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: { in: [свой, чужой] } } });
    await db.$disconnect();
  });

  it("показывает объекты своего арендатора", async () => {
    const rows = await listObjects(свой);

    expect(rows.some((row) => row.code === "WEB-OWN")).toBe(true);
  });

  it("НЕ показывает объекты чужого арендатора в списке", async () => {
    const rows = await listObjects(свой);

    expect(rows.some((row) => row.code === "WEB-OTHER")).toBe(false);
  });

  it("НЕ отдаёт чужой объект по прямому обращению к шифру", async () => {
    // Список можно отфильтровать и случайно оставить дыру в адресном доступе:
    // ссылку на чужой шифр подобрать не сложнее, чем угадать «KRG-2».
    expect(await readObject(свой, "WEB-OTHER")).toBeUndefined();
  });

  it("ОТКАЗЫВАЕТ без арендатора, а не показывает всё", async () => {
    // Пустой контекст обязан быть отказом, а не «выборкой без фильтра».
    await expect(listObjects("")).rejects.toBeInstanceOf(NoTenantConfigured);
    await expect(readObject("", "WEB-OWN")).rejects.toBeInstanceOf(NoTenantConfigured);
  });
});
