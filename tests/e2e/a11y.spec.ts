/**
 * Доступность договорных путей — WCAG 2.1 AA (спека §18).
 *
 * ПОЧЕМУ МАШИННО
 *
 * До сих пор доступность держалась на дисциплине: фокус видимый, у статуса есть
 * слово, таблица осталась таблицей. Дисциплина проверяется вычиткой, а вычитка
 * не повторяется на каждом коммите. Гейт повторяется.
 *
 * ЧТО ЭТА ПРОВЕРКА НЕ ДОКАЗЫВАЕТ
 *
 * Автоматика ловит примерно половину нарушений AA — контрастность, имена
 * элементов управления, структуру заголовков, подписи полей. Осмысленность
 * порядка обхода, понятность формулировок и разумность фокуса машина не судит.
 * Поэтому «axe чист» здесь означает «грубых нарушений нет», а не «AA
 * достигнут»: заявлять достижение по зелёному гейту было бы тем же, что
 * объявлять §12.1а выполненным по числу разобранных строк.
 *
 * Порог — `serious` и `critical`. Уровни ниже (`moderate`, `minor`) содержат
 * рекомендации, спорные для плотных сметных таблиц; поднимать порог до них
 * значит завести гейт, который придётся обходить.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { ADMIN, signIn } from "./support/auth.js";

const OBJECT = "KRG-1";

/** Все проверки доступности идут под администратором: ему видно всё. */
async function войти(page: Page): Promise<void> {
  await signIn(page, ADMIN);
}

async function scan(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();

  const severe = result.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );

  // Сообщение перечисляет правило и узлы: «есть нарушения» без указания, какие
  // именно, заставляет заново запускать проверку руками.
  expect(
    severe.map((violation) => `${violation.id} (${violation.nodes.length}): ${violation.help}`),
    "грубые нарушения доступности",
  ).toEqual([]);
}

