/**
 * Прогон, который ИДЁТ, — сквозной гейт вехи Д2 плана демо.
 *
 * ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ, И ПОЧЕМУ ИМЕННО ЭТО
 *
 * Веха Д2 задаёт три гейта дословно: «через минуту после постановки экран
 * показывает, что идёт, и это не пустой каркас»; «находки первого
 * высказавшегося агента видны до завершения прогона»; «быстрый проход отличён
 * от полного словом на экране». Здесь они и стоят.
 *
 * ПОЧЕМУ ПРОГОН ЗАСЕВАЕТСЯ, А НЕ ЗАПУСКАЕТСЯ ПО-НАСТОЯЩЕМУ
 *
 * Настоящий прогон идёт тридцать шесть минут и делает больше двухсот обращений
 * к модели. Набор, который его запускает, невозможно гонять на каждом коммите —
 * а гейт, который не гоняют, не гейт. Поэтому здесь засевается СОСТОЯНИЕ
 * идущего прогона: те самые строки, которые в бою пишет воркер. Что их пишет
 * именно он, проверяют `platform/execution/check-progress.test.ts` (запись) и
 * `modules/workflow/check-object.test.ts` (события). Три набора вместе покрывают
 * путь целиком, и ни один из них не притворяется, что покрывает его один.
 *
 * ДАННЫЕ ЧУЖИЕ НЕ ТРОГАЮТСЯ: прогон создаётся свой и удаляется в конце.
 */
import { existsSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { createPrismaClient, withTenant } from "@platform/db/prisma";

// Playwright запускает наборы своим процессом и `.env` не читает: единственный
// набор, которому нужна база, читает его сам. Без этого гейт падал бы с «база не
// задана» — то есть жаловался бы на окружение, а не на интерфейс.
if ((process.env.DATABASE_URL ?? "") === "" && existsSync(".env")) {
  process.loadEnvFile(".env");
}

import { signIn, TENANT, USER } from "./support/auth.js";

const OBJECT = "KRG-1";

/** Замечание, которое обязано доехать до экрана до конца прогона. */
const НАХОДКА = "Расценка на щебень задвоена между разделами 2 и 3";

/**
 * Идущий прогон с двумя агентами: один высказался, второй ещё работает.
 *
 * `workflowId` — параметр: тем же засевом проверяется и полный прогон, и
 * быстрый. Второй засев с другими литералами разошёлся бы с первым.
 */
async function seedLiveCheck(workflowId: string): Promise<{ readonly tenantId: string; readonly checkId: string }> {
  const db = createPrismaClient(process.env.DATABASE_URL);

  try {
    const tenant = await db.tenant.findFirst({ where: { slug: TENANT } });

    if (tenant === null) {
      throw new Error(`Арендатора «${TENANT}» нет: поднимите контур через pnpm demo:up`);
    }

    return await withTenant(db, tenant.id, async (tx) => {
      const object = await tx.projectObject.findFirst({ where: { code: OBJECT } });

      if (object === null) {
        throw new Error(`Объекта «${OBJECT}» нет: поднимите контур через pnpm demo:up`);
      }

      const check = await tx.check.create({
        data: {
          tenantId: tenant.id,
          objectId: object.id,
          workflowId,
          mode: workflowId === "full-check" ? "standard" : "express",
          createdBy: object.id,
          status: "running",
          startedAt: new Date(Date.now() - 9 * 60_000),
          phase: "агенты по сметам",
          documentsTotal: 7,
          documentsDone: 5,
        },
      });

      // ЗАДАЧА ОЧЕРЕДИ — ЧАСТЬ ИДУЩЕГО ПРОГОНА, а не подробность. «Живым»
      // экран считает прогон, у которого есть чем продолжиться: Проверка без
      // задачи не идёт, она числится. Засев без задачи проверял бы состояние,
      // которого в бою не бывает.
      await tx.job.create({
        data: {
          tenantId: tenant.id,
          checkId: check.id,
          type: "check",
          payload: { objectPath: `${TENANT}/${OBJECT}/гейт`, objectCode: OBJECT },
          payloadHash: "0".repeat(64),
          idempotencyKey: `гейт-д2:${check.id}`,
          status: "running",
        },
      });

      await tx.agentRun.createMany({
        data: [
          {
            tenantId: tenant.id,
            checkId: check.id,
            agentId: "estimate_review",
            subject: "Смета/ЛСР-01.xlsx",
            stage: "агенты по сметам",
            scope: "документ",
            status: "исполнен",
            startedAt: new Date(Date.now() - 8 * 60_000),
            finishedAt: new Date(Date.now() - 4 * 60_000),
            verdict: "смета к работе пригодна с замечаниями",
            findings: [{ severity: "critical", statement: НАХОДКА, basis: "позиции 12 и 48" }],
          },
          {
            tenantId: tenant.id,
            checkId: check.id,
            agentId: "tech_opinion",
            subject: "Смета/ЛСР-01.xlsx",
            stage: "агенты по сметам",
            scope: "документ",
            status: "выполняется",
            startedAt: new Date(Date.now() - 3 * 60_000),
          },
        ],
      });

      return { tenantId: tenant.id, checkId: check.id };
    });
  } finally {
    await db.$disconnect();
  }
}

async function removeCheck(tenantId: string, checkId: string): Promise<void> {
  const db = createPrismaClient(process.env.DATABASE_URL);

  try {
    // Каскад уносит прогоны агентов вместе с Проверкой.
    await withTenant(db, tenantId, (tx) => tx.check.delete({ where: { id: checkId } }));
  } finally {
    await db.$disconnect();
  }
}

test.describe("полный прогон, который идёт", () => {
  let seeded: { tenantId: string; checkId: string } = { tenantId: "", checkId: "" };

  test.beforeAll(async () => {
    seeded = { ...(await seedLiveCheck("full-check")) };
  });

  test.afterAll(async () => {
    await removeCheck(seeded.tenantId, seeded.checkId);
  });

  test("рабочий экран показывает ход прогона, а не пустой каркас", async ({ page }) => {
    await signIn(page, USER);
    await page.goto(`/objects/${OBJECT}/checks/${seeded.checkId}`);

    // Прогон объявляет себя идущим: до Д2 здесь стояло «в очереди» все
    // тридцать шесть минут — то есть неправда о работе, которая идёт.
    //
    // Проверяется СЛОВО, а не значение перечисления: экран показывал
    // `running` английским идентификатором, и это отдельно исправлено.
    await expect(page.getByText("выполняется").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ход прогона" })).toBeVisible();
    // Этап и продвижение — словами и числом: «идёт» без движения не отличается
    // от «повисло».
    await expect(page.getByText("агенты по сметам").first()).toBeVisible();
    await expect(page.getByText("документов разобрано 5 из 7")).toBeVisible();
    // Имя, а не способность: `estimate_review` требует перевода читателю.
    await expect(page.getByText("Людмила").first()).toBeVisible();
    // Работающий отличён от высказавшегося словом, а не только цветом.
    await expect(page.getByText("выполняется").first()).toBeVisible();
    await expect(page.getByText("исполнен").first()).toBeVisible();
  });

  test("находки высказавшегося агента видны до завершения прогона", async ({ page }) => {
    await signIn(page, USER);
    // Доска по умолчанию показывает ИДУЩИЙ прогон, а не свежий завершённый:
    // артефакт появляется в конце, и выбор «свежий с артефактом» показывал бы
    // на двадцатой минуте предыдущий прогон.
    await page.goto(`/objects/${OBJECT}/agents`);

    await expect(page.getByText(`высказалось 1 из`)).toBeVisible();
    await expect(page.getByText("работает 1")).toBeVisible();
    // Критичная находка доехала до «что убьёт проект» — того места, ради
    // которого доску открывают на встрече.
    await expect(page.getByText(НАХОДКА)).toBeVisible();
    // И помечена предварительной: она из хода прогона, а не из артефакта.
    await expect(page.getByText("предварительно", { exact: false }).first()).toBeVisible();

    // Переход к агенту ведёт в ТОТ ЖЕ прогон и показывает основание.
    await page.getByRole("link", { name: /Людмила/ }).first().click();
    await expect(page.getByText(НАХОДКА)).toBeVisible();
    await expect(page.getByText("позиции 12 и 48")).toBeVisible();
    await expect(page.getByText("Прогон ещё идёт: замечания предварительные")).toBeVisible();
  });

  test("грубых нарушений доступности на ходе прогона нет", async ({ page }) => {
    await signIn(page, USER);
    await page.goto(`/objects/${OBJECT}/checks/${seeded.checkId}`);
    await expect(page.getByRole("heading", { name: "Ход прогона" })).toBeVisible();

    const { violations } = await new AxeBuilder({ page }).analyze();
    const grave = violations.filter((issue) => issue.impact === "serious" || issue.impact === "critical");

    expect(grave.map((issue) => `${issue.id}: ${issue.help}`)).toEqual([]);
  });

  test.describe("масштаб 200 %", () => {
    /**
     * Окно 640×512 — то же, что у набора доступности: двукратное увеличение
     * равносильно вдвое меньшему окну от 1280×1024.
     *
     * Именно фиксированное окно, а не «половина от текущего»: на устройстве
     * Pixel 7 половина даёт 206 px, и набор жаловался бы на раскладку там, где
     * ни один человек не читает — двести процентов на телефоне это не
     * двухсотпиксельный экран.
     */
    test.use({ viewport: { width: 640, height: 512 } });

    test("ход прогона не уводит страницу в горизонтальную прокрутку", async ({ page }) => {
      await signIn(page, USER);
      await page.goto(`/objects/${OBJECT}/checks/${seeded.checkId}`);
      await expect(page.getByRole("heading", { name: "Ход прогона" })).toBeVisible();

      // Замер делает сама страница: типов DOM в проекте нет, и выражение
      // отдаётся строкой — тем же приёмом, что в наборе доступности.
      const overflow = await page.evaluate<number>(
        "document.documentElement.scrollWidth - document.documentElement.clientWidth",
      );

      expect(overflow, "страница шире окна: содержимое недостижимо без прокрутки вбок").toBeLessThanOrEqual(1);
    });
  });
});

/**
 * ОТ ВЫВОДА ДО СТРОКИ ИСХОДНОГО ЛИСТА — веха Д3 плана демо.
 *
 * Шестой пункт критерия готовности дословно: «нажать на находку и дойти до
 * листа и строки исходного файла». Проверяется он целиком, на НАСТОЯЩИХ
 * позициях контура: замечание засевается с координатой той строки, которую
 * разбор действительно прочитал, — иначе гейт был бы зелёным на выдуманной
 * ссылке в никуда.
 *
 * Позиция берётся ПОДАЛЬШЕ ОТ НАЧАЛА намеренно: страница держит пятьдесят
 * строк, и ссылка на первую отправляла бы читателя листать. Ровно это Д3 и
 * закрывает — страница вычисляется по строке.
 */
test.describe("от вывода до строки исходного листа", () => {
  let seeded: { tenantId: string; checkId: string } = { tenantId: "", checkId: "" };
  let документ = "";
  let строка = 0;
  let лист = "";
  let отпечаток = "";

  test.beforeAll(async () => {
    const db = createPrismaClient(process.env.DATABASE_URL);

    try {
      const tenant = await db.tenant.findFirst({ where: { slug: TENANT } });
      if (tenant === null) throw new Error(`Арендатора «${TENANT}» нет: поднимите контур через pnpm demo:up`);

      const выбрано = await withTenant(db, tenant.id, async (tx) => {
        const version = await tx.documentVersion.findFirst({
          where: { document: { object: { code: OBJECT } }, positions: { some: {} } },
          orderBy: { positions: { _count: "desc" } },
          select: {
            // Отпечаток берётся у НАСТОЯЩЕЙ версии, а не выдумывается.
            //
            // Здесь стояло `contentHash: "a".repeat(64)` — засев обещал след к
            // версии, которой в базе нет. Пока переход искал свежую ревизию по
            // ИМЕНИ файла, это сходило: ссылка строилась всё равно. По Т6.4
            // ссылка ведёт в версию с ЭТИМ отпечатком, и выдуманный отпечаток
            // означает «дойти нельзя» — то есть засев проверял бы отсутствие
            // ссылки там, где предмет гейта — её наличие.
            contentHash: true,
            document: { select: { fileName: true } },
            positions: { orderBy: { sourceRow: "asc" }, select: { sourceRow: true } },
          },
        });

        if (version === null) {
          throw new Error(`У объекта ${OBJECT} нет разобранных позиций: поднимите контур через pnpm demo:up`);
        }

        // Строка со второй страницы, если она есть: именно на ней и ломался
        // переход к строке до Д3.
        const position = version.positions[50] ?? version.positions[version.positions.length - 1]!;

        return { fileName: version.document.fileName, row: position.sourceRow, hash: version.contentHash };
      });

      документ = выбрано.fileName;
      строка = выбрано.row;
      отпечаток = выбрано.hash;
      лист = "Раздел 3";

      seeded = await withTenant(db, tenant.id, async (tx) => {
        const object = await tx.projectObject.findFirstOrThrow({ where: { code: OBJECT } });

        const check = await tx.check.create({
          data: {
            tenantId: tenant.id,
            objectId: object.id,
            workflowId: "full-check",
            mode: "standard",
            createdBy: object.id,
            status: "completed",
            startedAt: new Date(Date.now() - 30 * 60_000),
            finishedAt: new Date(),
          },
        });

        await tx.agentRun.create({
          data: {
            tenantId: tenant.id,
            checkId: check.id,
            agentId: "estimate_review",
            subject: документ,
            stage: "агенты по сметам",
            scope: "документ",
            status: "исполнен",
            startedAt: new Date(Date.now() - 20 * 60_000),
            finishedAt: new Date(Date.now() - 15 * 60_000),
            verdict: "смета к работе пригодна с замечаниями",
            findings: [
              {
                severity: "critical",
                statement: НАХОДКА,
                basis: "позиции 12 и 48",
                source: {
                  sourceId: документ,
                  contentHash: отпечаток,
                  locator: { kind: "row", sheet: лист, row: строка },
                  status: "fact",
                  acquisition: "parsed",
                  checkedAt: "2026-09-04",
                  staleAfterDays: 90,
                },
              },
              // Замечание без координаты — рядом с первым, чтобы разница
              // проверялась на одном экране, а не на двух прогонах.
              { severity: "medium", statement: "Объём земляных работ не подтверждён", basis: "лист 2" },
            ],
            questions: [
              { question: "запросить исполнительную по земляным работам", owner: "ПТО", dueBy: "2026-09-10" },
            ],
          },
        });

        return { tenantId: tenant.id, checkId: check.id };
      });
    } finally {
      await db.$disconnect();
    }
  });

  test.afterAll(async () => {
    await removeCheck(seeded.tenantId, seeded.checkId);
  });

  /**
   * Обе графы формы результата проверяются ОДНОЙ загрузкой экрана.
   *
   * Было два теста на одну и ту же страницу: координата с доверием и «что
   * проверить человеку». Предмет у них разный, а экран один — и вторая
   * загрузка не добавляла ничего, кроме секунд. Утверждения остались все.
   */
  test("замечание несёт координату и доверие, а рядом стоит что проверить человеку", async ({ page }) => {
    await signIn(page, USER);
    await page.goto(`/objects/${OBJECT}/agents/estimate_review?прогон=${seeded.checkId}`);

    await expect(page.getByText(НАХОДКА)).toBeVisible();
    await expect(page.getByRole("link", { name: `лист «${лист}», строка ${строка} →` })).toBeVisible();
    // То, ради чего веха нужна: два вывода разной прочности не выглядят
    // одинаково.
    await expect(page.getByText("основание текстовое", { exact: false })).toBeVisible();
    // Уровень доверия — словом человека, а не ключом артефакта.
    await expect(page.getByText("факт · разобрано из файла")).toBeVisible();

    // Восьмая графа: поручение с владельцем и сроком.
    await expect(page.getByRole("heading", { name: "Что проверить человеку" })).toBeVisible();
    await expect(page.getByText("запросить исполнительную по земляным работам")).toBeVisible();
    await expect(page.getByText("кому: ПТО · срок: 2026-09-10")).toBeVisible();
  });

  /**
   * Переход и его доступность — одним проходом.
   *
   * Отдельный тест на axe повторял тот же путь ради второго сканирования:
   * вход, экран агента, нажатие, экран версии. Сканирование обоих экранов
   * встроено сюда — путь один, а проверок по-прежнему две.
   */
  test("ссылка из замечания доводит до строки исходного листа", async ({ page }) => {
    await signIn(page, USER);
    await page.goto(`/objects/${OBJECT}/agents/estimate_review?прогон=${seeded.checkId}`);

    const наЭкранеАгента = await new AxeBuilder({ page }).analyze();

    await page.getByRole("link", { name: `лист «${лист}», строка ${строка} →` }).click();
    await page.waitForURL(/\/documents\//);

    // Страница выбрана по строке, и это сказано словами: прыжок разбивки без
    // объяснения читается как сбой.
    await expect(page.getByText(`Показана строка ${строка} — по ссылке из замечания`)).toBeVisible();
    // Сама строка помечена СЛОВОМ, а не только краем: цвет не имеет права быть
    // единственным сигналом.
    await expect(page.getByText("из замечания", { exact: true })).toBeVisible();
    // И она действительно на показанной странице, а не «где-то в таблице».
    await expect(page.locator("tr.row--marked")).toHaveCount(1);

    const наЭкранеВерсии = await new AxeBuilder({ page }).analyze();

    const грубые = [...наЭкранеАгента.violations, ...наЭкранеВерсии.violations].filter(
      (issue) => issue.impact === "serious" || issue.impact === "critical",
    );

    expect(грубые.map((issue) => `${issue.id}: ${issue.help}`)).toEqual([]);
  });
});

test.describe("быстрый проход", () => {
  let seeded: { tenantId: string; checkId: string } = { tenantId: "", checkId: "" };

  test.beforeAll(async () => {
    seeded = { ...(await seedLiveCheck("estimate-only")) };
  });

  test.afterAll(async () => {
    await removeCheck(seeded.tenantId, seeded.checkId);
  });

  test("отличён от полного словом и называет, кого не звали", async ({ page }) => {
    await signIn(page, USER);
    await page.goto(`/objects/${OBJECT}/checks/${seeded.checkId}`);

    // Точное совпадение: слово стоит и пилюлей у графы «вид», и во врезке, а
    // подстрока нашла бы оба и упала бы на строгом режиме.
    await expect(page.getByText("быстрый проход", { exact: true })).toBeVisible();
    await expect(page.getByText("Это быстрый проход, а не полная Проверка")).toBeVisible();
    // Кого не звали — поимённо: иначе молчание агента читается как «замечаний
    // нет», а это противоположное утверждение.
    await expect(page.getByText("finance_model", { exact: false }).first()).toBeVisible();
  });

  test("на доске агентов молчание не позванного объяснено", async ({ page }) => {
    await signIn(page, USER);
    await page.goto(`/objects/${OBJECT}/agents?прогон=${seeded.checkId}`);

    await expect(page.getByText("Это быстрый проход: зовут не всех агентов")).toBeVisible();
  });
});
