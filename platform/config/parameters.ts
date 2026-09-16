/**
 * Параметры с датой начала действия (ТЗ §6.4, ADR-R-014).
 *
 * Дословно ТЗ: «Ставка налога на добавленную стоимость и ключевая ставка задаются
 * параметром с датой, начиная с которой значение действует. Единственное значение
 * в коде не зашивается.»
 *
 * Это не абстрактное требование: в курганском ССРСС стоит НДС 20% (№303-ФЗ), а
 * текущая ставка — 22%. Расчёт по объекту 2023 года и по объекту 2026 года обязан
 * взять разные ставки, поэтому параметр разрешается НА ДАТУ, а не читается как
 * константа.
 *
 * Значения приходят из `config/parameters/*.json` и валидируются схемой при старте;
 * здесь только разрешение и провенанс.
 */
import { z } from "zod";

import { decimal, isoDate, sha256 } from "@contracts/index.js";
import type { DecimalString, IsoDate, SourceRef, Valued } from "@contracts/index.js";

export const datedValueSchema = z.object({
  effectiveFrom: z.string(),
  value: z.string(),
  source: z.string().min(1),
});

export const parameterSchema = z.object({
  id: z.string().min(1),
  unit: z.string().min(1),
  values: z.array(datedValueSchema).min(1),
});

export const parameterBundleSchema = z.object({
  parameters: z.array(parameterSchema).min(1),
});

export type DatedValue = z.infer<typeof datedValueSchema>;
export type ParameterDefinition = z.infer<typeof parameterSchema>;
export type ParameterBundle = z.infer<typeof parameterBundleSchema>;

export class ParameterRegistry {
  readonly #byId: ReadonlyMap<string, ParameterDefinition>;
  readonly #bundleHash: string;

  constructor(bundle: ParameterBundle, bundleHash: string) {
    const byId = new Map<string, ParameterDefinition>();

    for (const parameter of bundle.parameters) {
      if (byId.has(parameter.id)) {
        throw new Error(`Параметр объявлен дважды: ${parameter.id}`);
      }
      // Значения хранятся отсортированными по дате — разрешение идёт с конца.
      const sorted = [...parameter.values].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
      byId.set(parameter.id, { ...parameter, values: sorted });
    }

    this.#byId = byId;
    this.#bundleHash = bundleHash;
  }

  has(id: string): boolean {
    return this.#byId.has(id);
  }

  ids(): readonly string[] {
    return [...this.#byId.keys()];
  }

  /**
   * Значение параметра, действующее на указанную дату, вместе с провенансом.
   *
   * Возвращает `undefined`, если на эту дату значения нет — вызывающая сторона
   * обязана сообщить о недостатке данных, а не подставить ноль (ТЗ §9).
   */
  resolve(id: string, at: IsoDate): Valued<DecimalString> | undefined {
    const parameter = this.#byId.get(id);
    if (parameter === undefined) {
      return undefined;
    }

    let applicable: DatedValue | undefined;
    for (const candidate of parameter.values) {
      if (candidate.effectiveFrom <= at) {
        applicable = candidate;
      } else {
        break;
      }
    }

    if (applicable === undefined) {
      return undefined;
    }

    const ref: SourceRef = {
      sourceId: `parameter:${id}`,
      contentHash: sha256(this.#bundleHash),
      locator: { kind: "record", recordId: `${id}@${applicable.effectiveFrom}` },
      status: "fact",
      acquisition: "imported",
      checkedAt: isoDate(applicable.effectiveFrom),
      // Параметры ставок не протухают по 90-дневному правилу: они действуют
      // до появления следующей записи с более поздней датой.
      staleAfterDays: Number.POSITIVE_INFINITY,
    };

    return { value: decimal(applicable.value), provenance: { kind: "source", ref } };
  }

  /** Разрешает параметр либо бросает с внятной причиной — для расчётного модуля. */
  require(id: string, at: IsoDate): Valued<DecimalString> {
    const resolved = this.resolve(id, at);

    if (resolved === undefined) {
      const known = this.#byId.has(id) ? "нет значения, действующего на эту дату" : "параметр не объявлен";
      throw new Error(`Параметр ${id} не разрешён на ${at}: ${known}`);
    }

    return resolved;
  }
}
