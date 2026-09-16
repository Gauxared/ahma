/**
 * Реестр формул — ADR-R-014, ТЗ §6.4.
 *
 * Дословно ADR: «формула вне `formula-registry` — запрещено».
 *
 * ЗАЧЕМ РЕЕСТР, ЕСЛИ ВЕРСИЯ ЛЕЖИТ РЯДОМ С ФОРМУЛОЙ
 *
 * Версия рядом с формулой — обещание, которое некому проверить. Формулу правят,
 * а `VERSION = 1` рядом с ней трогать забывают, и два разных вычисления уходят
 * в отчёты под одним номером. Разобрать потом, какое из них дало число в
 * подписанном документе, невозможно: след говорит «версия 1», а версий 1 было
 * две. Для системы, где число из отчёта защищают перед заказчиком, это дороже,
 * чем ошибка в самой формуле: ошибку находят, неотличимые версии — нет.
 *
 * Реестр не мешает забыть. Он делает забывчивость видимой: объявления лежат в
 * одном файле, а гейт сборки сверяет с ним каждую формулу в коде.
 *
 * ВЕРСИЮ НЕЛЬЗЯ ПЕРЕДАТЬ СНАРУЖИ
 *
 * `trace()` берёт версию и округление ИЗ ОБЪЯВЛЕНИЯ. Если бы их разрешалось
 * передать аргументом, реестр остался бы справочником, с которым код волен не
 * соглашаться, — а расхождение справочника с кодом хуже отсутствия справочника:
 * оно выглядит как порядок.
 *
 * СОСТАВ ВХОДОВ ПРОВЕРЯЕТСЯ ТОЖЕ
 *
 * След с неполным набором входов невоспроизводим, а лишний вход означает, что
 * формулу изменили, а реестр — нет. И то и другое — отказ построить след, а не
 * подстановка умолчания: §9, «неизвестное не превращается в ноль».
 */
import { join } from "node:path";

import { z } from "zod";

import { decimal, unitCode } from "@contracts/index.js";
import type { DecimalString, FormulaTrace, Money, Quantity, RoundingMode } from "@contracts/index.js";

import { loadBundle } from "./bundle-loader.js";

/** Округление объявляется реестром: два прогона одной формулы обязаны совпасть. */
const roundingSchema = z.enum(["half-up", "half-even", "down", "up"]);

export const formulaSchema = z.object({
  id: z.string().min(1),
  /** Человеческое имя — оно попадает в выгрузки и в объяснение числа. */
  title: z.string().min(1),
  version: z.number().int().positive(),
  /** Пункт ТЗ. Формула без ссылки на пункт — число, за которое никто не отвечает. */
  clause: z.string().regex(/§/, "формула обязана ссылаться на пункт ТЗ"),
  rounding: roundingSchema,
  /** Единица результата: `RUB`, `m2`, `day`, `fraction`, … */
  unit: z.string().min(1).optional(),
  /**
   * Арность. Сумма N смет объекта и сумма позиций раздела имеют ОТКРЫТЫЙ набор
   * входов: имена слагаемых — это пути файлов и номера строк, заранее их не
   * перечислить. Такие формулы объявляются `variadic` ЯВНО, чтобы открытость
   * набора была решением в реестре, а не молчаливым обходом проверки.
   */
  arity: z.enum(["fixed", "variadic"]).default("fixed"),
  /**
   * Вычисление из ничего не воспроизводится. Для `variadic` здесь название
   * класса слагаемых, а не их перечень.
   */
  inputs: z.array(z.string().min(1)).min(1),
  output: z.string().min(1),
  /** Чем формула отличается от соседней — для тех, кто будет её защищать. */
  note: z.string().optional(),
});

export const formulaBundleSchema = z.object({
  formulas: z.array(formulaSchema).min(1),
});

export type FormulaDefinition = z.infer<typeof formulaSchema>;
export type FormulaBundle = z.infer<typeof formulaBundleSchema>;
/** Форма ДО применения умолчаний: то, что реально лежит в JSON. */
export type FormulaBundleInput = z.input<typeof formulaBundleSchema>;

/**
 * Вход следа. Строка принимается наравне с `DecimalString` и ПРОВЕРЯЕТСЯ здесь:
 * так же, как расчётные модули валидируют свои входы на границе. Непроверенная
 * строка в следе означала бы след, который не воспроизводится.
 */
