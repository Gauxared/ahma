/**
 * Гейт MVP (роадмап M1) на настоящей папке объекта.
 *
 * Проверяется не арифметика — она закрыта тестами модулей, — а то, что сквозной
 * обход папки даёт ожидаемый вердикт и НЕ теряет документы: в этой же папке
 * лежат два тома рабочей документации в PDF и сводный сметный расчёт по другой
 * форме, и каждый из них должен быть предъявлен, а не пропущен молча.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { bootstrap } from "@platform/bootstrap.js";
import type { ParseEstimateBody } from "@modules/documents/operations/parse-estimate.js";
import type { CheckConvergenceBody } from "@modules/calculations/operations/check-convergence.js";
import { checkObject } from "@modules/workflow/check-object.js";
import { classifyDocument } from "@modules/workflow/classify-document.js";

import { sumObjectTotals } from "@modules/calculations/object-total.js";
import { decimal } from "@contracts/index.js";
import { compareWithHeader } from "@modules/calculations/convergence.js";
import { parseSsrss } from "@modules/documents/parsers/ssrss.js";
import { readXlsxSheet } from "@platform/storage/xlsx-reader.js";

import {
  kurganAvailable,
  KURGAN_INPUT,
  KURGAN_SSRSS_THOUSANDS,
  KURGAN_SUM_OF_LSR,
} from "../fixtures/kurgan.js";

const KURGAN_SSRSS_FILE = "Сводный сметный расчет - ССРСС по Методике 2020 _РИМ_.xlsx";

const describeKurgan = kurganAvailable() ? describe : describe.skip;

const TENANT = "00000000-0000-0000-0000-000000000000";

async function runCheck() {
  const platform = bootstrap();
  const now = new Date().toISOString();

  return checkObject(KURGAN_INPUT, {
    discover: async (path) =>
      (await readdir(path))
        .sort((a, b) => a.localeCompare(b, "ru"))
        .map((name) => ({ path: join(path, name), kind: classifyDocument(name) })),

    checkDocument: async (document) => {
      const parsed = await platform.operations.run<unknown, ParseEstimateBody>(
        "parse-estimate",
        { documentPath: document.path },
        { tenantId: TENANT, entryPoint: "subgraph", subjects: new Map(), now },
      );

      if (!parsed.ok) throw new Error("разбор заблокирован");

      const blocking = parsed.artifact.body.issues.filter((issue) => issue.severity === "blocking");
      if (blocking.length > 0) throw new Error(blocking.map((issue) => issue.message).join("; "));

      const convergence = await platform.operations.run<unknown, CheckConvergenceBody>(
        "check-convergence",
        {
          documentPath: document.path,
          contentHash: parsed.artifact.inputHashes[0]!,
          sections: parsed.artifact.body.sections.map((section) => ({
            number: section.number,
            name: section.name,
            declaredTotal: section.declaredTotal,
            positionTotals: section.positions.map((position) => position.amount?.value.amount),
          })),
          declaredTotal: parsed.artifact.body.declaredTotal,
          headerTotalThousands: parsed.artifact.body.headerTotalThousands,
        },
        {
          tenantId: TENANT,
          entryPoint: "subgraph",
          subjects: new Map([["estimate", { id: "estimate", status: "draft" as const, returnedCount: 0 }]]),
          now,
        },
      );

      if (!convergence.ok) throw new Error("сходимость не посчитана");

      return {
        path: document.path,
        positions: parsed.artifact.body.sections.reduce((n, section) => n + section.positions.length, 0),
        byCode: parsed.artifact.body.summary.byCode,
        unmatched: parsed.artifact.body.summary.unmatched,
        converged: convergence.artifact.body.converged,
        delta: convergence.artifact.body.document.delta?.value.amount,
        documentTotal: convergence.artifact.body.document.computed?.value.amount,
      };
    },
  });
}

describeKurgan("Проверка курганского объекта целиком", () => {
  it("принимает объект: четыре сметы, 101 позиция, сходимость 0 ₽", async () => {
    const body = await runCheck();

    expect(body.totals.checked).toBe(4);
    expect(body.totals.failed).toBe(0);
    expect(body.totals.positions).toBe(101);
    expect(body.verdict).toBe("принято");
  });

  it("держит §12.1б: расхождение внутри каждой ЛСР равно 0 ₽", async () => {
    const body = await runCheck();

    for (const document of body.documents.filter((candidate) => candidate.status === "проверен")) {
      expect(document.delta).toBe("0.00");
      expect(document.converged).toBe(true);
    }

    expect(body.gates.find((gate) => gate.id === "§12.1б")?.passed).toBe(true);
  });

  it("предъявляет три документа, которые не являются ЛСР, а не прячет их", async () => {
    // Два тома рабочей документации в PDF и сводный сметный расчёт по
    // Приложению №6. Молчаливый пропуск выглядел бы как полный обход.
    const body = await runCheck();
    const skipped = body.documents.filter((document) => document.status === "не поддержан");

    expect(skipped).toHaveLength(3);
    expect(skipped.filter((document) => document.kind === "рабочая-документация")).toHaveLength(2);
    expect(skipped.filter((document) => document.kind === "ссрсс")).toHaveLength(1);

    for (const document of skipped) {
      expect(document.reason ?? "").not.toBe("");
    }
  });

  it("сопоставляет по шифру 98 позиций из 101", async () => {
    // Каталог собран из государственной ФСНБ-2022, а не из этих смет,
    // поэтому замер честен по построению. Пропускается, если каталог не собран.
    const platform = bootstrap();
    if (platform.catalogue.size === 0) return;

    const body = await runCheck();
    expect(body.totals.byCode).toBe(98);
    expect(body.totals.unmatched).toBe(3);
  });
});

describeKurgan("итог курганского объекта", () => {
  it("сумма четырёх ЛСР совпадает с эталонным выходом до копейки", async () => {
    // KURGAN_SUM_OF_LSR взята из reference-system/output-1, лист 04_Свод_ЛСР,
    // строка «СУММА 4 ЛСР». Это сверка с результатом человека, а не с самим
    // собой: значение посчитано заказчиком независимо от нашего разбора.
    const body = await runCheck();

    const total = sumObjectTotals(
      body.documents
        .filter((document) => document.status === "проверен")
        .map((document) => ({
          path: document.path,
          total: (document.documentTotal ?? "0.00") as never,
        })),
    );

    expect(total.total).toBe(KURGAN_SUM_OF_LSR);
  });

  it("итог объекта покидает расчёт только со следом формулы", async () => {
    const body = await runCheck();
    const total = sumObjectTotals(
      body.documents
        .filter((document) => document.status === "проверен")
        .map((document) => ({
          path: document.path,
          total: (document.documentTotal ?? "0.00") as never,
        })),
    );

    expect(Object.keys(total.trace.inputs)).toHaveLength(4);
    expect(total.trace.output).toBe(KURGAN_SUM_OF_LSR);
  });
});

describeKurgan("сверка курганского объекта со сводным сметным расчётом", () => {
  it("сумма четырёх ЛСР сходится с «Итого по Главам 1-9» в пределах шкалы", async () => {
    // ССРСС объявляет 104 976.71 тыс. руб., сумма смет — 104 976 702.48 ₽.
    // Расхождение 7.52 ₽ при гранулярности шкалы 10 ₽ — округление источника,
    // а не ошибка сметы. Гасить его молча запрещено (ТЗ §9).
    const sheet = await readXlsxSheet(join(KURGAN_INPUT, KURGAN_SSRSS_FILE));
    const ссрсс = parseSsrss(sheet);

    const главы = ссрсс.totals.find((total) => total.scope === "chapters:1-9");
    expect(главы?.total).toBe(KURGAN_SSRSS_THOUSANDS);

    const comparison = compareWithHeader(decimal(KURGAN_SUM_OF_LSR), главы!.total);

    expect(comparison?.delta).toBe("7.52");
    expect(comparison?.granularity).toBe("10");
    expect(comparison?.explainedByScale).toBe(true);
  });

  it("разбирает четыре объекта сводного расчёта с шифрами локальных смет", async () => {
    const ссрсс = parseSsrss(await readXlsxSheet(join(KURGAN_INPUT, KURGAN_SSRSS_FILE)));

    expect(ссрсс.objects.map((object) => object.basis)).toEqual(["05-02", "05-01", "09-01", "09-02"]);
    expect(ссрсс.scale).toBe("thousands");
  });

  it("не считает непредвиденные затраты и НДС объектами строительства", async () => {
    // Оба берутся процентом от суммы объектов и входят в итог ПОСЛЕ неё.
    const ссрсс = parseSsrss(await readXlsxSheet(join(KURGAN_INPUT, KURGAN_SSRSS_FILE)));

    expect(ссрсс.accruals).toHaveLength(2);
    expect(ссрсс.accruals.map((accrual) => accrual.name).join(" ")).toMatch(/Непредвиденные/);
    expect(ссрсс.accruals.map((accrual) => accrual.name).join(" ")).toMatch(/НДС/);
  });
});
