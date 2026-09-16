/**
 * Исполнитель операций (ADR-R-022).
 *
 * Четыре точки входа — полная Проверка, подграф воркфлоу, одиночный вызов и
 * обслуживание — ведут в ОДИН и тот же исполнитель. Это не удобство, а инвариант:
 * иначе появляются две истины, одна из Проверки и другая из отдельного вызова.
 *
 * Два запрета, которые чаще всего нарушают при частичном исполнении:
 *  1. пропуск предусловий — «посчитать финмодель отдельно» без подтверждённого ВОР
 *     даёт число, которое выглядит настоящим (реальный кейс Кургана: ВОР возвращён
 *     на пересчёт, Ванычу адресовано «БЕЗ моего "ОК по ВОР" финмодель НЕ считать»);
 *  2. подмена класса полноты — частичный прогон, предъявленный как результат
 *     Проверки со сводным выводом §5.3.
 */
import { randomUUID } from "node:crypto";

import type {
  Artifact,
  Completeness,
  Degradation,
  GateSubject,
  OperationBlock,
  OperationDefinition,
  OperationOutcome,
  Sha256,
} from "@contracts/index.js";

import type { CapabilityProvider, CapabilityRegistry } from "../extensions/capabilities.js";

/** Точка входа. Влияет на класс полноты, но не на содержание артефакта. */
export type EntryPoint = "check" | "subgraph" | "single" | "maintenance";

const COMPLETENESS_BY_ENTRY: Readonly<Record<EntryPoint, Completeness>> = {
  check: "full",
  subgraph: "partial",
  single: "single",
  maintenance: "single",
};

export interface OperationContext {
  readonly tenantId: string;
  readonly entryPoint: EntryPoint;
  /** Состояние общих предметов, на которых стоят гейты (ADR-R-003). */
  readonly subjects: ReadonlyMap<string, GateSubject>;
  readonly bindings: ReadonlyMap<string, CapabilityProvider>;
  readonly now: string;
}

export type OperationBody<TInput, TBody> = (
  input: TInput,
  context: OperationContext,
) => Promise<{ body: TBody; inputHashes: readonly Sha256[] }>;

export interface OperationRegistration<TInput = unknown, TBody = unknown> {
  readonly definition: OperationDefinition;
  readonly run: OperationBody<TInput, TBody>;
}

/**
 * Предусловие записывается как `предмет:статус`, например `vor:approved`.
 * Допустимо перечисление через `|`: `estimate:draft|approved`.
 *
 * Перечисление появилось из реальной потребности: сходимость сметы — проверка
 * механическая, она идёт и по разобранному черновику, и по подтверждённой
 * смете, но НЕ по возвращённой на пересчёт, потому что там данные устарели.
 *
 * Разбор намеренно строгий: непонятное предусловие — ошибка конфигурации,
 * а не повод его пропустить.
 */
function parsePrecondition(precondition: string): { subject: string; statuses: readonly string[] } {
  const [subject, alternatives] = precondition.split(":");

  if (subject === undefined || alternatives === undefined || subject === "") {
    throw new Error(
      `Некорректное предусловие: ${JSON.stringify(precondition)}. Ожидается "предмет:статус" или "предмет:статус|статус".`,
    );
  }

  const statuses = alternatives.split("|");

  if (statuses.length === 0 || statuses.some((status) => status === "")) {
    throw new Error(
      `Некорректное предусловие: ${JSON.stringify(precondition)}. Пустой статус в перечислении.`,
    );
  }

  return { subject, statuses };
}

export class OperationRunner {
  readonly #operations = new Map<string, OperationRegistration>();

  constructor(private readonly capabilities: CapabilityRegistry) {}

  register<TInput, TBody>(registration: OperationRegistration<TInput, TBody>): void {
    const { id } = registration.definition;

    if (this.#operations.has(id)) {
      throw new Error(`Операция ${id} уже зарегистрирована`);
    }

    for (const precondition of registration.definition.preconditions) {
      parsePrecondition(precondition);
    }

    this.#operations.set(id, registration as OperationRegistration);
  }

  definition(id: string): OperationDefinition | undefined {
    return this.#operations.get(id)?.definition;
  }

  ids(): readonly string[] {
    return [...this.#operations.keys()];
  }

  /**
   * Проверяет, может ли операция стартовать. Вызывается ОДИНАКОВО из всех точек
   * входа, поэтому одиночный вызов не обходит гейты полной Проверки.
   */
  checkStartable(
    id: string,
    subjects: ReadonlyMap<string, GateSubject>,
  ): { readonly blocks: readonly OperationBlock[]; readonly degradations: readonly Degradation[] } {
    const registration = this.#operations.get(id);

    if (registration === undefined) {
      throw new Error(`Операция ${id} не зарегистрирована`);
    }

    const blocks: OperationBlock[] = [];

    for (const precondition of registration.definition.preconditions) {
      const { subject, statuses } = parsePrecondition(precondition);
      const actual = subjects.get(subject);

      if (actual === undefined) {
        blocks.push({ kind: "precondition", precondition, actual: "предмет отсутствует" });
      } else if (!statuses.includes(actual.status)) {
        blocks.push({ kind: "precondition", precondition, actual: actual.status });
      }
    }

    const resolution = this.capabilities.resolveFor(registration.definition);

    if (!resolution.ok) {
      return { blocks: [...blocks, ...resolution.blocks], degradations: [] };
    }

    return { blocks, degradations: resolution.degradations };
  }

  async run<TInput, TBody>(
    id: string,
    input: TInput,
    context: Omit<OperationContext, "bindings">,
  ): Promise<OperationOutcome<TBody>> {
    const registration = this.#operations.get(id) as OperationRegistration<TInput, TBody> | undefined;

    if (registration === undefined) {
      throw new Error(`Операция ${id} не зарегистрирована`);
    }

    const { blocks, degradations } = this.checkStartable(id, context.subjects);

    if (blocks.length > 0) {
      return { ok: false, blocks };
    }

    const resolution = this.capabilities.resolveFor(registration.definition);
    const bindings = resolution.ok ? resolution.bindings : new Map<string, CapabilityProvider>();

    const { body, inputHashes } = await registration.run(input, { ...context, bindings });

    const artifact: Artifact<TBody> = {
      id: randomUUID(),
      tenantId: context.tenantId,
      operation: { id: registration.definition.id, version: registration.definition.version },
      completeness: COMPLETENESS_BY_ENTRY[context.entryPoint],
      inputHashes,
      degradations,
      producedAt: context.now as Artifact["producedAt"],
      body,
    };

    return { ok: true, artifact };
  }
}
