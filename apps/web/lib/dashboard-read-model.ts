/**
 * Пульт — первый экран продукта.
 *
 * ЧТО ЭТО ЗАМЕНЯЕТ
 *
 * До этого главная была ОГЛАВЛЕНИЕМ: двадцать шесть строк о том, какие экраны
 * есть, а каких нет. Перечень честный и на своём месте нужный, но как первый
 * экран он рассказывал про систему, а не про объект — открыв продукт,
 * пользователь первым делом читал, чего в нём не сделано.
 *
 * Прототипы заказчика решают это одинаково, и оба начинают с ЧИСЕЛ: «Пульт»
 * несёт вердикт, пять показателей и карточки рисков в рублях; «Начальная
 * страница» — портфель с бюджетами и «мои задачи, требуют реакции» с суммами.
 * Перечень возможностей у них не на первом экране вовсе.
 *
 * У нас на первом экране есть чем его наполнить: вердикт последнего прогона,
 * четыре договорных гейта с объяснением, счётчики разбора, замечания сметчика по
 * важности, позиции без шифра нормы и правки, ждущие подписи.
 *
 * ЧИСЛА ЗДЕСЬ — СЧЁТЧИКИ, И ОНИ ЭТОГО НЕ СКРЫВАЮТ
 *
 * Ни одно из них не расчёт: это то, что посчитал обход, и происхождение у них
 * одно — артефакт Проверки. Оборачивать их в `Valued` с выдуманным `SourceRef`
 * значило бы приделать провенанс к счётчику; вместо этого экран называет
 * артефакт ссылкой и говорит прямо, что следа формулы у счётчика нет.
 */
import { createPrismaClient, withTenant } from "@platform/db/prisma";

export interface GateView {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
  readonly passed: boolean;
}

export interface DocumentBreakdown {
  readonly fileName: string;
  readonly kind: string;
  readonly versionId: string;
  readonly positions: number;
  /** Позиций без шифра нормы в этом документе: где именно разбор недоработал. */
  readonly unmatched: number;
}

/**
 * Замечание сметчика — то, ради чего Проверка и запускается.
 *
 * У прототипа заказчика центральный блок «Пульта» — не счётчики, а список
 * конкретных рисков: агент, линза, эффект, действие. Счётчик «96 замечаний»
 * говорит, что работа сделана; список говорит, ЧТО именно найдено.
 */
export interface FindingView {
  readonly severity: string;
  readonly statement: string;
  readonly basis: string;
  /** Имя файла без пути: полный путь в строке списка не помещается. */
  readonly document: string;
}

/**
 * Обзор, который не состоялся.
 *
 * Отдельно от находок: «замечаний нет» и «обзор не выполнен» — разные
 * утверждения, и второе нельзя показывать первым. Первое означает, что смета
 * чиста; второе — что о ней ничего не известно.
 */
export interface ReviewFailure {
  readonly reason: string;
  /** Какие документы задело. Сгруппировано ПО ПРИЧИНЕ, а не по документу. */
  readonly documents: readonly string[];
}

/** Такт конвейера: кто отработал на этой ступени. Ритм из макетов заказчика. */
export interface StageView {
  readonly stage: string;
  readonly agents: readonly { readonly agent: string; readonly status: string }[];
}

/** Замечания сметчика по важности, в порядке убывания веса. */
export interface SeverityRow {
  readonly severity: string;
  readonly count: number;
}

export interface Dashboard {
  readonly objects: number;
  /** Объекты арендатора для переключателя Пульта: шифр и название. */
  readonly objectList: readonly { readonly code: string; readonly name: string }[];
  readonly checksTotal: number;
  /** Живой объект: пока их один, но экран не полагается на это. */
  readonly objectCode: string | null;
  readonly objectName: string | null;

  /** Последний завершённый прогон — на нём стоит весь экран. */
  readonly lastCheck:
    | {
        readonly id: string;
        readonly artifactId: string;
        readonly operationId: string;
        readonly operationVersion: number;
        readonly completeness: string;
        readonly producedAt: Date;
        readonly verdict: string | null;
        readonly totals: readonly (readonly [string, number])[];
        readonly gates: readonly GateView[];
        readonly findings: number;
        readonly bySeverity: readonly SeverityRow[];
        readonly degradations: readonly { readonly capability: string; readonly reason: string }[];
        readonly topFindings: readonly FindingView[];
        readonly reviewFailures: readonly ReviewFailure[];
      }
    | undefined;

  /** Разбор: документы с версиями и позициями. */
  readonly documents: readonly DocumentBreakdown[];
  readonly positions: number;
  readonly unmatched: number;
  /** Правки, ждущие подписи: §12 блокирует сильный вердикт до них. */
  readonly pendingSignatures: number;
  /** Задачи в очереди, которые ещё не завершились. */
  readonly liveJobs: number;
  readonly auditEvents: number;
  /** Такты последнего прогона — по возрастанию, как их проходил конвейер. */
  readonly stages: readonly StageView[];
}

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"] as const;

