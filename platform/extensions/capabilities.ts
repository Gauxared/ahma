/**
 * Разрешение способностей (ADR-R-026).
 *
 * Операция объявляет `requires: [work_rates]`, а не «мне нужен раздел 01 опорной
 * базы». Источники объявляют, что предоставляют. Реестр связывает одно с другим
 * при старте прогона.
 *
 * Что покупает этот один уровень косвенности:
 *  · смена источника — изменение манифеста, а не кода;
 *  · несколько источников на одну способность;
 *  · объявленная деградация вместо ручных проверок «а есть ли раздел 04»
 *    в каждой операции.
 *
 * Инвариант ТЗ §9: отсутствие обязательной способности означает отказ с
 * названием недостающего, а не подстановку нуля.
 */
import type { CapabilityId, Degradation, OperationBlock, OperationDefinition } from "@contracts/index.js";

export interface CapabilityProvider {
  readonly sourceId: string;
  readonly capability: CapabilityId;
  /** Разделы опорной базы или иные адреса внутри источника — для провенанса. */
  readonly sections?: readonly string[];
  /** Отключённый источник остаётся объявленным, но не участвует в разрешении. */
  readonly enabled: boolean;
}

export type CapabilityResolution =
  | {
      readonly ok: true;
      readonly bindings: ReadonlyMap<CapabilityId, CapabilityProvider>;
      readonly degradations: readonly Degradation[];
    }
  | { readonly ok: false; readonly blocks: readonly OperationBlock[] };

export class CapabilityRegistry {
  readonly #providers = new Map<CapabilityId, CapabilityProvider[]>();

  declare(provider: CapabilityProvider): void {
    const list = this.#providers.get(provider.capability) ?? [];

    if (list.some((existing) => existing.sourceId === provider.sourceId)) {
      throw new Error(
        `Источник ${provider.sourceId} уже объявлен для способности ${provider.capability}`,
      );
    }

    list.push(provider);
    this.#providers.set(provider.capability, list);
  }

  /** Все включённые поставщики способности; порядок объявления = приоритет. */
  providersOf(capability: CapabilityId): readonly CapabilityProvider[] {
    return (this.#providers.get(capability) ?? []).filter((provider) => provider.enabled);
  }

  /** Первый включённый поставщик или `undefined`. */
  resolveOne(capability: CapabilityId): CapabilityProvider | undefined {
    return this.providersOf(capability)[0];
  }

  /**
   * Разрешает способности операции.
   *
   * Обязательная не разрешена → операция не стартует и называет, чего не хватает.
   * Необязательная не разрешена → операция идёт, деградация записывается в
   * артефакт и становится видимой в результате.
   */
  resolveFor(operation: OperationDefinition): CapabilityResolution {
    const bindings = new Map<CapabilityId, CapabilityProvider>();
    const blocks: OperationBlock[] = [];

    for (const capability of operation.requires) {
      const provider = this.resolveOne(capability);
      if (provider === undefined) {
        blocks.push({ kind: "missing_capability", capability });
      } else {
        bindings.set(capability, provider);
      }
    }

    if (blocks.length > 0) {
      return { ok: false, blocks };
    }

    const degradations: Degradation[] = [];

    for (const capability of operation.optional) {
      const provider = this.resolveOne(capability);
      if (provider === undefined) {
        degradations.push({
          capability,
          reason: `Необязательная способность ${capability} не предоставлена ни одним включённым источником`,
        });
      } else {
        bindings.set(capability, provider);
      }
    }

    return { ok: true, bindings, degradations };
  }
}
