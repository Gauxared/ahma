/**
 * Область знания как ГЕЙТ, а не как запись о намерении (ADR-R-024, R-026).
 *
 * До этой задачи `--scope` менял отпечаток и писал деградацию, но операции шли
 * как ни в чём не бывало: все они объявляли `requires: []`. Здесь проверяется,
 * что выключенный источник ДЕЙСТВИТЕЛЬНО останавливает работу и называет,
 * чего не хватает.
 */
import { describe, expect, it } from "vitest";

import { bootstrap } from "@platform/bootstrap.js";

import { kurganAvailable, KURGAN_INPUT } from "../fixtures/kurgan.js";
import { join } from "node:path";

const describeKurgan = kurganAvailable() ? describe : describe.skip;

const ЛСР = join(KURGAN_INPUT, "РИМ ПНР Курган_СОТВ_ испр. - ЛСР по Методике 2020 _РМ_.xlsx");
const TENANT = "00000000-0000-0000-0000-000000000000";

const context = { tenantId: TENANT, entryPoint: "single" as const, subjects: new Map(), now: "2026-08-28T00:00:00.000Z" };

describeKurgan("область знания останавливает операцию", () => {
  it("без ограничения разбор идёт", async () => {
    const platform = bootstrap();
    const outcome = await platform.operations.run("parse-estimate", { documentPath: ЛСР }, context);

    expect(outcome.ok).toBe(true);
  });

  it("с выключенным источником документов разбор НЕ стартует", async () => {
    // Раньше здесь было ok: true — операция не требовала ничего, и область
    // оставалась записью о намерении.
    const platform = bootstrap({ knowledgeScope: ["reference-base"] });
    const outcome = await platform.operations.run("parse-estimate", { documentPath: ЛСР }, context);

    expect(outcome.ok).toBe(false);
  });

  it("отказ НАЗЫВАЕТ недостающую способность, а не просто отказывает", async () => {
    // «Не могу» без «чего не хватает» человек не может исправить.
    const platform = bootstrap({ knowledgeScope: ["reference-base"] });
    const outcome = await platform.operations.run("parse-estimate", { documentPath: ЛСР }, context);

    if (outcome.ok) throw new Error("ожидался отказ");

    const missing = outcome.blocks.filter((block) => block.kind === "missing_capability");
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ capability: "estimate_documents" });
  });

  it("пустая область запрещает всё, а не снимает ограничение", async () => {
    const platform = bootstrap({ knowledgeScope: [] });
    const outcome = await platform.operations.run("parse-estimate", { documentPath: ЛСР }, context);

    expect(outcome.ok).toBe(false);
  });

  it("источник документов объявляет сырьё, а не извлечённые позиции", async () => {
    // Правило таксономии: источник даёт то, что лежит в папке; операция —
    // то, что из этого извлечено. Позиции производит разбор.
    const platform = bootstrap();
    const provides = platform.extensions
      .all("knowledge-source")
      .find((extension) => extension.manifest.id === "object-documents")?.manifest.provides;

    expect(provides).toContain("estimate_documents");
    expect(provides).not.toContain("estimate_positions");

    expect(platform.operations.definition("parse-estimate")?.provides).toContain("estimate_positions");
  });
});
