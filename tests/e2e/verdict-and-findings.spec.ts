/**
 * Вердикт агента и замечания прогона — компоновка двух главных поверхностей.
 *
 * ЧТО ЗДЕСЬ ЗАЩИЩАЕТСЯ, И ПОЧЕМУ ЭТО НЕ «ПРОВЕРКА ВЁРСТКИ»
 *
 * Оба дефекта, которые эти гейты закрывают, были СМЫСЛОВЫМИ, а выглядели как
 * оформление:
 *
 * 1. Вердикты агента по четырём сметам склеивались в одну строку через `; `.
 *    Терялась не читаемость — терялась СВЯЗЬ: по четырём вердиктам и четырём
 *    именам файлов нельзя было сказать, какой вердикт о какой смете, и
 *    восстановить это из склеенной строки уже нельзя никак.
 * 2. Карточка «Обзор сметчика» на рабочем экране показывала замечания ВСЕХ
 *    девяти агентов: разрез шёл по документу, а `capability` терялась. Сто
 *    шестьдесят семь чужих выводов стояли под подписью одного человека.
 *
 * ПОЧЕМУ АРТЕФАКТ ЗАСЕВАЕТСЯ
 *
 * Настоящий прогон идёт тридцать шесть минут и делает больше двухсот обращений
 * к модели; набор, который его запускает, невозможно гонять на каждом коммите.
 * Здесь засевается ТЕЛО артефакта — ровно то, что в бою пишет `check-object`.
 * Что его пишет именно он, проверяет `modules/workflow/check-object.test.ts`.
 *
 * ГЕЙТ ИДЁТ ПО МЕХАНИЗМУ, А НЕ ПО ДАННЫМ КОНТУРА. Способности берутся из
 * реестра агентов, а не пишутся литералами: переименуют агента — набор поедет
 * за ним, а не станет зелёным на несуществующей способности.
 *
 * ДАННЫЕ ЧУЖИЕ НЕ ТРОГАЮТСЯ: прогон создаётся свой и удаляется в конце.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { loadAgentRoster } from "@platform/config/agent-roster";
import { createPrismaClient, withTenant } from "@platform/db/prisma";

// Playwright запускает наборы своим процессом и `.env` не читает.
if ((process.env.DATABASE_URL ?? "") === "" && existsSync(".env")) {
  process.loadEnvFile(".env");
}

import { signIn, TENANT, USER } from "./support/auth.js";

/** Хвост, отличающий прогон от прогона: набор гоняется многократно. */
const ХВОСТ = randomUUID().replace(/-/g, "").slice(0, 12);

/**
 * СВОЙ ОБЪЕКТ, А НЕ ДЕМОНСТРАЦИОННЫЙ.
 *
 * Сначала набор засевал прогон на `KRG-1` — и ломал два чужих гейта:
 * «заблокированный шаг называет последствие» и «скачивание отдаёт настоящую
 * книгу» берут ПЕРВУЮ ссылку `full-check` в истории объекта, а засеянный
 * прогон оказывался свежее настоящего. Оба падали, и падали не на дефекте.
 *
 * Свой объект решает это в корне: история демонстрационного не меняется, и
 * порядок наборов перестаёт что-либо значить.
 */
const OBJECT = `VF-${ХВОСТ}`.toUpperCase();

/** Две сметы одного агента: связь «вердикт ↔ предмет» проверяется на них. */
const СМЕТА_1 = "партия/ЛСР-первая.xlsx";
const СМЕТА_2 = "партия/ЛСР-вторая.xlsx";

/**
 * Две ревизии одного файла — для проверки Т6.4.
 *
 * Смету правят и присылают заново; до Т6.4 переход к строке искал САМУЮ СВЕЖУЮ
 * ревизию по имени файла, и ссылка из старого прогона молча приводила в новую
 * версию, где строка 12 — уже другая строка.
 */
