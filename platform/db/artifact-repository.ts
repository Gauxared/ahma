/**
 * Хранилище артефактов и следов формул.
 *
 * Все операции принимают транзакцию, полученную через `withTenant`: доступ без
 * контекста арендатора не вернёт ничего, потому что RLS отсекает строки
 * (ADR-R-015). Это второй рубеж после `PolicyDecisionPoint`.
 *
 * Следы формул хранятся отдельной таблицей, а не внутри тела артефакта, потому
 * что §12.1д проверяется по выгрузкам: каждая формульная ячейка Excel обязана
 * иметь сохранённый след, и его нужно уметь найти по артефакту, не разбирая JSON.
 */
import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { decimal, sha256 } from "@contracts/index.js";
import type { Artifact, DecimalString, FormulaTrace, Sha256 } from "@contracts/index.js";

import type { Tx } from "./prisma.js";

/**
 * Приводит доменное значение к обычному JSON для колонки базы.
 *
 * Явная сериализация на границе, а не приведение типа: наши readonly-структуры
 * и брендированные строки — это доменное представление, и протаскивать его
 * в драйвер как есть значит связать схему хранения с формой типов.
 */
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export interface StoredTrace {
  readonly id: string;
  readonly formulaId: string;
  readonly formulaVersion: number;
  readonly inputs: unknown;
  readonly output: DecimalString;
  readonly unit: string | undefined;
  readonly rounding: string;
}

export class ArtifactRepository {
  /**
   * Сохраняет артефакт.
   *
   * `checkId` передаётся отдельно, потому что его нет в контракте артефакта:
   * артефакт — это результат ОПЕРАЦИИ, и он существует независимо от того,
   * запущена операция в составе Проверки или одиночным вызовом (ADR-R-022).
   * Раньше здесь стоял жёсткий `null`, и артефакты Проверки нельзя было найти
   * по ней — экран объекта не мог показать её результат.
   */
  async save(
    tx: Tx,
    artifact: Artifact<unknown>,
    traces: readonly FormulaTrace[],
    checkId?: string,
  ): Promise<void> {
    await tx.artifact.create({
      data: {
        id: artifact.id,
        tenantId: artifact.tenantId,
        checkId: checkId ?? null,
        operationId: artifact.operation.id,
        operationVersion: artifact.operation.version,
        variant: artifact.operation.variant ?? null,
        completeness: artifact.completeness,
        inputHashes: [...artifact.inputHashes],
        degradations: toJson(artifact.degradations),
        body: toJson(artifact.body),
        producedAt: new Date(artifact.producedAt),
      },
    });

    if (traces.length === 0) {
      return;
    }

    await tx.formulaTrace.createMany({
      data: traces.map((trace) => ({
        id: randomUUID(),
        tenantId: artifact.tenantId,
        artifactId: artifact.id,
        formulaId: trace.formulaId,
        formulaVersion: trace.formulaVersion,
        inputs: toJson(trace.inputs),
        output: trace.output,
        unit: (trace.unit as string | undefined) ?? null,
        rounding: trace.rounding as string,
      })),
    });
  }

  async findById(tx: Tx, id: string): Promise<Artifact<unknown> | undefined> {
    const row = await tx.artifact.findFirst({ where: { id } });

    if (row === null) {
      return undefined;
    }

    return {
      id: row.id,
      tenantId: row.tenantId,
      operation: {
        id: row.operationId,
        version: row.operationVersion,
        ...(row.variant === null ? {} : { variant: row.variant }),
      },
      completeness: row.completeness as Artifact["completeness"],
      inputHashes: row.inputHashes.map((hash) => sha256(hash)) as readonly Sha256[],
      degradations: (row.degradations ?? []) as unknown as Artifact["degradations"],
      producedAt: row.producedAt.toISOString() as Artifact["producedAt"],
      body: row.body,
    };
  }

  async tracesOf(tx: Tx, artifactId: string): Promise<readonly StoredTrace[]> {
    const rows = await tx.formulaTrace.findMany({
      where: { artifactId },
      orderBy: { createdAt: "asc" },
    });

    return rows.map((row) => ({
      id: row.id,
      formulaId: row.formulaId,
      formulaVersion: row.formulaVersion,
      inputs: row.inputs,
      // Prisma отдаёт Decimal объектом; приводим к строке с копейками, чтобы
      // наружу не утекало представление драйвера.
      output: decimal(typeof row.output === "string" ? row.output : row.output.toFixed(2)),
      unit: row.unit ?? undefined,
      rounding: row.rounding,
    }));
  }
}
