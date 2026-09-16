/**
 * Финансовая модель объекта — детерминированно, как считал бы Ваныч в Excel.
 *
 * НАЙДЕНО ПЯТЬЮ ПРОГОНАМИ ОДНОГО ВХОДА (Дагестан, 7–8 сентября 2026): прибыль
 * по одному и тому же комплекту документов у роли-экономиста колебалась от
 * −50,8 млн до +74,5 млн ₽. Роль считала себестоимость «в голове» на разных
 * допущениях (300, 325, 338 млн…) и по-разному учитывала НДС, обеспечение и
 * стоимость денег. Число из ответа модели — число без следа (§12.1д, ADR-V3-010).
 *
 * Здесь та же модель считается кодом из ЯВНЫХ параметров, и каждый параметр
 * назван. Роль подбирает параметры и обязана назвать источник каждого; арифметика
 * — здесь, один раз, с идентификатором формулы в следе. Два прогона с
 * одинаковыми параметрами дают одинаковые числа; расхождение может быть только в
 * параметрах — и оно видно в строке параметров, а не растворено в прозе.
 *
 * СОСТАВ — ЛИСТ «Себестоимость_итог» СКИЛЛА ЛЕГАСИ и три вкладки финмодели
 * Ваныча: выручка без НДС; себестоимость по статьям; валовая маржа; стоимость
 * обеспечения и денег; три сценария (база / оптимист / стресс) со сдвигами
 * себестоимости; БДДС по месяцам с авансом, отсрочкой оплаты и графиком
 * финансирования; кассовый разрыв — первый месяц и пик. Красная линия маржи —
 * параметр с умолчанием 5 % (Артемий: «ниже 5 % = 🔴 стоп»).
 */
import { Decimal } from "decimal.js";

import { decimal, unitCode } from "@contracts/index.js";
import type { DecimalString, FormulaTrace } from "@contracts/index.js";

import { cashFlow, creditInterest, type CashFlow } from "./finance.js";

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export const FINANCE_MODEL_FORMULA = "calculation.finance-model" as const;
export const FINANCE_MODEL_VERSION = 1 as const;

export interface CostItem {
  readonly name: string;
  /** Без НДС, рубли. */
  readonly amount: string;
}

export interface FinanceModelInput {
  /** Цена контракта с НДС, ₽. */
  readonly priceWithVat: string;
  /** Ставка НДС, доля: 0.22. */
  readonly vatRate: string;
  /** Статьи себестоимости без НДС. */
  readonly costs: readonly CostItem[];
  /** Срок работ в месяцах — расходы ложатся равномерно. */
  readonly months: number;
  /** Аванс, доля от цены: 0.3. */
  readonly advanceShare?: string;
  /** Отсрочка оплаты актов, месяцев: 0, 1, 2… */
  readonly paymentLagMonths?: number;
  /**
   * График оплаты по годам, доли от цены — как в 44-ФЗ-контрактах с лимитами.
   * Задан — поступления идут по нему (внутри года равномерно), а не по актам.
   */
  readonly fundingByYear?: readonly { readonly year: number; readonly share: string }[];
  /** Обеспечение исполнения: доля от цены и ставка комиссии БГ в год. */
  readonly guaranteeShare?: string;
  readonly guaranteeRatePerYear?: string;
  /** Ставка финансирования кассового разрыва, доля в год: 0.18. */
  readonly financingRatePerYear?: string;
  /** Сдвиги себестоимости по сценариям, доли: оптимист −0.05, стресс +0.15. */
  readonly optimisticCostShift?: string;
  readonly stressCostShift?: string;
  /** Красная линия маржи, доля от выручки без НДС. */
  readonly redLine?: string;
}

export interface FinanceScenario {
  readonly id: "база" | "оптимист" | "стресс";
  readonly costs: DecimalString;
  readonly grossMargin: DecimalString;
  readonly guaranteeCost: DecimalString;
  readonly financingCost: DecimalString;
  readonly profit: DecimalString;
  readonly marginShare: DecimalString;
  readonly belowRedLine: boolean;
  readonly cash: CashFlow;
}

export interface FinanceModel {
  readonly revenueWithoutVat: DecimalString;
  readonly vat: DecimalString;
  readonly costsTotal: DecimalString;
  readonly costItems: readonly { readonly name: string; readonly amount: DecimalString; readonly share: DecimalString }[];
  readonly scenarios: readonly FinanceScenario[];
  /** Сколько нужно улучшить результат базы, чтобы выйти на красную линию; 0 — уже выше. */
  readonly toRedLine: DecimalString;
  readonly parameters: Readonly<Record<string, string>>;
  readonly trace: FormulaTrace;
  readonly assumptions: readonly string[];
}