test.describe("доступность", () => {
  test("вход", async ({ page }) => {
    await page.goto("/login");
    await scan(page);
  });

  test("пульт", async ({ page }) => {
    await войти(page);
    await page.goto("/");
    await scan(page);
  });

  test("карта поверхностей", async ({ page }) => {
    await войти(page);
    await page.goto("/map");
    await scan(page);
  });

  test("реестр объектов", async ({ page }) => {
    await войти(page);
    await scan(page);
  });

  test("карточка объекта", async ({ page }) => {
    await войти(page);
    await page.goto(`/objects/${OBJECT}`);
    await scan(page);
  });

  test("журнал", async ({ page }) => {
    await войти(page);
    await page.goto("/journal");
    await scan(page);
  });

  test("доступ", async ({ page }) => {
    await войти(page);
    // Экран из двух форм с полем пароля и выпадающим списком ролей: подписи
    // полей и имена элементов управления — ровно то, что автоматика судит.
    await page.goto("/access");
    await scan(page);
  });

  test("загрузка и разбор", async ({ page }) => {
    await войти(page);
    await page.goto(`/objects/${OBJECT}/documents`);
    await scan(page);
  });

  test("поиск", async ({ page }) => {
    await войти(page);
    await page.goto(`/search?${new URLSearchParams({ q: OBJECT }).toString()}`);
    await scan(page);
  });

  test("доска агентов", async ({ page }) => {
    await войти(page);
    await page.goto(`/objects/${OBJECT}/agents`);
    // Самый плотный из новых экранов: сетка плиток, список критичного с
    // авторами и предусловия такта. Если axe что-то найдёт, то здесь.
    await scan(page);
  });

  test("замечания одного агента", async ({ page }) => {
    await войти(page);
    await page.goto(`/objects/${OBJECT}/agents`);
    await page.locator("a.agent--open").first().click();
    // Прогон едет в адресе: доска перестала терять его при переходе к агенту,
    // иначе клик по плитке молча открывал экран другого прогона. Ждать адрес
    // БЕЗ параметров значит требовать возврата той потери.
    await page.waitForURL(/\/agents\/[a-z_]+(\?|$)/);
    await scan(page);
  });

  test("загрузка документов", async ({ page }) => {
    await войти(page);
    await page.goto(`/objects/${OBJECT}/upload`);
    // Единственный экран с файловым полем: у него своя кнопка от браузера, и
    // проверять её доступность важнее, чем доступность наших кнопок.
    await scan(page);
  });

  test("пакет заказчику", async ({ page }) => {
    await войти(page);
    await page.goto(`/objects/${OBJECT}`);

    /**
     * Адресом, а не нажатием на вкладку.
     *
     * Достижимость пакета нажатием проверяет `screens.spec.ts`; здесь предмет
     * другой — доступность самого экрана. На узком устройстве полоса вкладок
     * прокручивается внутри себя, и нажатие ждало видимости тридцать секунд,
     * проверив в итоге не доступность, а прокрутку.
     *
     * Адрес `/objects/<шифр>/package` ведёт на пакет свежего прогона, у
     * которого есть что собирать: тот же механизм, что у вкладки.
     */
    await page.goto(`/objects/${OBJECT}/package`);
    await page.waitForURL(/\/package$/);
    await scan(page);
  });

  test("позиции версии", async ({ page }) => {
    // Пятьдесят строк, шесть колонок и раскрытие в каждой — самый тяжёлый
    // экран продукта, и axe обходит его целиком. Тридцати секунд по умолчанию
    // не хватало на занятой машине, и падал не экран, а таймаут.
    test.setTimeout(90_000);
    await войти(page);
    await page.goto(`/objects/${OBJECT}/documents`);
    // Самый плотный экран продукта: пятьдесят строк, шесть колонок и раскрытие
    // в каждой. Если axe где-то и найдёт нарушение, то здесь.
    await page.getByRole("link", { name: /№\d+/ }).first().click();
    await page.waitForURL(/\/documents\/[0-9a-f-]{36}/);
    await scan(page);
  });

  test("рабочий экран Проверки", async ({ page }) => {
    await войти(page);
    await page.goto(`/objects/${OBJECT}`);
    await page.getByRole("link", { name: "full-check" }).first().click();
    await page.waitForURL(/\/checks\//);
    await scan(page);
  });
});

test.describe("масштаб 200 %", () => {
  /**
   * Спека требует «zoom/reflow для основных workflows». Двукратное увеличение
   * равносильно вдвое меньшему окну: 1280×1024 при 200 % — это 640×512.
   *
   * Проверяется отсутствие ГОРИЗОНТАЛЬНОЙ прокрутки страницы. Вертикальная
   * нормальна, а горизонтальная означает, что часть содержимого недостижима без
   * двумерной прокрутки — то, что WCAG 1.4.10 и запрещает. Широкие таблицы
   * прокручиваются внутри себя, и это не считается: у них своя обёртка.
   */
  test.use({ viewport: { width: 640, height: 512 } });

  for (const [name, path] of [
    ["реестр объектов", "/objects"],
    ["карточка объекта", `/objects/${OBJECT}`],
    ["журнал", "/journal"],
    ["доступ", "/access"],
    /**
     * РАБОЧИЙ ЭКРАН ПРОВЕРКИ И ПАКЕТ — ИХ ЗДЕСЬ НЕ БЫЛО, И ДЕФЕКТ ЖИЛ.
     *
     * Замерено 05.09.2026 на 375 px: полоса вкладок объекта — 515 px, и она
     * уводила в горизонтальную прокрутку ВСЮ СТРАНИЦУ. Это прямое нарушение
     * WCAG 1.4.10, и оно стояло на самом важном экране продукта.
     *
     * Хуже: набор доступности УТВЕРЖДАЛ обратное — «на узком устройстве
     * вкладки уезжают в прокручиваемую полосу». Полосы не существовало, и
     * утверждение никто не проверял, потому что экрана в перечне не было.
     *
     * Адреса через `latest`: идентификатор прогона в наборе не назвать, а
     * перенаправление ведёт на свежий — то есть на тот же экран, что открывает
     * человек.
     */
    ["рабочий экран Проверки", `/objects/${OBJECT}/checks/latest`],
    ["пакет заказчику", `/objects/${OBJECT}/package`],
    ["замечания агента", `/objects/${OBJECT}/agents/estimate_review`],
    ["загрузка и разбор", `/objects/${OBJECT}/documents`],
    ["пульт", "/"],
    ["поиск", `/search?${new URLSearchParams({ q: OBJECT }).toString()}`],
    ["загрузка документов", `/objects/${OBJECT}/upload`],
    ["доска агентов", `/objects/${OBJECT}/agents`],
  ] as const) {
    test(`${name} не уводит страницу в горизонтальную прокрутку`, async ({ page }) => {
      await войти(page);
      await page.goto(path);

      // Замер делает сама страница, а типов DOM в проекте нет — поэтому
      // выражение отдаётся строкой: приделывать `lib: dom` ради двух свойств
      // значило бы завозить типы браузера во всё ядро.
      const overflow = await page.evaluate<number>(
        "document.documentElement.scrollWidth - document.documentElement.clientWidth",
      );

      expect(overflow, "страница шире окна: содержимое недостижимо без прокрутки вбок").toBeLessThanOrEqual(1);
    });
  }
});

/**
 * ШИРИНА НАСТОЯЩЕГО ТЕЛЕФОНА — 320 px, И ЭТО ДРУГОЕ УСЛОВИЕ.
 *
 * Соседний набор проверяет масштаб 200 %, то есть 640×512. Дефект, найденный
 * 05.09.2026 руками, при 640 НЕ ВОСПРОИЗВОДИЛСЯ: полоса вкладок объекта — 515
 * px, и в 640 она помещается. На 375 она уводила в горизонтальную прокрутку
 * всю страницу, на самом важном экране продукта.
 *
 * То есть «масштаб 200 %» и «узкий телефон» — два разных условия, и первое не
 * покрывает второе. Я это проверил, вернув прежнее поведение вкладок: гейт
 * масштаба остался зелёным.
 *
 * 320 px — нижняя граница WCAG 1.4.10 (reflow). Более узкого экрана стандарт
 * не требует, а более широкий уже проверен соседним набором.
 */
test.describe("узкий телефон", () => {
  test.use({ viewport: { width: 320, height: 800 } });

  for (const [name, path] of [
    ["карточка объекта", `/objects/${OBJECT}`],
    ["рабочий экран Проверки", `/objects/${OBJECT}/checks/latest`],
    ["замечания агента", `/objects/${OBJECT}/agents/estimate_review`],
    ["доступ", "/access"],
    ["реестр объектов", "/objects"],
  ] as const) {
    test(`${name} не уводит страницу в горизонтальную прокрутку`, async ({ page }) => {
      await войти(page);
      await page.goto(path);

      const overflow = await page.evaluate<number>(
        "document.documentElement.scrollWidth - document.documentElement.clientWidth",
      );

      expect(overflow, "страница шире окна: содержимое недостижимо без прокрутки вбок").toBeLessThanOrEqual(1);
    });
  }
});