// Отпечатки уникальны НА ПРОГОН. Одинаковые на всех прогонах накапливались бы
// в контуре, и переход находил бы версию прошлого прогона — падение, которое
// выглядит как дефект Т6.4 и им не является.
const ХЭШ_ПРОВЕРЕННОЙ = `${ХВОСТ}1`.padEnd(64, "0");
const ХЭШ_НОВОЙ = `${ХВОСТ}2`.padEnd(64, "0");
const СТРОКА = 12;

/**
 * Двое агентов из реестра.
 *
 * По имени из реестра экран подписывает группу замечаний, и без него гейт
 * «разрез по автору» проверял бы наличие блоков, а не наличие авторов.
 */
function двоеИзРеестра(): readonly [{ capability: string; person: string }, { capability: string; person: string }] {
  const { roster } = loadAgentRoster(join(process.cwd(), "config", "agents"));
  const [первый, второй] = roster.all();

  if (первый === undefined || второй === undefined) {
    throw new Error("в реестре агентов меньше двух записей: гейт разреза по автору проверять нечем");
  }

  return [
    { capability: первый.capability, person: первый.person },
    { capability: второй.capability, person: второй.person },
  ];
}

const [АГЕНТ, ВТОРОЙ] = двоеИзРеестра();

test.describe("вердикт по предметам и замечания по авторам", () => {
  let checkId = "";
  let tenantId = "";
  let проверенаяВерсия = "";

  test.beforeAll(async () => {
    const db = createPrismaClient(process.env.DATABASE_URL);

    try {
      const tenant = await db.tenant.findFirst({ where: { slug: TENANT } });
      if (tenant === null) throw new Error(`Арендатора «${TENANT}» нет: поднимите контур через pnpm demo:up`);

      tenantId = tenant.id;

      checkId = await withTenant(db, tenant.id, async (tx) => {
        const object = await tx.projectObject.create({
          data: { tenantId: tenant.id, code: OBJECT, name: "Объект набора о вердиктах" },
        });

        /**
         * ДВЕ РЕВИЗИИ ОДНОГО ФАЙЛА, и замечание относится к ПЕРВОЙ.
         *
         * Так выглядит обычный рабочий ход: смету поправили и прислали заново
         * после прогона. До Т6.4 переход искал максимальную ревизию по имени
         * файла и приводил во вторую — молча, без единого признака подмены.
         */
        const document = await tx.document.create({
          data: { tenantId: tenant.id, objectId: object.id, kind: "лср", fileName: `ЛСР-первая-${ХВОСТ}.xlsx` },
        });

        const проверенная = await tx.documentVersion.create({
          data: {
            tenantId: tenant.id,
            documentId: document.id,
            revision: 1,
            contentHash: ХЭШ_ПРОВЕРЕННОЙ,
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            byteSize: BigInt(1024),
            storagePath: "набор/ЛСР-первая.xlsx",
            acquisition: "parsed",
            positions: {
              create: [
                {
                  tenantId: tenant.id,
                  ordinal: "1",
                  section: "1",
                  sourceName: "Позиция проверенной версии",
                  basis: "ГЭСН01-01-001-01",
                  unit: "шт",
                  amount: "1000.00",
                  sourceRow: СТРОКА,
                },
              ],
            },
          },
        });

        await tx.documentVersion.create({
          data: {
            tenantId: tenant.id,
            documentId: document.id,
            revision: 2,
            contentHash: ХЭШ_НОВОЙ,
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            byteSize: BigInt(2048),
            storagePath: "набор/ЛСР-первая-правленая.xlsx",
            acquisition: "parsed",
          },
        });

        проверенаяВерсия = проверенная.id;

        const check = await tx.check.create({
          data: {
            tenantId: tenant.id,
            objectId: object.id,
            workflowId: "full-check",
            mode: "standard",
            createdBy: object.id,
            status: "completed",
            startedAt: new Date(Date.now() - 40 * 60_000),
            finishedAt: new Date(),
          },
        });

        await tx.artifact.create({
          data: {
            tenantId: tenant.id,
            checkId: check.id,
            operationId: "check-object",
            operationVersion: 1,
            completeness: "full",
            inputHashes: [],
            body: {
              objectPath: "партия",
              verdict: "не принято",
              totals: { documents: 2, checked: 2 },
              gates: [{ id: "обход", name: "все сметы объекта прочитаны", detail: "прочитано смет: 2", passed: true }],
              documents: [{ path: СМЕТА_1, kind: "лср", status: "проверен" }],
              review: {
                requested: true,
                findings: 3,
                failed: 0,
                bySeverity: { critical: 1, medium: 2 },
                documents: [
                  {
                    path: СМЕТА_1,
                    capability: АГЕНТ.capability,
                    scope: "документ",
                    // Светофор в первом знаке — то, что ставит сама модель.
                    verdict: "🔴 принимать нельзя до расшифровки позиции",
                    findings: [
                      {
                        severity: "critical",
                        statement: "Блокер по первой смете",
                        basis: "позиция 89",
                        // Сумма ПОЗИЦИИ со следом — графа «значение» формы
                        // результата. Она лежала в артефакте и не доходила до
                        // экрана: read-модель веба её не читала.
                        deviation: "double_count",
                        impact: {
                          value: { amount: "824009.97", currency: "RUB" },
                          provenance: {
                            kind: "source",
                            ref: {
                              sourceId: СМЕТА_1,
                              contentHash: ХЭШ_ПРОВЕРЕННОЙ,
                              locator: { kind: "row", sheet: "ЛСР", row: СТРОКА },
                              status: "fact",
                              acquisition: "parsed",
                              checkedAt: "2026-09-05",
                              staleAfterDays: 90,
                            },
                          },
                        },
                      },
                    ],
                  },
                  {
                    path: СМЕТА_2,
                    capability: АГЕНТ.capability,
                    scope: "документ",
                    verdict: "🟡 принимаем с условием подтверждения объёмов",
                    findings: [{ severity: "medium", statement: "Риск двойного учёта по второй смете", basis: "строки 48 и 148" }],
                  },
                  {
                    path: СМЕТА_1,
                    capability: ВТОРОЙ.capability,
                    scope: "документ",
                    // БЕЗ светофора: отсутствие класса — отдельное состояние.
                    verdict: "Состав к фиксации в ВОР не подтверждён",
                    findings: [{ severity: "medium", statement: "Геометрия рабочей документации отсутствует", basis: "схем нет" }],
                  },
                ],
              },
            },
          },
        });

        return check.id;
      });
    } finally {
      await db.$disconnect();
    }
  });

  test.afterAll(async () => {
    if (checkId === "" || tenantId === "") return;

    const db = createPrismaClient(process.env.DATABASE_URL);
    try {
      await withTenant(db, tenantId, async (tx) => {
        // Объект уносит с собой всё: прогон, артефакт, документ с версиями и
        // позициями. Каскад описан схемой, и повторять его здесь значило бы
        // завести второе знание о том, что чему принадлежит.
        await tx.projectObject.deleteMany({ where: { code: OBJECT } });
      });
    } finally {
      await db.$disconnect();
    }
  });

  test("вердикт агента разложен по предметам, а светофор стал словом", async ({ page }) => {
    await signIn(page, USER);
    await page.goto(`/objects/${OBJECT}/agents/${АГЕНТ.capability}?прогон=${checkId}`);

    // ДВА блока, а не один абзац: агент высказался по двум сметам, и связь
    // «вердикт ↔ смета» обязана быть видна.
    await expect(page.locator(".verdict")).toHaveCount(2);

    const первый = page.locator(".verdict", { hasText: "ЛСР-первая.xlsx" });
    await expect(первый).toContainText("принимать нельзя до расшифровки позиции");
    // Класс — СЛОВОМ. Цвет не имеет права быть единственным сигналом, а знак
    // светофора внутри абзаца не является сигналом вовсе.
    await expect(первый).toContainText("не принимать");

    await expect(page.locator(".verdict", { hasText: "ЛСР-вторая.xlsx" })).toContainText("с условием");

    // Знак ушёл из текста: он стал состоянием, а не типографикой.
    const текст = await page.locator(".verdicts").innerText();
    expect(текст, "светофор остался внутри прозы").not.toContain("🔴");
    expect(текст, "светофор остался внутри прозы").not.toContain("🟡");
  });

  test("боковая панель не выше экрана и прокручивается сама", async ({ page }) => {
    /**
     * НАЙДЕНО НА ЭКРАНЕ ЗАКАЗЧИКА: под коротким левым столбцом зияла дыра в
     * тысячи пикселей.
     *
     * Высоту строки сетки задаёт самая высокая колонка. На объекте, где слева
     * почти пусто («смет 0, нечего проверять»), а справа полсотни поручений,
     * пустым оказывался весь низ страницы. И липкость там не работала: панель
     * выше экрана не «остаётся на виду», она просто уезжает вверх.
     *
     * ВЫСОКОЕ СОДЕРЖИМОЕ ПОДСТАВЛЯЕТСЯ НАРОЧНО. Проверять потолок на короткой
     * панели бессмысленно: она и без потолка поместится, и набор будет зелёным,
     * ничего не проверив.
     */
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, USER);
    await page.goto(`/objects/${OBJECT}/checks/${checkId}`);

    const aside = page.locator(".split__aside");
    await expect(aside, "на экране проверки нет боковой панели").toBeVisible();

    // Глобальные `document`/`window` в этом наборе не объявлены: берём их у
    // самого узла, а не расширяем библиотеку типов ради двух обращений.
    await aside.evaluate((node) => {
      const башня = node.ownerDocument.createElement("div");
      башня.style.height = "6000px";
      node.append(башня);
    });

    const замер = await aside.evaluate((node) => {
      const окно = node.ownerDocument.defaultView!;

      return {
        высота: Math.round(node.getBoundingClientRect().height),
        экран: окно.innerHeight,
        прокручивается: node.scrollHeight > node.clientHeight,
        overflowY: окно.getComputedStyle(node).overflowY,
      };
    });

    expect(
      замер.высота,
      `панель ${замер.высота} px при экране ${замер.экран} px — под левым столбцом останется дыра`,
    ).toBeLessThanOrEqual(замер.экран);

    expect(
      замер.прокручивается,
      "панель обрезана без прокрутки: содержимое пропало молча",
    ).toBe(true);
    expect(замер.overflowY, "потолок без прокрутки прячет содержимое").toBe("auto");
  });

  test("в одну колонку панель НЕ запирается в высоту экрана", async ({ page }) => {
    // Ниже 1100 px панель стоит НАД списком, и внутренняя прокрутка там —
    // ловушка: читатель прокручивает страницу, а содержимое панели остаётся
    // невидимым внутри собственного окна.
    await page.setViewportSize({ width: 900, height: 800 });
    await signIn(page, USER);
    await page.goto(`/objects/${OBJECT}/checks/${checkId}`);

    const overflowY = await page
      .locator(".split__aside")
      .evaluate((node) => node.ownerDocument.defaultView!.getComputedStyle(node).overflowY);

    expect(overflowY, "в одноколоночной раскладке панель заперта в собственную прокрутку").toBe(
      "visible",
    );
  });

  test("замечания рабочего экрана разрезаны по авторам и свёрнуты", async ({ page }) => {
    await signIn(page, USER);
    await page.goto(`/objects/${OBJECT}/checks/${checkId}`);

    // Разрез по автору: два агента — два блока, и каждый подписан ИМЕНЕМ.
    // Считаем ВНУТРИ своей карточки: рядом стоит перечень «Что показать
    // клиенту», и его пятёрка видима по замыслу — общий счёт по странице
    // проверял бы два разных списка сразу.
    const карточка = page.locator(".card", { hasText: "Замечания агентов" }).first();
    const блоки = карточка.locator(".agroup");
    await expect(блоки).toHaveCount(2);
    await expect(page.locator(".agroup__person", { hasText: АГЕНТ.person })).toBeVisible();
    await expect(page.locator(".agroup__person", { hasText: ВТОРОЙ.person })).toBeVisible();

    /**
     * СВЁРНУТО — И ЭТО ПРОВЕРЯЕТСЯ ЧИСЛОМ ВИДИМЫХ ЗАМЕЧАНИЙ.
     *
     * Раньше сто шестьдесят семь замечаний выводились подряд и растягивали
     * экран на три десятка прокруток. Спрятан при этом не смысл, а объём:
     * число и важности стоят в свёрнутом заголовке.
     */
    expect(await карточка.locator(".crit:visible").count(), "группы раскрыты по умолчанию").toBe(0);
    await expect(блоки.first()).toContainText("критические: 1");

    /**
     * ПАНЕЛЬ СПРАВА — УЗКАЯ, И ЭТО НЕ ВКУС.
     *
     * Она была задана во `fr` при левой колонке `1.55fr`: почти пятьсот
     * пикселей под одну карточку «Предметов нет», а ниже — три десятка
     * прокруток левой колонки против пустоты справа.
     */
    const список = await page.locator(".split > div").first().boundingBox();
    const панель = await page.locator(".split__aside").boundingBox();

    expect(панель?.x ?? 0, "панель контекста стоит не справа от списка").toBeGreaterThan(
      (список?.x ?? 0) + (список?.width ?? 0) - 4,
    );
    expect(панель?.width ?? 0, "панель контекста снова забрала треть экрана").toBeLessThanOrEqual(400);
  });

  test("отбор по важности раскрывает группы и оставляет только отобранное", async ({ page }) => {
    await signIn(page, USER);
    await page.goto(`/objects/${OBJECT}/checks/${checkId}?${new URLSearchParams({ важность: "critical" })}`);

    // Остался один автор — тот, у кого критичное; второй с отбором не совпал.
    const карточка = page.locator(".card", { hasText: "Замечания агентов" }).first();

    await expect(карточка.locator(".agroup")).toHaveCount(1);
    await expect(карточка.locator(".crit")).toHaveCount(1);
    await expect(page.locator("main")).toContainText("Блокер по первой смете");
    // И отбор назван словом человека, а не ключом артефакта.
    await expect(page.locator("main")).toContainText("отбор: критично");
  });

/**
   * ЧТО ПОКАЗАТЬ КЛИЕНТУ — прямое требование задачи: «не 100 выводов, а 3–5».
   *
   * Проверяется не «карточка есть», а её свойства: перечень не длиннее пяти,
   * правило отбора ВИДНО на экране, и в него не попадает вывод без координаты —
   * показать его в исходном файле нечем, а на встрече спрашивают именно это.
   */
  test("перечень для клиента короткий, а правило отбора видно", async ({ page }) => {
    await signIn(page, USER);
    await page.goto(`/objects/${OBJECT}/checks/${checkId}`);

    const карточка = page.locator(".card", { hasText: "Что показать клиенту" }).first();
    await expect(карточка).toBeVisible();

    const выводы = карточка.locator(".crit");
    const сколько = await выводы.count();

    expect(сколько, "перечень длиннее пяти: это уже не разговор, а список").toBeLessThanOrEqual(5);
    expect(сколько, "перечень пуст при замечаниях с координатой").toBeGreaterThan(0);

    // Правило показано рядом: перечень «самое важное», собранный неизвестно
    // как, — мнение системы, за которое нельзя спросить.
    await expect(карточка).toContainText("Тяжёлое сверху");
    await expect(карточка).toContainText("Одна позиция даёт одну находку");

    // Замечания без координаты в перечень не идут: у второго агента её нет.
    await expect(карточка).not.toContainText("Геометрия рабочей документации отсутствует");
  });

  /**
   * ЧЕТЫРЕ ГРАФЫ ФОРМЫ РЕЗУЛЬТАТА, которые вычислялись и не доходили до экрана.
   *
   * Значение, единица, версия и класс отклонения лежали в артефакте: 72 из 167
   * замечаний курганского прогона несут `Valued<Money>` со следом, 55 — класс
   * отклонения. Read-модель веба их не читала.
   */
  test("замечание показывает сумму позиции, класс отклонения и версию", async ({ page }) => {
    await signIn(page, USER);
    await page.goto(`/objects/${OBJECT}/checks/${checkId}`);

    const блокер = page.locator(".crit", { hasText: "Блокер по первой смете" }).first();

    // Сумма разряжена и с валютой: рядом, в плитках, те же рубли стоят так же.
    await expect(блокер).toContainText("824 009,97 ₽");
    // И названа тем, что она есть, — суммой позиции, а не оценкой потерь.
    await expect(блокер.locator(".crit__amount")).toHaveAttribute("title", /Сумма позиции/);
    // Класс отклонения словом человека, а не ключом артефакта.
    await expect(блокер).toContainText("двойной учёт");
    await expect(блокер).not.toContainText("double_count");
    // Версия — отпечаток проверенного файла: он отвечает на вопрос «а ту ли
    // смету вы смотрели».
    await expect(блокер).toContainText(`версия ${ХЭШ_ПРОВЕРЕННОЙ.slice(0, 12)}`);
  });

  /**
   * ССЫЛКА ВЕДЁТ В ПРОВЕРЕННУЮ ВЕРСИЮ, А НЕ В ПОСЛЕДНЮЮ (Т6.4).
   *
   * Это был тихий разрыв ровно в том месте, которое задача называет главной
   * особенностью продукта: после перезаливки сметы ссылка из прогона вела в
   * новую ревизию, где строка 12 — другая строка. Без единого признака подмены.
   */
  test("переход из замечания ведёт в ту версию, которую проверяли", async ({ page }) => {
    await signIn(page, USER);
    await page.goto(`/objects/${OBJECT}/checks/${checkId}`);

    const ссылка = page.getByRole("link", { name: `лист «ЛСР», строка ${СТРОКА} →` }).first();
    await expect(ссылка).toBeVisible();

    const адрес = await ссылка.getAttribute("href");

    expect(адрес, "ссылка ведёт не в проверенную версию").toContain(проверенаяВерсия);

    await ссылка.click();
    await page.waitForURL(new RegExp(проверенаяВерсия));
    // И строка на месте: у проверенной версии позиция со строкой 12 есть, у
    // новой ревизии позиций нет вовсе. Строка помечена словом — цвет края не
    // имеет права быть единственным сигналом.
    await expect(page.locator("tr.row--marked")).toHaveCount(1);
    await expect(page.locator("tr.row--marked")).toContainText("Позиция проверенной версии");
  });

  test("итог по агентам показывает автора, предмет и неназванный класс", async ({ page }) => {
    await signIn(page, USER);
    await page.goto(`/objects/${OBJECT}/checks/${checkId}`);

    const итог = page.locator(".lights");

    // Три вердикта: два у первого агента, один у второго.
    await expect(итог.locator(".lights__row")).toHaveCount(3);
    // Подпись — автор И предмет: три «не принимать» под одним именем читались
    // бы как повтор строки, а не как решения по разным сметам.
    await expect(итог).toContainText(`${АГЕНТ.person} · ЛСР-первая.xlsx`);
    /**
     * ОТСУТСТВИЕ КЛАССА НАЗВАНО, А НЕ ДОСЧИТАНО.
     *
     * Второй агент светофора не поставил. Показать его зелёным было бы удобно
     * и неверно: «критичных нет» и «агент принял» — разные утверждения, и
     * второе имеет право сказать только агент.
     */
    await expect(итог).toContainText("класс не объявлен");
  });
});