const rub = (value: Decimal): DecimalString => decimal(value.toDecimalPlaces(2).toFixed(2));
const share4 = (value: Decimal): DecimalString => decimal(value.toDecimalPlaces(4).toFixed(4));

/**
 * БДДС по месяцам: расходы равномерно по сроку, поступления — аванс в первый
 * месяц, затем либо акты с отсрочкой (равномерно, за вычетом аванса), либо
 * график по годам (внутри года равномерно).
 */
function monthlyCash(input: FinanceModelInput, revenue: Decimal, costs: Decimal): CashFlow {
  const months = input.months;
  const lag = input.paymentLagMonths ?? 0;
  const advance = revenue.times(input.advanceShare ?? "0");
  const horizon = months + lag;

  const inflow: Decimal[] = Array.from({ length: horizon }, () => new Decimal(0));
  const outflow: Decimal[] = Array.from({ length: horizon }, () => new Decimal(0));

  const monthlyCost = costs.dividedBy(months);
  for (let m = 0; m < months; m += 1) outflow[m] = monthlyCost;

  inflow[0] = inflow[0]!.plus(advance);
  const remaining = revenue.minus(advance);

  if (input.fundingByYear !== undefined && input.fundingByYear.length > 0) {
    // Доли по годам — на 12 месяцев каждого года, начиная с первого месяца срока.
    // Аванс — часть лимита первого года, выплаченная в первый месяц: остаток
    // года ложится равномерно на его 12 месяцев.
    let offset = 0;
    input.fundingByYear.forEach((year, index) => {
      const yearly = revenue.times(year.share).minus(index === 0 ? advance : 0);
      const inYear = Math.min(12, Math.max(0, horizon - offset));
      for (let m = 0; m < inYear; m += 1) {
        inflow[offset + m] = inflow[offset + m]!.plus(yearly.dividedBy(12));
      }
      offset += 12;
    });
  } else {
    const perAct = remaining.dividedBy(months);
    for (let m = 0; m < months; m += 1) inflow[m + lag] = inflow[m + lag]!.plus(perAct);
  }

  return cashFlow({
    opening: "0",
    periods: inflow.map((value, index) => ({
      period: `месяц ${index + 1}`,
      inflow: value.toDecimalPlaces(2).toFixed(2),
      outflow: outflow[index]!.toDecimalPlaces(2).toFixed(2),
    })),
  });
}

