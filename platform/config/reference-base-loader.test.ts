/**
 * Единая база легаси — 120 листов в одной книге: 10 листов памяти Дирижёра и
 * по 7–12 листов на роль с префиксом (`ЛЮД·`, `АРТ·`…). Инвентаризация 08.09.2026
 * нашла её копию в `config/crew/bases/` без единой ссылки в коде. Здесь она
 * читается по префиксам листов — роль получает свои, Дирижёр — память.
 */
import { describe, expect, it } from "vitest";

import { extraBasesOf, sheetKeeper } from "../codex/crew-reviewers.js";
import { listXlsxSheets } from "../storage/xlsx-reader.js";
import { loadReferenceBase, loadReferenceBaseSheets } from "./reference-base-loader.js";

const ЕДИНАЯ = "config/crew/bases/СтройИнтеллект_ЕдинаяБаза_v1.0.xlsx";

describe("Единая база по префиксам листов", () => {
  it("книга содержит 120 листов: 10 памяти Дирижёра и 10 ролевых блоков", async () => {
    const листы = await listXlsxSheets(ЕДИНАЯ);

    expect(листы).toHaveLength(120);
    expect(листы.slice(0, 3)).toEqual(["00·Читать_первым", "01·Навигатор", "02·Ростер_14"]);
    expect(листы.filter((l) => l.startsWith("ЛЮД·"))).toHaveLength(9);
  });

  it("Дирижёру достаются листы памяти без навигатора, роли — только свои", async () => {
    const память = await loadReferenceBaseSheets(ЕДИНАЯ, sheetKeeper("единая:00·,02·,03·,04·,05·,06·,07·,08·,09·"));
    expect(память?.sheets.map((s) => s.name)).toEqual([
      "00·Читать_первым",
      "02·Ростер_14",
      "03·Маршрутизация_Plus",
      "04·Реестр_кейсов",
      "05·Накопитель_уроков",
      "06·Ядро_правила",
      "07·Граф_документов",
      "08·Глоссарий",
      "09·Версии",
    ]);
    expect(память!.sheets.every((s) => s.rows.length > 0)).toBe(true);

    const людмила = await loadReferenceBaseSheets(ЕДИНАЯ, sheetKeeper("единая:ЛЮД·"));
    // Навигатор базы — карта, не знание: отбрасывается, как и в книгах ролей.
    expect(людмила?.sheets.map((s) => s.name)).toEqual([
      "ЛЮД·1. Методика",
      "ЛЮД·2. Сметные базы",
      "ЛЮД·3. Индексы-ресурсы",
      "ЛЮД·4. НР-СП-лимит.",
      "ЛЮД·5. Формы-закрытие",
      "ЛЮД·6. Экспертиза",
      "ЛЮД·7. Стандарты",
      "ЛЮД·8. Ловушки",
    ]);
  });

  it("префикс, которого нет, даёт «базы нет», а не пустую книгу", async () => {
    expect(await loadReferenceBaseSheets(ЕДИНАЯ, sheetKeeper("единая:НЕТ·"))).toBeUndefined();
    expect(await loadReferenceBaseSheets("config/crew/bases/нет-такой.xlsx", () => true)).toBeUndefined();
  });

  it("книги ролей пакета лежат в config/crew/bases и читаются оттуда", async () => {
    const база = await loadReferenceBase("config/crew/bases/Опорная_база_Людмила_Сметчик_v1.0.xlsx");
    expect(база?.sheets.length).toBeGreaterThan(5);
  });
});

describe("привязка баз к ролям вне манифестов", () => {
  it("Дирижёр получает память Единой базы, Light-роли — книги контуров, остальные — [БЕЗ БАЗЫ]", () => {
    const привязка = extraBasesOf("config");

    expect(привязка.unified.endsWith("config/crew/bases/СтройИнтеллект_ЕдинаяБаза_v1.0.xlsx")).toBe(true);
    const кому = Object.fromEntries(привязка.roles.map((r) => [r.person, r.spec]));
    expect(кому["Дирижёр"]).toBe("единая:00·,02·,03·,04·,05·,06·,07·,08·,09·");
    expect(кому["Прохорыч"]!.endsWith("Опорная_база_Генподряд_РФ_v1.xlsx")).toBe(true);
    expect(кому["Захарыч"]!.endsWith("Унихим_извлечённая_база_для_СтройИнтеллекта_v5.0.xlsx")).toBe(true);
    expect(кому["Игнатыч"]).toBeUndefined();
    expect(кому["Рудик"]).toBeUndefined();
  });
});
