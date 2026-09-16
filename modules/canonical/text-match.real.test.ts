/**
 * Текстовое сопоставление на НАСТОЯЩЕМ КП подрядчика.
 *
 * `КП SLK.xlsx` — предложение по устройству бетонных площадок. Шифров в нём
 * нет, только свободный текст, единица и объём: ровно тот случай, ради
 * которого текстовый путь существует (ADR-R-013).
 *
 * ПОЧЕМУ ЭТОТ ТЕСТ УСТРОЕН ИМЕННО ТАК
 *
 * В КП два раздела, и они описывают одни и те же работы на разных площадках:
 * «подстилающий слой из щебня 40-70» есть и в первом, и во втором. Значит, у
 * задачи есть ИЗВЕСТНЫЙ ПРАВИЛЬНЫЙ ОТВЕТ, и его не пришлось выдумывать:
 * справочник собирается из первого раздела, запросы берутся из второго.
 *
 * Это лучше синтетических пар тем, что строки настоящие — с опечатками, без
 * пробелов после запятых, с «40- 70мм.» вместо «40-70 мм». Именно на них
 * первая версия и сломалась.
 *
 * НЕСОПОСТАВЛЕННОЕ ЗДЕСЬ — ПРАВИЛЬНЫЙ ОТВЕТ
 *
 * Во втором разделе есть «устройство жб забора», которого в первом нет вовсе.
 * Ожидать для него сопоставления значило бы требовать выдумать соответствие.
 */
import { existsSync } from "node:fs";

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { matchByText } from "./text-match.js";
import type { TextCandidate } from "./text-match.js";

const КП = "reference-system-new/Выход/АПРИ/1.0.расчет себстоимости/SLK СМУ-1/КП SLK.xlsx";

interface Строка {
  readonly no: string;
  readonly name: string;
  readonly unit: string;
}

async function прочитать(): Promise<readonly Строка[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(КП);
  const sheet = workbook.worksheets[0]!;

  const rows: Строка[] = [];
  for (let index = 4; index <= sheet.rowCount; index += 1) {
    const row = sheet.getRow(index);
    const cell = (n: number): string => String(row.getCell(n).value ?? "").trim();

    // Строки без единицы — заголовки разделов, а не позиции.
    if (cell(1) === "" || cell(4) === "") continue;

    rows.push({ no: cell(1), name: cell(2), unit: cell(4) });
  }

  return rows;
}

describe.skipIf(!existsSync(КП))("КП SLK: раздел 2 против раздела 1", () => {
  it("сопоставляет восемь позиций из девяти", async () => {
    const rows = await прочитать();
    const справочник: TextCandidate[] = rows
      .filter((row) => row.no.startsWith("1."))
      .map((row) => ({ id: row.no, name: row.name, unit: row.unit }));
    const запросы = rows.filter((row) => row.no.startsWith("2."));

    expect(справочник.length).toBe(10);
    expect(запросы.length).toBe(9);

    const итоги = запросы.map((row) => ({
      row,
      match: matchByText({ name: row.name, unit: row.unit }, справочник),
    }));

    const сопоставлено = итоги.filter(({ match }) => match.outcome === "сопоставлено");

    expect(сопоставлено).toHaveLength(8);
  });

  it("РАЗЛИЧАЕТ фракции щебня на настоящих строках", async () => {
    // Позиции 2.5 и 2.7 — щебень 40-70 и 20-40. Их соответствия в первом
    // разделе — 1.7 и 1.9. Спутать их значит сложить разные материалы по
    // разной цене; ровно это делала первая версия токенизации.
    const rows = await прочитать();
    const справочник: TextCandidate[] = rows
      .filter((row) => row.no.startsWith("1."))
      .map((row) => ({ id: row.no, name: row.name, unit: row.unit }));

    const найти = (no: string): string | undefined => {
      const строка = rows.find((row) => row.no === no)!;
      return matchByText({ name: строка.name, unit: строка.unit }, справочник).match?.id;
    };

    expect(найти("2.5")).toBe("1.7");
    expect(найти("2.7")).toBe("1.9");
  });

  it("НЕ сопоставляет забор, которого в первом разделе нет", async () => {
    // Правильный ответ здесь — отказ. Сопоставление означало бы выдуманное
    // соответствие, а «не сопоставлено» — полноправный исход §5.2.
    const rows = await прочитать();
    const справочник: TextCandidate[] = rows
      .filter((row) => row.no.startsWith("1."))
      .map((row) => ({ id: row.no, name: row.name, unit: row.unit }));

    const забор = rows.find((row) => row.no === "2.9")!;
    const итог = matchByText({ name: забор.name, unit: забор.unit }, справочник);

    expect(итог.outcome).toBe("не сопоставлено");
  });

  it("объясняет каждое сопоставление исходными словами", async () => {
    // Проверка того, что правило «основа для сравнения, а не для показа»
    // соблюдено на настоящих строках: в объяснении не должно быть обрубков
    // вроде «подстил» или «сло».
    const rows = await прочитать();
    const справочник: TextCandidate[] = rows
      .filter((row) => row.no.startsWith("1."))
      .map((row) => ({ id: row.no, name: row.name, unit: row.unit }));

    const строка = rows.find((row) => row.no === "2.5")!;
    const итог = matchByText({ name: строка.name, unit: строка.unit }, справочник);

    expect(итог.explanation).toContain("подстилающего");
    expect(итог.explanation).not.toContain("подстил,");
  });
});
