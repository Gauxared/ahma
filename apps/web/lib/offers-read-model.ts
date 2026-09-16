/**
 * Сравнение коммерческих предложений по объекту.
 *
 * ПОЧЕМУ У НЕГО СВОЙ ЭКРАН, А НЕ ВКЛАДКА В ПРОВЕРКЕ
 *
 * Сравнение считается операцией `compare-offers`, и до этого оно показывалось
 * только внутри той Проверки, в которой считалось. Пункт рельса «Сравнение КП»
 * при этом вёл на реестр объектов — одна из пяти ссылок, указывавших на один
 * экран, и самая обидная: расчёт есть, артефакт есть, входа нет.
 *
 * Предмет сравнения — ОБЪЕКТ, а не прогон: сравнивают предложения по стройке, и
 * вопрос «что нам предложили» задают об объекте. Поэтому экран объектный, а
 * прогон, в котором сравнение считалось, показывается как происхождение.
 *
 * ПОЧЕМУ ВСЕ СРАВНЕНИЯ, А НЕ ТОЛЬКО СВЕЖЕЕ
 *
 * Предложения пересчитывают: пришло четвёртое КП — считают заново. Прежний
 * расчёт при этом не перестаёт существовать, и «что мы видели, когда решали» —
 * вопрос, который задают позже. Свежее показывается раскрытым, прежние —
 * перечнем с датами.
 */
import { createPrismaClient, withTenant } from "@platform/db/prisma";

import { viewComparison, type ComparisonView } from "./check-read-model.js";

export interface OfferRun {
  readonly artifactId: string;
  readonly checkId: string | null;
  readonly producedAt: Date;
  readonly completeness: string;
  /**
   * Пометка образца.
   *
   * `variant: "образец"` ставит наполнение демо-контура на артефакт, собранный
   * из ВЫДУМАННЫХ предложений (`tests/fixtures/**`). Экран обязан сказать это
   * вслух: расчёт настоящий, а входы — нет, и на показе вопрос «чьи это КП»
   * задают всегда.
   */
  readonly sample: boolean;
  /** Разбор тела: `null`, если тело не похоже на сравнение. */
  readonly comparison: ComparisonView | null;
}

export interface OffersCard {
  readonly objectCode: string;
  readonly objectName: string;
  readonly runs: readonly OfferRun[];
}

/** Потолок: экран показывает историю расчётов, а не весь архив. */
const LIMIT = 20;

export async function readOffers(tenant: string, objectCode: string): Promise<OffersCard | undefined> {
  const db = createPrismaClient(process.env["DATABASE_URL"]);

  try {
    return await withTenant(db, tenant, async (tx) => {
      const object = await tx.projectObject.findFirst({
        where: { code: objectCode },
        select: { code: true, name: true },
      });

      if (object === null) return undefined;

      // Связь артефакта с объектом идёт ЧЕРЕЗ ПРОВЕРКУ: своего `objectCode` у
      // артефакта в схеме нет. Отбор по вложенному отношению, а не по полю, —
      // это не обход, а то, как связь и устроена.
      const rows = await tx.artifact.findMany({
        where: { operationId: "compare-offers", check: { object: { code: objectCode } } },
        orderBy: { producedAt: "desc" },
        take: LIMIT,
        select: {
          id: true,
          checkId: true,
          producedAt: true,
          completeness: true,
          variant: true,
          body: true,
        },
      });

      return {
        objectCode: object.code,
        objectName: object.name,
        runs: rows.map((row) => ({
          artifactId: row.id,
          checkId: row.checkId,
          producedAt: row.producedAt,
          completeness: row.completeness,
          sample: row.variant === "образец",
          comparison: comparisonOf(row.body),
        })),
      };
    });
  } finally {
    await db.$disconnect();
  }
}

/**
 * Тело артефакта в представление сравнения.
 *
 * `null` означает «тело не похоже на сравнение» — например, формат сменился, а
 * старые артефакты остались. Экран об этом скажет словом: молча пропущенная
 * строка выглядела бы так, будто расчёта не было вовсе.
 */
function comparisonOf(body: unknown): ComparisonView | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  return viewComparison(body as Record<string, unknown>);
}
