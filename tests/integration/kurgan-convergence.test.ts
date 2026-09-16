/**
 * Гейт M1: сходимость на курганском комплекте (ТЗ §12.1б — расхождение 0 ₽).
 *
 * Тест работает на НАСТОЯЩИХ файлах заказчика, а не на синтетике: критерий
 * приёмки измеряется на контрольном наборе, и подтверждение на выдуманной
 * смете его не закрывает.
 */
import { describe, expect, it } from "vitest";

import { calculateConvergence, compareWithHeader } from "@modules/calculations/convergence.js";
import { parseLsr } from "@modules/documents/parsers/grand-smeta.js";
import { readXlsxSheet } from "@platform/storage/xlsx-reader.js";
import { decimal } from "@contracts/index.js";

import {
  KURGAN_LSR,
  KURGAN_SSRSS_THOUSANDS,
  KURGAN_SUM_OF_LSR,
  kurganAvailable,
  kurganPath,
} from "../fixtures/kurgan.js";

const describeKurgan = kurganAvailable() ? describe : describe.skip;

describeKurgan("курганский комплект: разбор и сходимость", () => {
  for (const entry of KURGAN_LSR) {
    describe(entry.file.slice(0, 40), () => {
      it(`распознаёт форму ${entry.form} и находит колонку итога`, async () => {
        const sheet = await readXlsxSheet(kurganPath(entry.file));
        const lsr = parseLsr(sheet);

        expect(lsr.form).toBe(entry.form);
        expect(lsr.totalColumn).toMatch(/^[A-Z]+$/);
        expect(lsr.issues.filter((issue) => issue.severity === "blocking")).toEqual([]);
      });

      it(`извлекает ${entry.positions} позиций в ${entry.sections} разделе(ах)`, async () => {
        const sheet = await readXlsxSheet(kurganPath(entry.file));
        const lsr = parseLsr(sheet);

        expect(lsr.sections).toHaveLength(entry.sections);
        expect(lsr.sections.reduce((n, section) => n + section.positions.length, 0)).toBe(entry.positions);
      });

      it("сходимость позиций с итогами разделов и сметы — 0 ₽", async () => {
        const sheet = await readXlsxSheet(kurganPath(entry.file));
        const lsr = parseLsr(sheet);

        const report = calculateConvergence({
          sections: lsr.sections.map((section) => ({
            number: section.number,
            positionTotals: section.positions.map((position) => position.total),
            declaredTotal: section.declaredTotal,
          })),
          declaredTotal: lsr.declaredTotal,
          headerTotalThousands: lsr.headerTotalThousands,
        });

        for (const section of report.sections) {
          if (section.status === "not_comparable") {
            // Пустой раздел предъявляется явно, а не выдаётся за сходимость.
            expect(section.reason).toBeDefined();
            continue;
          }
          expect(section.delta, `${section.scope}`).toBe("0.00");
        }

        expect(report.document.declared).toBe(decimal(entry.declaredTotal));
        expect(report.document.delta).toBe("0.00");
        expect(report.converged).toBe(true);
      });

      it("каждое число несёт след формулы (ТЗ §9, §12.1д)", async () => {
        const sheet = await readXlsxSheet(kurganPath(entry.file));
        const lsr = parseLsr(sheet);

        const report = calculateConvergence({
          sections: lsr.sections.map((section) => ({
            number: section.number,
            positionTotals: section.positions.map((position) => position.total),
            declaredTotal: section.declaredTotal,
          })),
          declaredTotal: lsr.declaredTotal,
        });

        for (const level of [...report.sections, report.document]) {
          expect(level.trace.formulaId).toMatch(/^calculation\.convergence\./);
          expect(level.trace.formulaVersion).toBe(1);
          expect(level.trace.rounding).toBe("half-up");

          // У пустого раздела слагаемых нет — след это честно отражает.
          const expectedInputs = level.status === "not_comparable" && level.computed === "0.00" ? 0 : 1;
          expect(Object.keys(level.trace.inputs).length).toBeGreaterThanOrEqual(expectedInputs);
        }
      });
    });
  }

  it("сумма четырёх ЛСР равна известной сумме комплекта", async () => {
    let total = 0n;

    for (const entry of KURGAN_LSR) {
      const sheet = await readXlsxSheet(kurganPath(entry.file));
      const lsr = parseLsr(sheet);

      const report = calculateConvergence({
        sections: lsr.sections.map((section) => ({
          number: section.number,
          positionTotals: section.positions.map((position) => position.total),
          declaredTotal: section.declaredTotal,
        })),
        declaredTotal: lsr.declaredTotal,
      });

      // Курганский комплект — с ценами: итог обязан посчитаться. Пусто здесь
      // означало бы потерю сумм, и молча пропустить это нельзя.
      expect(report.document.computed, `${lsr.sheet}: итог не посчитан`).toBeDefined();
      total += BigInt(report.document.computed!.replace(".", ""));
    }

    const asString = `${total / 100n}.${String(total % 100n).padStart(2, "0")}`;
    expect(asString).toBe(KURGAN_SUM_OF_LSR);
  });

  it("расхождение с ССРСС объясняется шкалой, а не ошибкой сметы", () => {
    // ССРСС номинирован в тыс. руб. с копейками → гранулярность 10 ₽.
    const comparison = compareWithHeader(decimal(KURGAN_SUM_OF_LSR), KURGAN_SSRSS_THOUSANDS);

    expect(comparison).toBeDefined();
    expect(comparison?.delta).toBe("7.52");
    expect(comparison?.granularity).toBe("10");
    expect(comparison?.explainedByScale).toBe(true);
  });

  it("не выдаёт расхождение за пределами гранулярности за округление", () => {
    const comparison = compareWithHeader(decimal("104976702.48"), "104977.00");

    expect(comparison?.explainedByScale).toBe(false);
  });
});
