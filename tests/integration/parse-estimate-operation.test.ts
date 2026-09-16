/**
 * Критерий приёмки T2 (docs/m1-tasks.md): операция разбора на настоящем файле,
 * собранная настоящим композиционным корнем.
 *
 * Юнит-тесты операции работают на синтетическом листе; здесь проверяется, что
 * сборка, чтение файла и хэширование работают вместе.
 */
import { describe, expect, it } from "vitest";

import { bootstrap } from "@platform/bootstrap.js";
import { fileContentHash } from "@platform/storage/xlsx-reader.js";
import type { ParseEstimateBody } from "@modules/documents/operations/parse-estimate.js";

import { KURGAN_LSR, kurganAvailable, kurganPath } from "../fixtures/kurgan.js";

const describeKurgan = kurganAvailable() ? describe : describe.skip;

const CONTEXT = {
  tenantId: "00000000-0000-0000-0000-000000000000",
  entryPoint: "single" as const,
  subjects: new Map(),
  now: "2026-08-25T00:00:00Z",
};

describeKurgan("операция parse-estimate на курганском комплекте", () => {
  const platform = bootstrap();
  const entry = KURGAN_LSR[1]!; // ЭОМ: три раздела, 54 позиции

  it("зарегистрирована в композиционном корне", () => {
    expect(platform.operations.ids()).toContain("parse-estimate");
  });

  it("хэш входа совпадает с хэшем содержимого файла (ADR-R-027)", async () => {
    const path = kurganPath(entry.file);
    const outcome = await platform.operations.run<unknown, ParseEstimateBody>(
      "parse-estimate",
      { documentPath: path },
      CONTEXT,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.artifact.inputHashes).toEqual([await fileContentHash(path)]);
  });

  it("разбирает все позиции и объявленные итоги", async () => {
    const outcome = await platform.operations.run<unknown, ParseEstimateBody>(
      "parse-estimate",
      { documentPath: kurganPath(entry.file) },
      CONTEXT,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const body = outcome.artifact.body;
    expect(body.sections).toHaveLength(entry.sections);
    expect(body.summary.total).toBe(entry.positions);
    expect(body.declaredTotal).toBe(entry.declaredTotal);
  });

  it("повторный прогон даёт побайтово идентичное тело артефакта", async () => {
    const input = { documentPath: kurganPath(entry.file) };

    const first = await platform.operations.run<unknown, ParseEstimateBody>("parse-estimate", input, CONTEXT);
    const second = await platform.operations.run<unknown, ParseEstimateBody>("parse-estimate", input, CONTEXT);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(JSON.stringify(first.artifact.body)).toBe(JSON.stringify(second.artifact.body));
  });

  it("отсутствие каталога предъявляется деградацией, а не тишиной (ADR-R-026)", async () => {
    const outcome = await platform.operations.run<unknown, ParseEstimateBody>(
      "parse-estimate",
      { documentPath: kurganPath(entry.file) },
      CONTEXT,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // Каталог канонических позиций — результат трека A, его ещё нет.
    if (platform.catalogue.size === 0) {
      expect(outcome.artifact.degradations.map((d) => d.capability)).toContain("canonical_items");
      expect(outcome.artifact.body.summary.byCode).toBe(0);
      expect(outcome.artifact.body.summary.unmatched).toBe(entry.positions);
    }
  });
});
