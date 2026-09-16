/**
 * Заведение объекта и выдача доступа — два конца тракта, которых не было.
 *
 * ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ
 *
 * Не «форма открылась», а то, ради чего формы заведены:
 *
 *  · заведённый объект СУЩЕСТВУЕТ и в него можно грузить файлы;
 *  · повтор шифра отказывает с причиной, а не сообщением базы;
 *  · заведённый человек ВХОДИТ, и это проверено настоящим входом;
 *  · заведённая организация ИЗОЛИРОВАНА — её администратор не видит ни одного
 *    чужого объекта, включая прямое обращение по чужому шифру.
 *
 * Последнее — главное. Экран, заводящий организации, ослабляет изоляцию ровно
 * настолько, насколько плохо он написан, а изоляция здесь — главное свойство
 * безопасности продукта.
 *
 * ДАННЫЕ ЧУЖИЕ НЕ ТРОГАЮТСЯ: и объект, и организация создаются свои, с
 * уникальным суффиксом, и удаляются в конце. Суффикс нужен потому, что набор
 * гоняется многократно, а шифр объекта уникален в пределах арендатора.
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { createPrismaClient, withTenant } from "@platform/db/prisma";

// Playwright запускает наборы своим процессом и `.env` не читает.
if ((process.env.DATABASE_URL ?? "") === "" && existsSync(".env")) {
  process.loadEnvFile(".env");
}

import { ADMIN, TENANT, signIn, signInThroughForm } from "./support/auth.js";

/** Хвост, отличающий прогон от прогона. Восьми знаков хватает и на шифр. */
const ХВОСТ = randomUUID().slice(0, 8);
const ШИФР = `E2E-${ХВОСТ}`.toUpperCase();
const ОРГАНИЗАЦИЯ = `e2e-${ХВОСТ}`;
const ЧУЖОЙ_ОБЪЕКТ = "KRG-1";

test.describe("заведение объекта", () => {
  test.afterAll(async () => {
    const db = createPrismaClient(process.env.DATABASE_URL);
    try {
      const tenant = await db.tenant.findFirst({ where: { slug: TENANT } });
      if (tenant === null) return;

      await withTenant(db, tenant.id, async (tx) => {
        await tx.projectObject.deleteMany({ where: { code: ШИФР } });
      });
    } finally {
      await db.$disconnect();
    }
  });

  test("объект заводится и система ведёт на загрузку документов", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto("/objects");

    // Поля ищутся ВНУТРИ формы: подпись таблицы объектов тоже содержит слово
    // «шифр», и поиск по всей странице находил два узла — то есть падал на
    // исправном экране.
    const форма = page.locator("form[action='/api/objects']");
    await форма.getByLabel("Шифр").fill(ШИФР);
    await форма.getByLabel("Имя объекта").fill("Объект сквозного набора");
    await форма.getByRole("button", { name: "Завести объект" }).click();

    // НА ЗАГРУЗКУ, а не в реестр: следующий шаг тракта известен заранее, и
    // заставлять человека искать в списке то, что он только что создал, —
    // лишний шаг ровно там, где счёт идёт на минуты.
    await page.waitForURL(new RegExp(`/objects/${ШИФР}/upload$`));
    await expect(page.getByRole("heading", { name: "Объект сквозного набора" })).toBeVisible();

    // Объект не просто «создан»: в него можно грузить, то есть тракт с него
    // продолжается. Шаговик стоит на втором шаге, а не на первом.
    await expect(page.locator(".tract__step--now")).toContainText("Загрузка");
  });

  test("повтор шифра отказывает причиной, а не сообщением базы", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto("/objects");

    // Шифр демо-объекта заведомо занят: он приезжает с наполнением контура.
    const форма = page.locator("form[action='/api/objects']");
    await форма.getByLabel("Шифр").fill(ЧУЖОЙ_ОБЪЕКТ);
    await форма.getByLabel("Имя объекта").fill("Повтор");
    await форма.getByRole("button", { name: "Завести объект" }).click();

    await page.waitForURL(/\/objects\?/);
    // Словами человека. «Unique constraint failed on the fields: (tenantId,
    // code)» читается как поломка, а это обычный рабочий случай.
    await expect(page.getByText("уже есть")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("constraint");
  });
});

