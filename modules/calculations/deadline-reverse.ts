/**
 * Обратный расчёт срока — ТЗ §6.4.
 *
 * ЧЕМ ОТЛИЧАЕТСЯ ОТ ПРЯМОГО РАСЧЁТА
 *
 * Прямой отвечает «когда приедет, если заказать сегодня». Обратный — «когда
 * заказывать, чтобы успеть к дате потребности». Это другой вопрос, и у него
 * ответ бывает В ПРОШЛОМ. Отрицательный запас — не ошибка расчёта, а найденный
 * срыв; он обязан дойти до человека как находка, а не быть подтянут к нулю.
 *
 * ДАТА ОТСЧЁТА ПРИХОДИТ АРГУМЕНТОМ
 *
 * Системные часы внутри расчёта сделали бы прогон невоспроизводимым: тот же
 * вход завтра дал бы другой ответ, и снапшот прогона перестал бы проверяться.
 *
 * ПУСТАЯ ЦЕПОЧКА — НЕ НУЛЕВОЙ СРОК
 *
 * Отсутствие этапов дало бы «заказывать в день потребности»: арифметически
 * верно и практически ложно. Такой ответ объявляется невычислимым (§9).
 */
import { decimal, isoDate, unitCode } from "@contracts/index.js";
import type { DecimalString, FormulaTrace, IsoDate } from "@contracts/index.js";

const DAY_MS = 86_400_000;

export const DEADLINE_REVERSE_FORMULA = "calculation.deadline-reverse" as const;
export const DEADLINE_REVERSE_VERSION = 1 as const;

export interface DeliveryStage {
  readonly stage: string;
  readonly days: number;
}

/**
 * Запас ноль выделен отдельным статусом: «заказывать сегодня» — не то же, что
 * «время ещё есть», и не то же, что «срыв».
 */
export type DeadlineStatus = "в срок" | "крайний день" | "срыв" | "не вычислен";

export interface ReverseDeadline {
  /** Суммарная длительность цепочки в днях. */
  readonly leadDays: number;
  /** Крайняя дата размещения заказа. */
  readonly orderBy?: IsoDate;
  /** Дней от даты отсчёта до крайней даты заказа. Отрицательное — срыв. */
  readonly slackDays?: number;
  readonly status: DeadlineStatus;
  /** Самый долгий этап: сокращать имеет смысл его. */
  readonly longestStage?: DeliveryStage;
  readonly computable: boolean;
  readonly note: string;
  readonly trace?: FormulaTrace;
}

function addDays(date: string, days: number): IsoDate {
  const shifted = new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS);
  return isoDate(shifted.toISOString().slice(0, 10));
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function reverseDeadline(input: {
  readonly neededBy: string;
  readonly stages: readonly DeliveryStage[];
  readonly today: string;
}): ReverseDeadline {
  for (const stage of input.stages) {
    if (stage.days < 0 || !Number.isFinite(stage.days)) {
      throw new Error(`Этап «${stage.stage}»: длительность ${stage.days} дней недопустима`);
    }
  }

  if (input.stages.length === 0) {
    return {
      leadDays: 0,
      status: "не вычислен",
      computable: false,
      note: "срок заказа не вычислен: этапы не заданы, а пустая цепочка означала бы заказ в день потребности",
    };
  }

  const leadDays = input.stages.reduce((sum, stage) => sum + stage.days, 0);
  const orderBy = addDays(input.neededBy, -leadDays);
  const slackDays = daysBetween(input.today, orderBy);

  const longestStage = input.stages.reduce((longest, stage) =>
    stage.days > longest.days ? stage : longest,
  );

  const status: DeadlineStatus = slackDays > 0 ? "в срок" : slackDays === 0 ? "крайний день" : "срыв";

  const note =
    status === "срыв"
      ? `срок заказа просрочен на ${-slackDays} дней: заказывать следовало до ${orderBy}`
      : status === "крайний день"
        ? `сегодня крайний день заказа: любая задержка сдвигает потребность ${input.neededBy}`
        : `запас ${slackDays} дней до крайней даты заказа ${orderBy}`;

  const inputs: Record<string, DecimalString> = {};
  for (const stage of input.stages) {
    inputs[stage.stage] = decimal(String(stage.days));
  }

  return {
    leadDays,
    orderBy,
    slackDays,
    status,
    longestStage,
    computable: true,
    note,
    trace: {
      formulaId: DEADLINE_REVERSE_FORMULA,
      formulaVersion: DEADLINE_REVERSE_VERSION,
      inputs,
      output: decimal(String(leadDays)),
      unit: unitCode("day"),
      rounding: "half-up",
    },
  };
}