/** Числа `totals` в порядке чтения — от общего к частному, а не по ключам JSON. */
const TOTALS_ORDER = [
  "documents",
  "checked",
  "skipped",
  "failed",
  "positions",
  // Позиции ролей — рядом с разобранными, а не вместо: у них разный уровень
  // доверия, и одно число скрыло бы, что половину назвала модель.
  "agentPositions",
  "byCode",
  "unmatched",
] as const;

function readTotals(body: unknown): readonly (readonly [string, number])[] {
  const totals = (body as { totals?: Record<string, unknown> } | null)?.totals;
  if (totals === undefined || totals === null) return [];

  return TOTALS_ORDER.flatMap((key) => {
    const value = totals[key];
    return typeof value === "number" ? [[key, value] as const] : [];
  });
}

function readGates(body: unknown): readonly GateView[] {
  const gates = (body as { gates?: unknown } | null)?.gates;
  if (!Array.isArray(gates)) return [];

  return gates.flatMap((gate) => {
    const row = gate as { id?: unknown; name?: unknown; detail?: unknown; passed?: unknown };
    return typeof row.id === "string" && typeof row.name === "string"
      ? [
          {
            id: row.id,
            name: row.name,
            detail: typeof row.detail === "string" ? row.detail : "",
            passed: row.passed === true,
          },
        ]
      : [];
  });
}

function readSeverity(body: unknown): { readonly findings: number; readonly bySeverity: readonly SeverityRow[] } {
  const review = (body as { review?: { findings?: unknown; bySeverity?: unknown } } | null)?.review;
  if (review === undefined || review === null) return { findings: 0, bySeverity: [] };

  const map = review.bySeverity as Record<string, unknown> | undefined;
  const rows =
    map === undefined
      ? []
      : SEVERITY_ORDER.flatMap((severity) => {
          const value = map[severity];
          return typeof value === "number" && value > 0 ? [{ severity, count: value }] : [];
        });

  return { findings: typeof review.findings === "number" ? review.findings : 0, bySeverity: rows };
}

/** Имя файла без пути: полный путь в строке списка не помещается. */
function baseName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

const SEVERITY_WEIGHT: Readonly<Record<string, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/**
 * Находки и сорванные обзоры из тела артефакта.
 *
 * Читается защитно, как и всё остальное: тело приходит из JSON, то есть
 * `unknown`, и приводить его типом нельзя — артефакт мог быть записан прошлой
 * версией операции.
 *
 * Находки сортируются по важности и обрезаются: на первом экране нужны те, с
 * которых начинают, а не все девяносто шесть.
 */
function readFindings(
  body: unknown,
  limit: number,
): { readonly top: readonly FindingView[]; readonly failures: readonly ReviewFailure[] } {
  const documents = (body as { review?: { documents?: unknown } } | null)?.review?.documents;
  if (!Array.isArray(documents)) return { top: [], failures: [] };

  const top: FindingView[] = [];
  const grouped = new Map<string, string[]>();

  for (const entry of documents) {
    const document = entry as { path?: unknown; error?: unknown; findings?: unknown };
    const name = typeof document.path === "string" ? baseName(document.path) : "документ не назван";

    if (typeof document.error === "string" && document.error !== "") {
      // Группировка ПО ПРИЧИНЕ, а не по документу. В `review.documents` один
      // файл встречается по разу на агента, и при отказе endpoint'а список
      // превращался в семь копий одной ошибки: экран сообщал одно и то же
      // семь раз, а сказать надо было «endpoint недоступен, задело всё».
      const bucket = grouped.get(document.error);
      if (bucket === undefined) grouped.set(document.error, [name]);
      else if (!bucket.includes(name)) bucket.push(name);
    }

    if (!Array.isArray(document.findings)) continue;

    for (const raw of document.findings) {
      const finding = raw as { severity?: unknown; statement?: unknown; basis?: unknown };
      if (typeof finding.statement !== "string") continue;

      top.push({
        severity: typeof finding.severity === "string" ? finding.severity : "info",
        statement: finding.statement,
        basis: typeof finding.basis === "string" ? finding.basis : "",
        document: name,
      });
    }
  }

  const sorted = [...top].sort(
    (left, right) => (SEVERITY_WEIGHT[left.severity] ?? 9) - (SEVERITY_WEIGHT[right.severity] ?? 9),
  );

  return {
    top: sorted.slice(0, limit),
    failures: [...grouped.entries()].map(([reason, documents]) => ({ reason, documents })),
  };
}

