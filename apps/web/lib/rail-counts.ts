/**
 * Счётчики для рельса навигации.
 *
 * ПОЧЕМУ ОБОЛОЧКА ЧИТАЕТ ИХ САМА
 *
 * Приём из Pulse: рядом с разделом стоит число, и оно сразу говорит, где работа
 * («Заявки 30», «Очередь 7»). Числа при этом одинаковы на всех экранах —
 * это состояние арендатора, а не содержание страницы.
 *
 * Передавать их пропсом из каждой страницы значило бы, что забывший страницу
 * автор молча получает рельс без чисел, и рельс начинает отличаться от экрана к
 * экрану. Поэтому оболочка запрашивает их сама: один короткий запрос из пяти
 * `count`, все под одним арендатором.
 *
 * НОЛЬ НЕ ПОКАЗЫВАЕТСЯ — правило тоже из Pulse. Ноль создаёт шум и ничего не
 * сообщает; непустое число сообщает.
 */
import { createPrismaClient, withTenant } from "@platform/db/prisma";

export interface RailCounts {
  readonly objects: number;
  readonly documents: number;
  readonly positions: number;
  readonly pending: number;
  readonly checks: number;
}

export async function readRailCounts(tenant: string): Promise<RailCounts> {
  if (tenant === "") {
    throw new Error("Арендатор не задан: счётчики рельса не считаются без контекста доступа.");
  }

  const db = createPrismaClient(process.env["DATABASE_URL"]);

  try {
    return await withTenant(db, tenant, async (tx) => {
      const [objects, documents, positions, pending, checks] = await Promise.all([
        tx.projectObject.count(),
        tx.document.count(),
        tx.position.count(),
        tx.extractionRevision.count({ where: { origin: "правка", confirmedBy: null } }),
        tx.check.count(),
      ]);

      return { objects, documents, positions, pending, checks };
    });
  } finally {
    await db.$disconnect();
  }
}