test.describe("выдача доступа клиенту", () => {
  test.afterAll(async () => {
    const db = createPrismaClient(process.env.DATABASE_URL);
    try {
      // Каскад снимает пользователя, привязку роли, сессии и журнал вместе с
      // арендатором: чужого при этом не задевается ничего — арендатор свой.
      await db.tenant.deleteMany({ where: { slug: ОРГАНИЗАЦИЯ } });
    } finally {
      await db.$disconnect();
    }
  });

  test("организация заводится, её администратор входит и не видит чужих объектов", async ({ page }) => {
    /**
     * ДЕМО-ВХОД, А НЕ КЛИЕНТСКИЙ. Право `tenant:manage` есть только у роли
     * оператора, и она есть только у нашего служебного арендатора: заведение
     * чужой организации — не власть администратора клиента.
     */
    await page.goto("/login");
    await page.getByLabel("Организация").fill("demo");
    await page.getByLabel("Адрес").fill("demo@strintel.ru");
    await page.getByLabel("Пароль").fill("demo-2026");
    await page.getByRole("button", { name: "Войти" }).click();
    await page.waitForURL((url) => url.pathname === "/");

    await page.goto("/access");

    const форма = page.locator("form[action='/api/tenants']");
    await форма.getByLabel("Адрес организации").fill(ОРГАНИЗАЦИЯ);
    await форма.getByLabel("Название").fill("ООО сквозного набора");
    await форма.getByLabel("Адрес администратора").fill(`admin@${ОРГАНИЗАЦИЯ}.ru`);
    await форма.getByLabel("Имя администратора").fill("Администратор набора");
    await форма.getByLabel("Пароль").fill("nabor-2026-parol");
    await форма.getByRole("button", { name: "Завести организацию" }).click();

    await expect(page.getByText("Вход заведён")).toBeVisible();
    // Пароль не показывается: показанный на экране пароль попадает в снимок
    // экрана и в историю браузера.
    await expect(page.locator("main")).not.toContainText("nabor-2026-parol");

    /**
     * И ВХОД РАБОТАЕТ. Без этой проверки гейт доказывал бы, что строка в базе
     * появилась, — а появиться она может и без привязки роли, то есть вход
     * будет входить и не мочь ничего.
     */
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Организация").fill(ОРГАНИЗАЦИЯ);
    await page.getByLabel("Адрес").fill(`admin@${ОРГАНИЗАЦИЯ}.ru`);
    await page.getByLabel("Пароль").fill("nabor-2026-parol");
    await page.getByRole("button", { name: "Войти" }).click();
    await page.waitForURL((url) => url.pathname === "/");

    // ИЗОЛЯЦИЯ. Новая организация пуста, и чужой объект недостижим по прямому
    // адресу — это то, что клиент проверит первым, получив доступ.
    await page.goto("/objects");
    await expect(page.getByText("Объектов у арендатора нет")).toBeVisible();

    const прямо = await page.goto(`/objects/${ЧУЖОЙ_ОБЪЕКТ}`);
    expect(прямо?.status(), "чужой объект открылся по прямому адресу").toBe(404);
  });

  test("администратор клиента заводит человека только в своей организации", async ({ page }) => {
    await signInThroughForm(page, ADMIN);
    await page.goto("/access");

    // Форма заведения организации ему не показывается вовсе: право
    // `tenant:manage` есть только у оператора. Предлагать действие, которое
    // закончится отказом после заполнения формы, — худший вид отказа.
    await expect(page.locator("form[action='/api/tenants']")).toHaveCount(0);
    await expect(page.locator("form[action='/api/users']")).toHaveCount(1);

    // И обработчик отказывает, даже если форму обойти: экран прячет действие,
    // а право его запрещает. Проверяются оба рубежа, а не только видимый.
    const ответ = await page.request.post("/api/tenants", {
      headers: { origin: new URL(page.url()).origin },
      form: {
        организация: `${ОРГАНИЗАЦИЯ}-мимо`,
        название: "Мимо",
        адрес: "mimo@example.ru",
        имя: "Мимо",
        пароль: "parol-mimo-2026",
      },
    });

    expect(ответ.status(), "администратор клиента завёл чужую организацию").toBe(403);
  });

  test("пароль короче восьми знаков отказывает с причиной", async ({ page }) => {
    await signInThroughForm(page, ADMIN);
    await page.goto("/access");

    const форма = page.locator("form[action='/api/users']");
    await форма.getByLabel("Адрес").fill(`korotkiy-${ХВОСТ}@example.ru`);
    await форма.getByLabel("Имя").fill("Короткий");
    // `fill` минует проверку браузера по `minlength` не всегда, поэтому
    // отправка идёт запросом: предмет гейта — проверка НА СЕРВЕРЕ, а не
    // подсказка формы. Первая обязана работать без второй.
    const ответ = await page.request.post("/api/users", {
      headers: { origin: new URL(page.url()).origin },
      form: { адрес: `korotkiy-${ХВОСТ}@example.ru`, имя: "Короткий", пароль: "1234", роль: "user" },
      maxRedirects: 0,
    });

    expect(ответ.status()).toBe(303);
    expect(decodeURIComponent(ответ.headers()["location"] ?? "")).toContain("короче");
  });
});

test.describe("вход без права", () => {
  test("пользователь без user:manage получает отказ с названием права", async ({ page }) => {
    // Тот же приём, что на журнале: отказ называет недостающее право, а не
    // показывает пустой экран. Пустой экран читается как «делать нечего».
    await signIn(page, "user@apri.ru");
    await page.goto("/access");

    await expect(page.getByText("Доступ закрыт")).toBeVisible();
    await expect(page.locator("main")).toContainText("user:manage");
    await expect(page.locator("form[action='/api/users']")).toHaveCount(0);
  });
});