export type TraceInput = DecimalString | Quantity | Money | string;

export interface TraceRequest {
  readonly inputs: Readonly<Record<string, TraceInput>>;
  readonly output: DecimalString | string;
  /**
   * Уточнение области: сходимость считается по разделу, по смете и по шапке —
   * это одна формула в трёх областях, а не три формулы.
   */
  readonly scope?: string;
}

export class FormulaRegistry {
  readonly #byId: ReadonlyMap<string, FormulaDefinition>;

  /**
   * Разбор идёт ЗДЕСЬ, а не только в загрузчике: реестр, собранный из
   * непроверенных данных, — реестр, которому нельзя верить, а верить ему
   * обязаны все расчёты.
   */
  constructor(bundle: FormulaBundleInput) {
    const parsed = formulaBundleSchema.parse(bundle);
    const byId = new Map<string, FormulaDefinition>();

    for (const formula of parsed.formulas) {
      if (byId.has(formula.id)) {
        throw new Error(`Формула объявлена дважды: ${formula.id}`);
      }
      byId.set(formula.id, formula);
    }

    this.#byId = byId;
  }

  has(id: string): boolean {
    return this.#byId.has(id);
  }

  ids(): readonly string[] {
    return [...this.#byId.keys()];
  }

  get(id: string): FormulaDefinition | undefined {
    return this.#byId.get(id);
  }

  all(): readonly FormulaDefinition[] {
    return [...this.#byId.values()];
  }

  /**
   * Строит след вычисления. Версия и округление — из объявления; состав входов
   * сверяется с объявленным.
   */
  trace(id: string, request: TraceRequest): FormulaTrace {
    const formula = this.#byId.get(id);

    if (formula === undefined) {
      throw new Error(
        `Формула ${id} не объявлена в реестре (ADR-R-014: формула вне formula-registry запрещена)`,
      );
    }

    const given = Object.keys(request.inputs);

    if (formula.arity === "variadic") {
      // Открытый набор всё равно не может быть пустым: след без слагаемых
      // утверждает, что число получено ни из чего.
      if (given.length === 0) {
        throw new Error(
          `След формулы ${id} не содержит ни одного слагаемого: ` +
            "сумма пустого набора — не ноль рублей, а отсутствие расчёта (§9).",
        );
      }
    } else {
      const declared = new Set(formula.inputs);

      const missing = formula.inputs.filter((name) => !(name in request.inputs));
      if (missing.length > 0) {
        throw new Error(
          `След формулы ${id} неполон: не передан вход ${missing.join(", ")}. ` +
            "Недостающий вход — не ноль по умолчанию (§9): такой след невоспроизводим.",
        );
      }

      const extra = given.filter((name) => !declared.has(name));
      if (extra.length > 0) {
        throw new Error(
          `След формулы ${id} содержит необъявленный вход ${extra.join(", ")}: ` +
            "формулу изменили, а реестр — нет.",
        );
      }
    }

    const traceId = request.scope === undefined ? formula.id : `${formula.id}.${request.scope}`;

    const inputs: Record<string, DecimalString | Quantity | Money> = {};
    for (const [name, value] of Object.entries(request.inputs)) {
      inputs[name] = typeof value === "string" ? decimal(value) : value;
    }

    const trace: FormulaTrace = {
      formulaId: traceId,
      formulaVersion: formula.version,
      inputs,
      output: decimal(request.output),
      rounding: formula.rounding as RoundingMode,
    };

    return formula.unit === undefined ? trace : { ...trace, unit: unitCode(formula.unit) };
  }
}

export const FORMULA_REGISTRY_PATH = join("config", "formulas", "registry.json");

let cached: FormulaRegistry | undefined;

/**
 * Реестр проекта. Кэшируется: файл читается один раз за процесс, как и прочие
 * бандлы, — невалидный останавливает запуск, а не деградирует в умолчание.
 */
export async function loadFormulaRegistry(path = FORMULA_REGISTRY_PATH): Promise<FormulaRegistry> {
  if (cached !== undefined && path === FORMULA_REGISTRY_PATH) {
    return cached;
  }

  const bundle = loadBundle(path, formulaBundleSchema);
  const registry = new FormulaRegistry(bundle.value);

  if (path === FORMULA_REGISTRY_PATH) {
    cached = registry;
  }

  return registry;
}
