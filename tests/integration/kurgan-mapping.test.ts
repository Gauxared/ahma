/**
 * Критерий приёмки T1 (docs/m1-tasks.md) на курганском комплекте.
 *
 * Справочник наполняется шифрами, встреченными в самих сметах, — так он и
 * строится в реальности: каталог канонических позиций собирается треком A из
 * корпуса реальных объектов, а не пишется руками заранее. Проверяется здесь не
 * содержание каталога, а то, что позиция с шифром сопоставляется
 * детерминированно, а позиция без шифра честно уходит в текстовый путь.
 */
import { describe, expect, it } from "vitest";

import { isoDate, sha256, unitCode } from "@contracts/index.js";
import { CanonicalItemRegistry } from "@modules/canonical/item-registry.js";
import { mapPosition, summarize } from "@modules/canonical/map-position.js";
import type { MappedPosition } from "@contracts/index.js";
import { parseLsr } from "@modules/documents/parsers/grand-smeta.js";
import { readXlsxSheet } from "@platform/storage/xlsx-reader.js";

import { KURGAN_LSR, kurganAvailable, kurganPath } from "../fixtures/kurgan.js";

const describeKurgan = kurganAvailable() ? describe : describe.skip;

const CHECKED_AT = isoDate("2026-08-24");
const HASH = sha256("d".repeat(64));

async function mapKurgan(): Promise<readonly MappedPosition[]> {
  const registry = new CanonicalItemRegistry();
  const mapped: MappedPosition[] = [];
  const seen = new Set<string>();

  // Первый проход: наполняем каталог шифрами из корпуса.
  for (const entry of KURGAN_LSR) {
    const lsr = parseLsr(await readXlsxSheet(kurganPath(entry.file)));

    for (const section of lsr.sections) {
      for (const position of section.positions) {
        if (position.code === undefined) continue;

        const key = `${position.code.system}:${position.code.code}`;
        if (seen.has(key)) continue;
        seen.add(key);

        registry.add({
          id: key,
          name: position.name,
          unit: unitCode(position.unit || "не указана"),
          codes: [position.code],
        });
      }
    }
  }

  // Второй проход: сопоставляем позиции против наполненного каталога.
  for (const entry of KURGAN_LSR) {
    const sheet = await readXlsxSheet(kurganPath(entry.file));
    const lsr = parseLsr(sheet);

    for (const section of lsr.sections) {
      for (const position of section.positions) {
        mapped.push(
          mapPosition(position, registry, {
            sourceId: entry.file,
            contentHash: HASH,
            sheet: sheet.name,
            checkedAt: CHECKED_AT,
          }),
        );
      }
    }
  }

  return mapped;
}

describeKurgan("сопоставление курганских позиций", () => {
  it("сопоставляет по шифру 98 позиций и оставляет 3 для текстового пути", async () => {
    // Было 97/4, пока каталог содержал только нормы ГЭСН. С добавлением ФСБЦ —
    // сметных цен ресурсов — нашлась ещё одна позиция: «ФСБЦ-08.3.05.02-0021».
    // Она всё это время была не «позицией без шифра», а позицией с шифром,
    // который мы не умели читать.
    const summary = summarize(await mapKurgan());

    expect(summary.total).toBe(101);
    expect(summary.byCode).toBe(98);
    expect(summary.unmatched).toBe(3);
  });

  it("оставшиеся три позиции — конъюнктурный анализ, а не пробел каталога", async () => {
    // У всех трёх обоснование вида «ТЦ_<ИНН поставщика>_<дата>_<пункт>»:
    // текущая цена по коммерческому предложению. Нормативного шифра у них нет
    // по существу, и никакое пополнение каталога их не найдёт — законен только
    // текстовый путь.
    const unmatched = (await mapKurgan()).filter(
      (position) => position.mapping.kind === "unmatched",
    );

    expect(unmatched).toHaveLength(3);
    for (const position of unmatched) {
      expect(position.mapping.kind === "unmatched" && position.mapping.reason).toMatch(/шифр/i);
    }
  });

  it("у каждой несопоставленной позиции есть причина, а не пустота", async () => {
    const unmatched = (await mapKurgan()).filter((position) => position.mapping.kind === "unmatched");

    for (const position of unmatched) {
      expect(position.mapping.kind).toBe("unmatched");
      if (position.mapping.kind === "unmatched") {
        expect(position.mapping.reason.length).toBeGreaterThan(10);
      }
    }
  });

  it("каждое число несёт ссылку на лист и строку (ТЗ §12.1д)", async () => {
    for (const position of await mapKurgan()) {
      const numbers = [position.amount, position.quantity, position.unitPrice].filter(
        (value) => value !== undefined,
      );

      expect(numbers.length).toBeGreaterThan(0);

      for (const value of numbers) {
        expect(value.provenance.kind).toBe("source");
        if (value.provenance.kind === "source") {
          expect(value.provenance.ref.locator.kind).toBe("row");
          expect(value.provenance.ref.status).toBe("fact");
        }
      }
    }
  });

  it("проблемные единицы предъявляются, а не проглатываются", async () => {
    const summary = summarize(await mapKurgan());

    // В комплекте есть «антенна» и одна позиция без единицы измерения.
    expect(summary.unitIssues).toBeGreaterThan(0);
    expect(summary.unitIssues).toBeLessThan(summary.total / 10);
  });
});