export function buildFinanceModel(input: FinanceModelInput): FinanceModel {
  if (!Number.isInteger(input.months) || input.months <= 0) {
    throw new Error(`срок в месяцах: ожидается целое число больше нуля, получено ${input.months}`);
  }

  const price = new Decimal(input.priceWithVat);
  const vatRate = new Decimal(input.vatRate);
  const revenue = price.dividedBy(new Decimal(1).plus(vatRate));
  const vat = price.minus(revenue);
  const costs = input.costs.reduce((sum, item) => sum.plus(item.amount), new Decimal(0));
  const redLine = new Decimal(input.redLine ?? "0.05");
  const guaranteeShare = new Decimal(input.guaranteeShare ?? "0");
  const guaranteeRate = new Decimal(input.guaranteeRatePerYear ?? "0");
  const financingRate = new Decimal(input.financingRatePerYear ?? "0");
  const years = new Decimal(input.months).dividedBy(12);

  const guaranteeCost = price.times(guaranteeShare).times(guaranteeRate).times(years);

  const scenario = (id: FinanceScenario["id"], shift: string): FinanceScenario => {
    const scenarioCosts = costs.times(new Decimal(1).plus(shift));
    const cash = monthlyCash(input, revenue, scenarioCosts);
    // Стоимость денег — на пик разрыва за половину срока: кредитная линия под
    // разрыв берётся не на весь срок целиком, а по мере потребности.
    const financing = cash.peakShortfall === "0.00"
      ? new Decimal(0)
      : new Decimal(
          creditInterest({
            principal: cash.peakShortfall,
            annualRate: financingRate.toString(),
            days: Math.round((input.months * 30) / 2),
            basis: 365,
          }).interest,
        );
    const gross = revenue.minus(scenarioCosts);
    const profit = gross.minus(guaranteeCost).minus(financing);
    const marginShare = revenue.isZero() ? new Decimal(0) : profit.dividedBy(revenue);

    return {
      id,
      costs: rub(scenarioCosts),
      grossMargin: rub(gross),
      guaranteeCost: rub(guaranteeCost),
      financingCost: rub(financing),
      profit: rub(profit),
      marginShare: share4(marginShare),
      belowRedLine: marginShare.lessThan(redLine),
      cash,
    };
  };

  const scenarios = [
    scenario("база", "0"),
    scenario("оптимист", input.optimisticCostShift ?? "-0.05"),
    scenario("стресс", input.stressCostShift ?? "0.15"),
  ];

  const base = scenarios[0]!;
  const target = revenue.times(redLine);
  const toRedLine = new Decimal(base.profit).greaterThanOrEqualTo(target) ? new Decimal(0) : target.minus(base.profit);

  const parameters: Record<string, string> = {
    "цена с НДС": rub(price),
    "ставка НДС": vatRate.toString(),
    "срок, мес": String(input.months),
    "аванс, доля": input.advanceShare ?? "0",
    "отсрочка оплаты, мес": String(input.paymentLagMonths ?? 0),
    "обеспечение, доля": guaranteeShare.toString(),
    "комиссия БГ в год": guaranteeRate.toString(),
    "ставка финансирования в год": financingRate.toString(),
    "сдвиг себестоимости оптимист": input.optimisticCostShift ?? "-0.05",
    "сдвиг себестоимости стресс": input.stressCostShift ?? "0.15",
    "красная линия маржи": redLine.toString(),
    ...(input.fundingByYear === undefined ? {} : { "график по годам": input.fundingByYear.map((y) => `${y.year}: ${y.share}`).join("; ") }),
  };

  const assumptions = [
    "расходы ложатся равномерно по месяцам срока",
    input.fundingByYear === undefined
      ? "поступления — аванс в первый месяц, далее акты равномерно с указанной отсрочкой"
      : "поступления — по графику финансирования по годам, внутри года равномерно; аванс входит в первый год",
    "стоимость денег — проценты на пик кассового разрыва за половину срока",
    "налог на прибыль и стоимость капитала не учтены: показатель — прибыль до налога",
  ];

  return {
    revenueWithoutVat: rub(revenue),
    vat: rub(vat),
    costsTotal: rub(costs),
    costItems: input.costs.map((item) => ({
      name: item.name,
      amount: rub(new Decimal(item.amount)),
      share: share4(costs.isZero() ? new Decimal(0) : new Decimal(item.amount).dividedBy(costs)),
    })),
    scenarios,
    toRedLine: rub(toRedLine),
    parameters,
    trace: {
      formulaId: FINANCE_MODEL_FORMULA,
      formulaVersion: FINANCE_MODEL_VERSION,
      inputs: {
        priceWithVat: rub(price),
        vatRate: decimal(vatRate.toString()),
        costs: rub(costs),
        months: decimal(String(input.months)),
        redLine: decimal(redLine.toString()),
      },
      output: base.profit,
      unit: unitCode("RUB"),
      rounding: "half-up",
    },
    assumptions,
  };
}

/** Текстовая таблица для роли — то, что она вставляет в лист с тегом источника. */
export function renderFinanceModel(model: FinanceModel): string {
  const lines: string[] = [];
  lines.push(`ФИНМОДЕЛЬ · формула ${model.trace.formulaId} v${model.trace.formulaVersion} · числа считает код, не роль`);
  lines.push("");
  lines.push("ПАРАМЕТРЫ (каждый — с источником в твоём листе):");
  for (const [key, value] of Object.entries(model.parameters)) lines.push(`  ${key}: ${value}`);
  lines.push("");
  lines.push(`Выручка без НДС: ${model.revenueWithoutVat} ₽ · НДС: ${model.vat} ₽ · Себестоимость: ${model.costsTotal} ₽`);
  for (const item of model.costItems) lines.push(`  · ${item.name}: ${item.amount} ₽ (${new Decimal(item.share).times(100).toFixed(1)} %)`);
  lines.push("");
  lines.push("СЦЕНАРИИ:");
  lines.push("  сценарий | себестоимость | валовая маржа | БГ | стоимость денег | прибыль | маржа % | разрыв: первый месяц / пик");
  for (const s of model.scenarios) {
    lines.push(
      `  ${s.id} | ${s.costs} | ${s.grossMargin} | ${s.guaranteeCost} | ${s.financingCost} | ${s.profit} | ${new Decimal(s.marginShare).times(100).toFixed(2)} %${s.belowRedLine ? " 🔴 ниже красной линии" : ""} | ${s.cash.firstGapAt ?? "нет"} / ${s.cash.peakShortfall} ₽`,
    );
  }
  lines.push("");
  lines.push(`До красной линии базе не хватает: ${model.toRedLine} ₽`);
  lines.push("ДОПУЩЕНИЯ РАСЧЁТА: " + model.assumptions.join("; "));
  return lines.join("\n");
}
