/**
 * Архив с одним битым файлом — гейт вехи Д5 плана демо дословно:
 * «прогон, упавший на одном файле, обязан довести остальные и назвать отказ,
 * а не обнулить обход».
 *
 * ПОЧЕМУ ЧЕРЕЗ АРХИВ, А НЕ ПРОСТО ПАПКУ
 *
 * Типовой вход клиента — сто файлов одним ZIP (Д1), и битый файл приезжает
 * именно так. Распаковка при этом НЕ ЛОМАЕТСЯ: повреждённая книга внутри
 * архива — обычные байты, и щель открывается позже, на разборе. Проверять надо
 * весь путь: архив → партия → обход → вердикт.
 *
 * ФАЙЛЫ НАСТОЯЩИЕ. Хорошая смета — курганская ЛСР; битая — она же с
 * обрезанным хвостом, то есть ровно то, что приходит при сбое выгрузки или
 * обрыве загрузки. Собранная из трёх ячеек «битая книга» доказала бы только
 * то, что распаковщик умеет падать.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Decimal } from "decimal.js";

import type { ParseEstimateBody } from "@modules/documents/operations/parse-estimate.js";
import { checkObject } from "@modules/workflow/check-object.js";
import { bootstrap } from "@platform/bootstrap.js";
import { describeDocument } from "@platform/execution/check-ports.js";
import { expandArchive } from "@web/lib/archives.js";

import { kurganAvailable, KURGAN_INPUT } from "../fixtures/kurgan.js";

const ЛСР = "РИМ Курган_СОТВ_ испр. - ЛСР по Методике 2020 _РМ_.xlsx";
const БИТАЯ = "ЛСР-обрезанная.xlsx";
const TENANT = "00000000-0000-0000-0000-000000000000";

const describeKurgan = kurganAvailable() ? describe : describe.skip;

describeKurgan("архив с одним битым файлом", () => {
  let партия = "";

  beforeAll(async () => {
    партия = await mkdtemp(join(tmpdir(), "битый-в-архиве-"));

    const целая = await readFile(join(KURGAN_INPUT, ЛСР));

    // Архив как его собирает клиент: папка внутри, две сметы, одна испорчена.
    const zip = new JSZip();
    zip.file(`Смета/${ЛСР}`, целая);
    // Обрезание ровно посередине: подпись ZIP в начале осталась, центрального
    // каталога нет. Так выглядит книга, недокачанная до конца.
    zip.file(`Смета/${БИТАЯ}`, обрезать(целая));

    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    const распаковано = await expandArchive(bytes);

    expect(распаковано.rejected, "архив должен распаковаться целиком").toEqual([]);
    expect(распаковано.files.length).toBe(2);

    for (const файл of распаковано.files) {
      await writeFile(join(партия, basename(файл.path)), Buffer.from(файл.bytes));
    }
  });

  afterAll(async () => {
    await rm(партия, { recursive: true, force: true });
  });

  it("вердикт выносится по целой смете, а битая названа отказом с причиной", async () => {
    const platform = bootstrap();
    const now = new Date().toISOString();

    const body = await checkObject(партия, {
      discover: async (path) => {
        const { readdir } = await import("node:fs/promises");

        return Promise.all(
          (await readdir(path))
            .sort((a, b) => a.localeCompare(b, "ru"))
            .map(async (name) => describeDocument(join(path, name), name, platform.parsers)),
        );
      },

      checkDocument: async (document) => {
        const parsed = await platform.operations.run<unknown, ParseEstimateBody>(
          "parse-estimate",
          { documentPath: document.path },
          { tenantId: TENANT, entryPoint: "subgraph", subjects: new Map(), now },
        );

        if (!parsed.ok) throw new Error("разбор заблокирован");

        const позиции = parsed.artifact.body.sections.flatMap((section) => section.positions);
        // Сумма позиций — десятичной арифметикой: рубли не переживают двоичного
        // округления, и §12.1б требует расхождения ровно 0 ₽.
        // Комплект С ЦЕНАМИ: сумма обязана быть у каждой позиции. Пропуск
        // такой позиции скрыл бы потерю данных, поэтому здесь падение.
        for (const позиция of позиции) expect(позиция.amount, `позиция ${позиция.ordinal} без суммы`).toBeDefined();

        const сумма = позиции.reduce(
          (итог, позиция) => итог.plus(new Decimal(позиция.amount!.value.amount)),
          new Decimal(0),
        );

        return {
          path: document.path,
          positions: позиции.length,
          byCode: позиции.filter((позиция) => позиция.mapping.kind === "by_code").length,
          unmatched: позиции.filter((позиция) => позиция.mapping.kind === "unmatched").length,
          converged: true,
          delta: "0.00",
          documentTotal: сумма.toFixed(2),
        };
      },
    });

    // ОБХОД НЕ ОБНУЛИЛСЯ: целая смета прочитана и дала позиции.
    expect(body.totals.checked).toBe(1);
    expect(body.totals.positions).toBeGreaterThan(0);

    // Битая ПРЕДЪЯВЛЕНА поимённо, а не пропущена молча.
    const отказ = body.documents.find((document) => document.path.endsWith(БИТАЯ));
    expect(отказ?.status).toBe("отказ");
    expect((отказ?.reason ?? "").length).toBeGreaterThan(10);

    // И гейт полноты обхода красный: смета, которую не прочитали, — это
    // неполный обход, а зелёный вердикт на неполном обходе запрещён (ТЗ §9).
    const гейт = body.gates.find((candidate) => candidate.id === "обход");
    expect(гейт?.passed).toBe(false);
    expect(гейт?.detail).toContain(БИТАЯ);
    expect(body.verdict).toBe("не принято");
  });
});

/** Обрезает книгу пополам: начало настоящее, конца нет. */
function обрезать(bytes: Buffer): Buffer {
  return bytes.subarray(0, Math.floor(bytes.length / 2));
}
