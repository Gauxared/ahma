/**
 * ПУЛЬТ ОБЯЗАН НАЗЫВАТЬ ТОТ ОБЪЕКТ, ЧЕЙ ВЕРДИКТ ПОКАЗЫВАЕТ.
 *
 * ЧТО ЗДЕСЬ ЗАЩИЩАЕТСЯ
 *
 * Read-модель Пульта брала САМЫЙ СТАРЫЙ объект и САМЫЙ СВЕЖИЙ артефакт обхода
 * двумя независимыми запросами, а экран складывал из них ссылку
 * `/objects/<шифр старого>/checks/<id чужого прогона>`.
 *
 * Пока объект в контуре был один, совпадение держалось само собой, и все гейты
 * были зелёными. На втором объекте гейт «каждое решение ведёт на существующий
 * экран» дал 404 — и это ещё мягкий исход. Хуже другой: шифр одного объекта над
 * вердиктом другого читается как вердикт по названному объекту, и человек
 * принимает решение не по тому файлу.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ НАБОР, А НЕ СТРОКА В СУЩЕСТВУЮЩЕМ
 *
 * Дефект поймался случайно: в контуре завёлся второй объект от ручного прогона.
 * Удали его — и гейт снова зелёный, а дефект на месте. Это ровно те «грабли №5»
 * из передачи контекста: **гейт, опирающийся на данные, а не на механизм.**
 *
 * Поэтому набор СТРОИТ положение сам: заводит второй объект со своим свежим
 * артефактом и убирает его за собой. Он не спрашивает, что лежит в контуре, —
 * он делает так, чтобы самый свежий прогон принадлежал НЕ самому старому
 * объекту.
 */
import { existsSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { createPrismaClient, withTenant } from "@platform/db/prisma";

// Playwright запускает наборы своим процессом и `.env` не читает.
if ((process.env.DATABASE_URL ?? "") === "" && existsSync(".env")) {
  process.loadEnvFile(".env");
}

import { ADMIN, signIn, TENANT } from "./support/auth.js";

/** Шифр свой и с хвостом времени: два прогона набора не должны сталкиваться. */
const ШИФР = `PAIR-${Date.now().toString(36).slice(-5).toUpperCase()}`;
/** Имя объекта: именно его Пульт показывает человеку, шифр живёт в адресе. */
const ИМЯ = `Сверка пары ${ШИФР}`;

interface Засев {
  readonly tenantId: string;
  readonly objectId: string;
  readonly checkId: string;
}

async function засеять(): Promise<Засев> {
  const db = createPrismaClient(process.env.DATABASE_URL);

  try {
    const tenant = await db.tenant.findFirst({ where: { slug: TENANT } });

    if (tenant === null) {
      throw new Error(`Арендатора «${TENANT}» нет: поднимите контур через pnpm demo:up`);
    }

    return await withTenant(db, tenant.id, async (tx) => {
      const кто = await tx.user.findFirst({ where: { email: ADMIN } });

      if (кто === null) throw new Error(`Пользователя ${ADMIN} нет: поднимите контур через pnpm demo:up`);

      const object = await tx.projectObject.create({
        data: { tenantId: tenant.id, code: ШИФР, name: ИМЯ, region: "Курганская область" },
      });

      const check = await tx.check.create({
        data: {
          tenantId: tenant.id,
          objectId: object.id,
          workflowId: "full-check",
          mode: "standard",
          status: "completed",
          createdBy: кто.id,
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      });

      // Артефакт СВЕЖЕЕ всех прочих: именно он и определяет, чей вердикт
      // показывает Пульт. Без этого положение не воспроизводится.
      await tx.artifact.create({
        data: {
          tenantId: tenant.id,
          checkId: check.id,
          operationId: "check-object",
          operationVersion: 1,
          completeness: "full",
          inputHashes: [],
          body: { verdict: "🟡 с условием — засев набора сверки пары" },
          producedAt: new Date(),
        },
      });

      return { tenantId: tenant.id, objectId: object.id, checkId: check.id };
    });
  } finally {
    await db.$disconnect();
  }
}

async function убрать(засев: Засев): Promise<void> {
  const db = createPrismaClient(process.env.DATABASE_URL);

  try {
    // Артефакт и Проверка уходят каскадом за объектом: связи объявлены
    // `onDelete: Cascade`, и удалять их поимённо значило бы повторять схему.
    await withTenant(db, засев.tenantId, (tx) => tx.projectObject.delete({ where: { id: засев.objectId } }));
  } finally {
    await db.$disconnect();
  }
}

test.describe("пульт: объект и вердикт — одна пара", () => {
  let засев: Засев | undefined;

  test.beforeAll(async () => {
    засев = await засеять();
  });

  test.afterAll(async () => {
    if (засев !== undefined) await убрать(засев);
  });

  test("ссылка на прогон ведёт в ТОТ объект, которому прогон принадлежит", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Пульт" })).toBeVisible();

    const ссылки = await page
      .locator(`main a[href*='/checks/${засев?.checkId ?? "нет"}']`)
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));

    expect(
      ссылки.length,
      "Пульт не предлагает перейти к самому свежему прогону — показывать нечего либо ссылка потерялась",
    ).toBeGreaterThan(0);

    for (const href of ссылки) {
      expect(
        href,
        `Пульт ведёт в ${href}: прогон принадлежит объекту ${ШИФР}, а шифр в адресе другой`,
      ).toContain(`/objects/${ШИФР}/`);
    }
  });

  test("ни одна ссылка не смешивает шифр одного объекта с данными другого", async ({ page }) => {
    /**
     * Пара «объект — вердикт» была не единственной, которую Пульт складывал из
     * двух независимых запросов. Список документов и счётчики позиций брались
     * по ВСЕМУ арендатору и подписывались шифром показанного объекта: ссылка
     * выходила как `/objects/<показанный>/documents/<версия чужого документа>`.
     *
     * Проверяется весь набор ссылок, а не одна: чинили пару за парой, и каждый
     * раз оставалась следующая. Здесь сторожится СВОЙСТВО — на Пульте нет
     * адреса, ведущего в никуда, — а не конкретное место.
     */
    await signIn(page, ADMIN);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Пульт" })).toBeVisible();

    const адреса = await page
      .locator("main a[href^='/objects/']")
      .evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute("href") ?? ""))]);

    expect(адреса.length, "на Пульте нет ни одной ссылки на объект — сторожить нечего").toBeGreaterThan(0);

    for (const href of адреса) {
      const ответ = await page.goto(href);
      expect(ответ?.status(), `Пульт предлагает ${href}, и экран не открылся`).toBeLessThan(400);
    }
  });

  test("объект, названный на экране, — тот же, чей прогон показан", async ({ page }) => {
    // Ссылка могла бы вести верно, а подпись экрана называть чужой объект: это
    // два разных места, и совпадали они по случайности, а не по устройству.
    // Человеку Пульт показывает ИМЯ объекта — шифр живёт в адресе.
    await signIn(page, ADMIN);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Пульт" })).toBeVisible();
    await expect(
      page.locator("main header").getByText(ИМЯ),
      `Пульт показывает вердикт прогона объекта «${ИМЯ}», но называет другой объект`,
    ).toBeVisible();
  });
});
