/**
 * Паритет экрана сравнения с расчётом — гейт Ф3.
 *
 * ЧТО ИМЕННО ДОКАЗЫВАЕТСЯ
 *
 * Экран §5.5 (4) не считает ничего сам: он читает артефакт, записанный
 * `compareOffers`. Между расчётом и экраном лежат два преобразования — запись в
 * JSON и разбор JSON, — и каждое способно потерять копейку или подменить
 * `null` нулём. Тест проводит один и тот же набор предложений обоими путями и
 * сверяет числа до знака.
 *
 * ВТОРОЕ, И БОЛЕЕ ВАЖНОЕ
 *
 * §5.2 требует, чтобы несопоставимые позиции в расчёт разброса не входили.
 * Проверяется, что подрядчик, у которого позиции нет, попадает в список
 * исключённых ПОИМЁННО и не появляется среди предложений позиции — то есть его
 * нельзя случайно посчитать подрядчиком с ценой ноль.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ArtifactRepository } from "@platform/db/artifact-repository";
import { createPrismaClient, withTenant } from "@platform/db/prisma";
import { compareOffers, type CompareBundle } from "@platform/execution/compare-offers";

import { readCheck } from "./check-read-model";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined || DATABASE_URL === "" ? describe.skip : describe;

const bundle = JSON.parse(readFileSync("tests/fixtures/offers-berezovsky.json", "utf8")) as CompareBundle;

describeDb("экран сравнения воспроизводит расчёт", () => {
  const db = createPrismaClient(DATABASE_URL);
  const tenant = randomUUID();
  let checkId = "";

  beforeAll(async () => {
    await db.tenant.create({ data: { id: tenant, slug: `cmp-${tenant.slice(0, 8)}`, displayName: "Сравнение" } });

    await withTenant(db, tenant, async (tx) => {
      const object = await tx.projectObject.create({
        data: { tenantId: tenant, code: "CMP-1", name: "Объект сравнения" },
      });
      const check = await tx.check.create({
        data: {
          tenantId: tenant,
          objectId: object.id,
          workflowId: "compare-offers",
          mode: "standard",
          createdBy: randomUUID(),
          status: "completed",
          completeness: "single",
        },
      });
      checkId = check.id;

      await new ArtifactRepository().save(
        tx,
        {
          id: randomUUID(),
          tenantId: tenant,
          operation: { id: "compare-offers", version: 1 },
          completeness: "single",
          inputHashes: [],
          degradations: [],
          body: compareOffers(bundle),
          producedAt: new Date().toISOString(),
        } as never,
        [],
        check.id,
      );
    });
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: tenant } });
    await db.$disconnect();
  });

  it("числа разброса и оценки совпадают с расчётом до знака", async () => {
    const computed = compareOffers(bundle);
    const card = await readCheck(tenant, "CMP-1", checkId);
    const view = card?.artifacts[0]?.comparison;

    expect(view).toBeDefined();
    expect(view?.positions).toHaveLength(computed.positions.length);

    for (const expected of computed.positions) {
      const shown = view?.positions.find((position) => position.canonicalId === expected.canonicalId);
      expect(shown, expected.canonicalId).toBeDefined();

      // Статистика отдаётся, только если расчёт объявил её посчитанной: при
      // одном предложении `spread` заполняет min/median/max, но говорит
      // `computable: false`, и показывать их нельзя — это разброс одного
      // значения, а не разброс.
      expect(shown?.min).toBe(expected.spread.computable ? expected.spread.min : null);
      expect(shown?.median).toBe(expected.spread.computable ? expected.spread.median : null);
      expect(shown?.max).toBe(expected.spread.computable ? expected.spread.max : null);
      expect(shown?.unitMedian).toBe(expected.unitSpread.computable ? expected.unitSpread.median : null);

      // И обратное: когда разброс посчитан, ни одно число не потерялось.
      if (expected.spread.computable) {
        expect(shown?.median).toBeTruthy();
      }

      // Оценка либо построена и совпадает, либо не построена и названа причина.
      // Третьего — пустой ячейки — быть не может.
      if (expected.estimate.computable) {
        expect(shown?.estimateUnitPrice).toBe(expected.estimate.unitPrice);
        expect(shown?.estimateTotal).toBe(expected.estimate.total);
        expect(shown?.estimateReason).toBeNull();
      } else {
        expect(shown?.estimateUnitPrice).toBeNull();
        expect(shown?.estimateReason).toBeTruthy();
      }
    }
  });

  it("аномалия сохраняет сумму влияния", async () => {
    const computed = compareOffers(bundle);
    const card = await readCheck(tenant, "CMP-1", checkId);

    const expected = computed.positions.flatMap((position) => position.spread.anomalies);
    const shown = (card?.artifacts[0]?.comparison?.positions ?? []).flatMap((position) => position.anomalies);

    expect(shown).toHaveLength(expected.length);
    expect(expected.length).toBeGreaterThan(0);

    for (const anomaly of expected) {
      const match = shown.find((item) => item.source === anomaly.source);
      expect(match?.impact).toBe(anomaly.impact);
      expect(match?.amount).toBe(anomaly.amount);
    }
  });

  it("подрядчик без позиции назван поимённо и не попал в предложения позиции", async () => {
    const card = await readCheck(tenant, "CMP-1", checkId);
    // У «профлист-н75» позиция есть только у одного подрядчика.
    const position = card?.artifacts[0]?.comparison?.positions.find((item) => item.canonicalId === "профлист-н75");

    expect(position?.excluded.map((item) => item.source).sort()).toEqual(["Беротек", "Нейва"]);
    expect(position?.offers.map((offer) => offer.source)).toEqual(["ЦСКЗ"]);
    // Разброс по одному предложению не считается — и причина названа.
    expect(position?.spreadReason).toBeTruthy();
    expect(position?.median).toBeNull();
  });
});
