/**
 * Read-модель веб-просмотра — роадмап M6.
 *
 * Дословно роадмап: «Тонкий read-only веб-просмотр артефактов стоит сделать
 * раньше, сразу после M3 — он дёшев на канонических артефактах и закрывает
 * потребность в демо».
 *
 * ТОЛЬКО ЧТЕНИЕ, И ЭТО НЕ ВРЕМЕННОЕ ОГРАНИЧЕНИЕ
 *
 * Запись из веба потребовала бы сессий, CSRF и разграничения ролей — работы
 * M6 целиком. Просмотр же нужен сейчас, и он не становится хуже оттого, что
 * ничего не меняет. Опасно другое: интерфейс, ВЫГЛЯДЯЩИЙ пишущим и молча
 * ничего не сохраняющий. Поэтому кнопок здесь нет вовсе.
 *
 * ИЗОЛЯЦИЯ АРЕНДАТОРА ИДЁТ ЧЕРЕЗ RLS, А НЕ ЧЕРЕЗ WHERE
 *
 * Доступ к данным идёт `withTenant`, как и в командной строке. Приписать
 * `where: { tenantId }` в веб-запросе было бы третьим способом делать то же
 * самое — и первым, который однажды забудут написать.
 */
// Импорт БЕЗ расширения `.js`, в отличие от остального репозитория.
//
// Сборщик Next не переписывает `.js` в `.ts` для путей за пределами приложения,
// а `moduleResolution: "Bundler"` расширение и не требует. Разнобой оставлен
// осознанно и здесь объяснён: альтернатива — копия платформенного модуля внутрь
// веба, то есть второй источник истины ради единообразия импортов.
import { createPrismaClient, withTenant } from "@platform/db/prisma";

export interface ObjectRow {
  readonly code: string;
  readonly name: string;
  readonly region: string | null;
  readonly checksTotal: number;
  readonly lastCheckAt: Date | null;
  readonly lastStatus: string | null;
}

export interface JobRow {
  /** Нужен, чтобы задачу можно было отменить: отменяют конкретную, а не «последнюю». */
  readonly id: string;
  readonly status: string;
  readonly attempts: number;
  readonly lastError: string | null;
}

export interface CheckRow {
  readonly id: string;
  readonly workflowId: string;
  readonly mode: string;
  readonly status: string;
  readonly completeness: string;
  readonly createdAt: Date;
  readonly finishedAt: Date | null;
  readonly artifactsTotal: number;
  /**
   * Состояние задачи в очереди. Проверка без задачи ещё не поставлена.
   *
   * На экране показывается ОНО, а не `status` самой проверки: два состояния
   * одной вещи, стоящие рядом, спорят друг с другом. Состояние задачи точнее
   * отвечает на вопрос пользователя «идёт ли расчёт».
   */
  readonly job: JobRow | null;
  /** Вердикт из артефакта, если проверка завершилась. */
  readonly verdict: string | null;
  readonly summary: string | null;
}

export interface ObjectCard {
  readonly code: string;
  readonly name: string;
  readonly region: string | null;
  readonly documents: readonly { readonly name: string; readonly kind: string }[];
  readonly checks: readonly CheckRow[];
}

export class NoTenantConfigured extends Error {
  constructor() {
    super("Арендатор не задан: просмотр не показывает данные без контекста доступа.");
    this.name = "NoTenantConfigured";
  }
}

/**
 * Чтение идёт ПОД ЯВНО ПЕРЕДАННЫМ арендатором.
 *
 * Раньше он брался из `STROYINTELLECT_TENANT_ID` — заглушка, которая годилась,
 * пока веб никого не различал. Теперь личность приходит из сессии, и читать
 * окружение значило бы выдать всем одного арендатора при живом входе: хуже
 * прежней заглушки, потому что теперь это выглядело бы разграничением.
 *
 * Аргумент, а не глобальное состояние: два запроса разных арендаторов идут
 * одновременно, и общая переменная перепутала бы их.
 */
export async function listObjects(tenant: string): Promise<readonly ObjectRow[]> {
  if (tenant === "") throw new NoTenantConfigured();

  const db = createPrismaClient(process.env["DATABASE_URL"]);

  try {
    return await withTenant(db, tenant, async (tx) => {
      const objects = await tx.projectObject.findMany({
        orderBy: { updatedAt: "desc" },
        include: {
          checks: { orderBy: { createdAt: "desc" }, take: 1 },
          _count: { select: { checks: true } },
        },
      });

      return objects.map((object) => ({
        code: object.code,
        name: object.name,
        region: object.region,
        checksTotal: object._count.checks,
        lastCheckAt: object.checks[0]?.createdAt ?? null,
        lastStatus: object.checks[0]?.status ?? null,
      }));
    });
  } finally {
    await db.$disconnect();
  }
}

export async function readObject(tenant: string, code: string): Promise<ObjectCard | undefined> {
  if (tenant === "") throw new NoTenantConfigured();

  const db = createPrismaClient(process.env["DATABASE_URL"]);

  try {
    return await withTenant(db, tenant, async (tx) => {
      const object = await tx.projectObject.findFirst({
        where: { code },
        include: {
          documents: { orderBy: { createdAt: "desc" } },
          checks: {
            orderBy: { createdAt: "desc" },
            include: {
              _count: { select: { artifacts: true } },
              jobs: { orderBy: { createdAt: "desc" }, take: 1 },
              artifacts: { orderBy: { producedAt: "desc" }, take: 1 },
            },
          },
        },
      });

      if (object === null) return undefined;

      return {
        code: object.code,
        name: object.name,
        region: object.region,
        documents: object.documents.map((document) => ({
          name: document.fileName,
          kind: document.kind,
        })),
        checks: object.checks.map((check) => {
          const job = check.jobs[0];
          // Тело артефакта — результат проверки; берётся только вердикт и
          // сводка, а не весь документ: карточке объекта нужен исход, а не
          // выгрузка.
          const body = check.artifacts[0]?.body as
            | { verdict?: string; totals?: { checked?: number; positions?: number } }
            | undefined;

          return {
            id: check.id,
            workflowId: check.workflowId,
            mode: String(check.mode),
            status: String(check.status),
            completeness: check.completeness,
            createdAt: check.createdAt,
            finishedAt: check.finishedAt,
            artifactsTotal: check._count.artifacts,
            job:
              job === undefined
                ? null
                : {
                    id: job.id,
                    status: String(job.status),
                    attempts: job.attempts,
                    lastError:
                      job.lastError === null
                        ? null
                        : String((job.lastError as { message?: string }).message ?? ""),
                  },
            verdict: body?.verdict ?? null,
            summary:
              body?.totals === undefined
                ? null
                // ноль-осознанно: счётчики на экране; «смет 0» — это факт обхода.
                : `смет ${body.totals.checked ?? 0}, позиций ${body.totals.positions ?? 0}`,
          };
        }),
      };
    });
  } finally {
    await db.$disconnect();
  }
}
