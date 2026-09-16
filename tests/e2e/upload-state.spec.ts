/**
 * ЗАГРУЖЕННОЕ И РАЗОБРАННОЕ — РАЗНЫЕ СОСТОЯНИЯ, И ЭКРАН ОБЯЗАН ИХ РАЗЛИЧАТЬ.
 *
 * ЧТО ЗДЕСЬ ЗАЩИЩАЕТСЯ
 *
 * Пройдено руками по списку Г-путей: загрузил семь файлов двумя партиями,
 * открыл карточку объекта — и прочитал «К объекту не загружено ни одного
 * файла». Утверждение ложное. Документами файлы становятся после обхода, но
 * человек об этом не знает и читает это как «загрузка не сработала» — на
 * встрече это конец разговора, а не мелочь формулировки.
 *
 * Набор строит именно тот промежуток, в котором ошибка и живёт: партия
 * загружена, прогон её ещё не читал. Ни один существующий гейт туда не
 * попадал — они либо до загрузки, либо после прогона.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫМ ФАЙЛОМ, А НЕ СТРОКОЙ В `screens.spec.ts`
 *
 * Набор ЗАВОДИТ объект и обязан убрать его за собой: оставленный объект
 * становится «ещё одним объектом» для соседних гейтов — тот самый мусор,
 * которым прогоны наборов уже ломали чужие проверки (`Ф-158`). Убирать надо
 * через базу, а `screens.spec.ts` к базе намеренно не обращается.
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
const ШИФР = `UPL-${Date.now().toString(36).slice(-5).toUpperCase()}`;

async function убрать(): Promise<void> {
  const db = createPrismaClient(process.env.DATABASE_URL);

  try {
    const tenant = await db.tenant.findFirst({ where: { slug: TENANT } });
    if (tenant === null) return;

    await withTenant(db, tenant.id, (tx) => tx.projectObject.deleteMany({ where: { code: ШИФР } }));
  } finally {
    await db.$disconnect();
  }
}

test.describe("загружено, но ещё не разобрано", () => {
  test.afterAll(убрать);

  test("карточка объекта не утверждает, что файлов нет, когда они загружены", async ({ page }) => {
    await signIn(page, ADMIN);

    await page.goto("/objects");
    await page.locator("form[action='/api/objects'] input[name='шифр']").fill(ШИФР);
    await page.locator("form[action='/api/objects'] input[name='имя']").fill("Загружено, но не разобрано");
    await page.getByRole("button", { name: "Завести объект" }).click();
    await page.waitForURL(`**/objects/${ШИФР}/upload`);

    // ДО загрузки утверждение «файлов нет» — правда, и оно обязано стоять.
    // Без этой половины набор прошёл бы и на экране, который просто никогда не
    // говорит о пустоте.
    await page.goto(`/objects/${ШИФР}`);
    await expect(page.getByText("К объекту не загружено ни одного файла")).toBeVisible();

    await page.goto(`/objects/${ШИФР}/upload`);
    await page.locator("input[type=file]").setInputFiles([
      {
        name: "смета.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("№;Наименование;Сумма\n1;Стяжка;1000\n2;Штукатурка;2000\n"),
      },
    ]);
    await page.getByRole("button", { name: "Загрузить" }).click();
    await page.waitForURL(/upload\?/);

    await page.goto(`/objects/${ШИФР}`);

    await expect(
      page.getByText("К объекту не загружено ни одного файла"),
      "карточка утверждает, что файлов нет, хотя партия загружена",
    ).toHaveCount(0);

    await expect(
      page.getByText("В партиях лежит 1 файл"),
      "карточка не говорит, сколько файлов ждёт обхода",
    ).toBeVisible();
  });
});