function readDegradations(value: unknown): readonly { readonly capability: string; readonly reason: string }[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    const row = entry as { capability?: unknown; reason?: unknown };
    return typeof row.capability === "string" && typeof row.reason === "string"
      ? [{ capability: row.capability, reason: row.reason }]
      : [];
  });
}

/**
 * ПУЛЬТ ПОКАЗЫВАЕТ ВЫБРАННЫЙ ОБЪЕКТ, А НЕ ЕДИНСТВЕННЫЙ.
 *
 * ЧТО БЫЛО. Объект вычислялся из САМОГО СВЕЖЕГО артефакта обхода — и другого
 * способа его сменить не существовало. На одном объекте это выглядело
 * правильным, на нескольких Пульт показывал один и тот же, какой бы объект
 * человек ни открывал. Владелец так и сказал 09.09.2026: «какой бы я ни
 * выбрал — показывается один определённый».
 *
 * Связь «объект вычисляется из артефакта» была заведена не зря: она чинила
 * прежнюю беду, когда шифр одного объекта стоял над вердиктом другого. Поэтому
 * выбор не отменяет её, а сужает поиск артефакта: назван объект — берём
 * последний артефакт ЭТОГО объекта, не назван — последний вообще.
 */
export async function readDashboard(tenant: string, objectCode?: string): Promise<Dashboard> {
  if (tenant === "") {
    throw new Error("Арендатор не задан: пульт не показывает данные без контекста доступа.");
  }

  const db = createPrismaClient(process.env["DATABASE_URL"]);

  try {
    return await withTenant(db, tenant, async (tx) => {
      const [objects, checksTotal, auditEvents, liveJobs, pendingSignatures] = await Promise.all([
        tx.projectObject.count(),
        tx.check.count(),
        tx.auditEvent.count(),
        tx.job.count({ where: { status: { in: ["queued", "running"] } } }),
        tx.extractionRevision.count({ where: { origin: "правка", confirmedBy: null } }),
      ]);

      /**
       * Выбранный объект ищется по шифру ДО артефакта: без него нечем сузить
       * поиск, а сузить надо именно артефакт — он остаётся источником вердикта.
       */
      const выбранный =
        objectCode === undefined || objectCode === ""
          ? null
          : await tx.projectObject.findFirst({
              where: { code: objectCode },
              select: { id: true, code: true, name: true },
              orderBy: { createdAt: "desc" },
            });

      // Последний артефакт обхода, а не последняя Проверка: Проверка может быть
      // отменена или ждать человека, и тогда показывать по ней нечего.
      const свежий = await tx.artifact.findFirst({
        where:
          выбранный === null
            ? { operationId: "check-object" }
            : { operationId: "check-object", check: { objectId: выбранный.id } },
        orderBy: { producedAt: "desc" },
      });

      /**
       * ОБЪЕКТ БЕРЁТСЯ У ПОКАЗАННОГО ПРОГОНА, А НЕ ВЫБИРАЕТСЯ ОТДЕЛЬНО.
       *
       * Здесь стояло `projectObject.findFirst({ orderBy: { createdAt: "asc" } })`
       * — САМЫЙ СТАРЫЙ объект, — рядом с САМЫМ СВЕЖИМ артефактом, и связи между
       * ними не было никакой. Пульт складывал из них ссылку
       * `/objects/<шифр старого>/checks/<id чужого прогона>`.
       *
       * Пока объект был один, совпадение держалось само собой. На втором
       * объекте гейт «каждое решение ведёт на существующий экран» дал 404 — и
       * это ещё мягкий исход. Хуже другой: шифр одного объекта над вердиктом
       * другого читается как вердикт по названному объекту.
       *
       * Теперь рассогласоваться нечему: объект вычисляется ИЗ артефакта.
       * Запасной путь — самый старый объект — остаётся только для пустого
       * Пульта, где вердикта нет и складывать не из чего.
       */
      const прогон =
        свежий?.checkId == null
          ? null
          : await tx.check.findFirst({
              where: { id: свежий.checkId },
              select: { object: { select: { id: true, code: true, name: true } } },
            });

      /**
       * Вердикт, который не к чему отнести, НЕ ПОКАЗЫВАЕТСЯ.
       *
       * Если артефакт есть, а его объект не находится (Проверка удалена,
       * `checkId` пуст), показать вердикт всё равно значило бы поставить его
       * под шифром постороннего объекта — той же ошибкой, которую эта правка
       * закрывает, только с другого конца. Пустой Пульт честнее.
       */
      const artifact = прогон === null ? null : свежий;

      /**
       * ВЫБРАННЫЙ ОБЪЕКТ ГЛАВНЕЕ АРТЕФАКТА.
       *
       * Если человек открыл объект, по которому прогонов ещё не было, Пульт
       * обязан показать ЕГО — пустым, с его документами и позициями, — а не
       * подставить чужой объект с чужим вердиктом. Подстановка была бы ровно
       * той ошибкой, ради которой объект и вычисляется из артефакта.
       */
      const object =
        выбранный ??
        прогон?.object ??
        (await tx.projectObject.findFirst({
          orderBy: { createdAt: "asc" },
          select: { id: true, code: true, name: true },
        }));

      /**
       * ДОКУМЕНТЫ И ПОЗИЦИИ — ТОГО ЖЕ ОБЪЕКТА, ЧЕЙ ВЕРДИКТ ПОКАЗАН.
       *
       * Они брались по ВСЕМУ арендатору, а на экране подписаны шифром одного
       * объекта: каждая ссылка списка строится как
       * `/objects/<шифр показанного>/documents/<версия чужого документа>`, и
       * плитки «Позиций извлечено» и «Документов разобрано» ведут туда же.
       *
       * На одном объекте это совпадало. На двух гейт «каждое решение ведёт на
       * существующий экран» дал 404 — и это опять мягкий исход. Хуже то, что
       * плитка показывала бы СУММУ ПО АРЕНДАТОРУ под именем одного объекта:
       * «позиций 152» там, где у объекта 98.
       */
      const objectId = object?.id;

      const documents = await tx.document.findMany({
        where: objectId === undefined ? {} : { objectId },
        orderBy: { createdAt: "asc" },
        include: {
          versions: {
            orderBy: { revision: "desc" },
            take: 1,
            include: {
              _count: { select: { positions: true } },
              // Шифры нужны, чтобы посчитать несопоставленные ПО ДОКУМЕНТУ:
              // общее число говорит «где-то три», а строка списка — «вот где».
              positions: { select: { basis: true } },
            },
          },
        },
      });

      // Того же объекта, что и список выше: плитка «Позиций извлечено» ведёт в
      // его документы, и сумма по арендатору под его именем была бы неправдой.
      const принадлежат =
        objectId === undefined ? {} : { version: { document: { objectId } } };

      const [positions, unmatched] = await Promise.all([
        tx.position.count({ where: принадлежат }),
        tx.position.count({ where: { ...принадлежат, basis: "" } }),
      ]);

      const severity = artifact === null ? { findings: 0, bySeverity: [] } : readSeverity(artifact.body);
      const review = artifact === null ? { top: [], failures: [] } : readFindings(artifact.body, 6);

      // Такты берутся у ТОЙ Проверки, чей артефакт показан: шаги других
      // прогонов рядом с его вердиктом читались бы как его собственные.
      const steps =
        artifact?.checkId === null || artifact === null
          ? []
          : await tx.checkStep.findMany({
              where: { checkId: artifact.checkId },
              orderBy: [{ stage: "asc" }, { doneAt: "asc" }],
              select: { stage: true, agent: true, status: true },
            });

      const stages = new Map<string, { agent: string; status: string }[]>();
      for (const step of steps) {
        const bucket = stages.get(step.stage);
        if (bucket === undefined) stages.set(step.stage, [{ agent: step.agent, status: step.status }]);
        else bucket.push({ agent: step.agent, status: step.status });
      }

      /**
       * Перечень объектов — для переключателя: без него выбирать не из чего, а
       * сам выбор человек делает на экране, а не правкой адреса.
       */
      const objectList = await tx.projectObject.findMany({
        orderBy: { createdAt: "desc" },
        select: { code: true, name: true },
        take: 50,
      });

      return {
        objects,
        objectList,
        checksTotal,
        objectCode: object?.code ?? null,
        objectName: object?.name ?? null,
        lastCheck:
          artifact === null
            ? undefined
            : {
                id: artifact.checkId ?? "",
                artifactId: artifact.id,
                operationId: artifact.operationId,
                operationVersion: artifact.operationVersion,
                completeness: artifact.completeness,
                producedAt: artifact.producedAt,
                verdict: (artifact.body as { verdict?: string } | null)?.verdict ?? null,
                totals: readTotals(artifact.body),
                gates: readGates(artifact.body),
                findings: severity.findings,
                bySeverity: severity.bySeverity,
                degradations: readDegradations(artifact.degradations),
                topFindings: review.top,
                reviewFailures: review.failures,
              },
        documents: documents.flatMap((document) => {
          const version = document.versions[0];
          return version === undefined
            ? []
            : [
                {
                  fileName: document.fileName,
                  kind: document.kind,
                  versionId: version.id,
                  positions: version._count.positions,
                  unmatched: version.positions.filter((position) => position.basis.trim() === "").length,
                },
              ];
        }),
        positions,
        unmatched,
        pendingSignatures,
        liveJobs,
        auditEvents,
        stages: [...stages.entries()].map(([stage, agents]) => ({ stage, agents })),
      };
    });
  } finally {
    await db.$disconnect();
  }
}
