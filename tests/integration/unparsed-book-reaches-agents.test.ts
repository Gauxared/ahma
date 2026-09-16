/**
 * КНИГА НЕ ПО ФОРМЕ 421/пр: ПОЗИЦИИ БЕРУТСЯ ПО ШАПКЕ, А ТЕКСТ ИДЁТ ЦЕЛИКОМ.
 *
 * ЧТО ЗДЕСЬ ЗАЩИЩАЕТСЯ
 *
 * Замерено на клиентском корпусе: из ста настоящих книг по форме приказа
 * составлены тридцать четыре, остальные шестьдесят шесть — сметы контракта,
 * ведомости объёмов и калькуляции своей вёрстки.
 *
 * ПРАВИЛО ИЗМЕНИЛОСЬ 09.09.2026. Прежде такая книга не давала НИ ОДНОЙ позиции:
 * «их пришлось бы выдумать». Это было верно, пока читать её было нечем. Теперь
 * читает `any-estimate.ts` — по ШАПКЕ КОЛОНОК, как читает человек, — и ничего
 * выдумывать не приходится: колонки названы самим документом, а чтение
 * подтверждается его же арифметикой (количество × цена = сумма). Требование
 * владельца: «обрабатывать любые сметы в любых форматах, а не только там где
 * написано 421/пр».
 *
 * ЧТО ОСТАЛОСЬ НЕИЗМЕННЫМ. Книга уходит агентам ТЕКСТОМ ЦЕЛИКОМ — и
 * разобранная, и нет. Разбор берёт таблицу, а вне таблицы остаётся всё
 * прочее: примечания, расчёты, листы согласования.
 *
 * ЭТО ПРО УНИВЕРСАЛЬНОСТЬ, А НЕ ПРО ОДИН ФАЙЛ. Система обязана что-то делать с
 * документом любой структуры, а не только с той, под которую написан парсер.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import XLSX from "xlsx";

import { bootstrap } from "@platform/bootstrap.js";
import { buildCheckPorts } from "@platform/execution/check-ports.js";

const ТЕНАНТ = "11111111-1111-1111-1111-111111111111";

describe("книга не по форме 421/пр", () => {
  let каталог = "";
  let своя = "";

  beforeAll(async () => {
    каталог = await mkdtemp(join(tmpdir(), "своя-книга-"));
    своя = join(каталог, "Калькуляция затрат.xlsx");

    // Своя вёрстка: ни «№ п/п», ни подзаголовка «всего» — разбор формы её не
    // возьмёт, и это правильно. Но числа в ней есть, и человек их читает.
    const лист = XLSX.utils.aoa_to_sheet([
      ["КАЛЬКУЛЯЦИЯ ЗАТРАТ НА МОНТАЖ УЗЛА УЧЁТА"],
      [],
      ["Наименование затрат", "Ед.", "Кол-во", "Цена", "Сумма"],
      ["Прибор учёта тепловой энергии", "шт", 2, 148000, 296000],
      ["Монтаж прибора", "шт", 2, 21500, 43000],
      ["Пусконаладка узла", "компл", 1, 64000, 64000],
      ["ИТОГО", "", "", "", 403000],
    ]);
    const книга = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(книга, лист, "Калькуляция");
    await writeFile(своя, XLSX.write(книга, { type: "buffer", bookType: "xlsx" }) as Buffer);
  });

  afterAll(async () => {
    await rm(каталог, { recursive: true, force: true });
  });

  it("позиции берутся по шапке колонок: три работы, а не ноль", async () => {
    const { ports, collected } = buildCheckPorts({
      platform: bootstrap(),
      tenantId: ТЕНАНТ,
      now: new Date().toISOString(),
    });

    await ports.checkDocument({ path: своя, kind: "лср" });

    const позиции = collected.extracted.filter((строка) => строка.document === своя);

    expect(позиции).toHaveLength(3);
    expect(позиции.map((строка) => строка.sourceName)).toContain("Прибор учёта тепловой энергии");
    // Сумма позиции — из колонки «Сумма», а не из «Цены»: перепутать их значит
    // занизить смету, и различает их арифметика самого документа.
    expect(позиции.find((строка) => строка.sourceName === "Монтаж прибора")?.amount).toBe("43000.00");
  });

  it("книга без шапки колонок позиций не даёт — выдумывать нечего", async () => {
    const без = join(каталог, "Пояснительная записка.xlsx");
    const лист = XLSX.utils.aoa_to_sheet([
      ["ПОЯСНИТЕЛЬНАЯ ЗАПИСКА"],
      ["Работы выполняются в две смены с 01.10.2026."],
      ["Стоимость уточняется по результатам обследования."],
    ]);
    const книга = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(книга, лист, "Записка");
    await writeFile(без, XLSX.write(книга, { type: "buffer", bookType: "xlsx" }) as Buffer);

    const { ports } = buildCheckPorts({ platform: bootstrap(), tenantId: ТЕНАНТ, now: new Date().toISOString() });

    await expect(ports.checkDocument({ path: без, kind: "лср" })).rejects.toThrow();
  });

  it("но её содержимое доходит до агентов текстом", async () => {
    const { ports, collected } = buildCheckPorts({
      platform: bootstrap(),
      tenantId: ТЕНАНТ,
      now: new Date().toISOString(),
    });

    await ports.checkDocument({ path: своя, kind: "лср" }).catch(() => undefined);

    const прочитано = collected.designDocuments.find((document) => document.path === своя);

    expect(прочитано, "книгу не разобрали и не прочитали: её не увидел никто").toBeDefined();
    // Числа и наименования на месте — иначе агенту нечего сказать.
    expect(прочитано?.text).toContain("Прибор учёта тепловой энергии");
    expect(прочитано?.text).toContain("403000");
  });

  it("колонки остаются различимыми, а не сливаются в поток слов", async () => {
    // «шт 2 148000» без разделителя читается как одно число из трёх кусков.
    const { ports, collected } = buildCheckPorts({
      platform: bootstrap(),
      tenantId: ТЕНАНТ,
      now: new Date().toISOString(),
    });

    await ports.checkDocument({ path: своя, kind: "лср" }).catch(() => undefined);

    const текст = collected.designDocuments.find((document) => document.path === своя)?.text ?? "";

    expect(текст, "строки не разделены на колонки").toContain("\t");
  });

  it("РАЗОБРАННАЯ смета тоже уходит текстом — целиком (Т10)", async () => {
    /**
     * ПРАВИЛО ПЕРЕВЁРНУТО 08.09.2026, И ВОТ ПОЧЕМУ.
     *
     * Прежде текст разобранной сметы не выкладывался: у неё текст — это её же
     * позиции, и второе описание того же могло разойтись с первым. Замер
     * показал, что беда сильнее с другой стороны: удачный разбор ТЕРЯЛ больше
     * неудачного. Разбор берёт из книги форму 421/пр, а второй лист с
     * ведомостью объёмов, расчёт индексов, лист согласований и примечания
     * сметчика не доходили никуда — ни позициями, ни текстом.
     *
     * Плата за полноту названа и снята отдельно: роль видит строки формы в
     * тексте и может переписать их в `positions` — такая строка вторым разом в
     * счёт не идёт (`toExtractedRows`), а уходит находкой. Здесь проверяется
     * первая половина: книга дошла целиком.
     */
    const эталон = "reference-system/input-1/РИМ Курган_СОТВ_ испр. - ЛСР по Методике 2020 _РМ_.xlsx";
    const { ports, collected } = buildCheckPorts({
      platform: bootstrap(),
      tenantId: ТЕНАНТ,
      now: new Date().toISOString(),
    });

    await ports.checkDocument({ path: эталон, kind: "лср" });

    const текстом = collected.designDocuments.find((document) => document.path === эталон);

    expect(текстом, "разобранная смета не дошла текстом: всё, что вне формы 421/пр, потеряно").toBeDefined();
    // Позиции при этом разобраны — книга дошла ОБОИМИ способами, а не вместо.
    expect(collected.extracted.length).toBeGreaterThan(0);
    expect(collected.documentHashes.some((d) => d.path === эталон)).toBe(true);
  });
});
