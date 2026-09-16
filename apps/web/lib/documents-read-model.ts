/**
 * Read-модель экрана §5.5 (3) «Загрузка и разбор документов» — поверхность `S-03`.
 *
 * ЧТО ЭТО СТАЛО ВОЗМОЖНЫМ ПОКАЗАТЬ
 *
 * До О-72 позиции сметы жили только внутри артефакта Проверки, и то счётчиками:
 * «позиций 101, по шифру 98». Таблицу строк построить было не из чего — считать
 * нечего, кроме итога, — и трек держал `S-03` заблокированным ядром.
 *
 * Теперь есть `document`, `document_version` и `position`, а у каждой позиции —
 * СТРОКА ИСХОДНОГО ЛИСТА. Это единственное место в системе, где происхождение
 * числа не приходится выводить: `Position.sourceRow` его несёт, и раскрытие
 * провенанса здесь честное, а не приделанное.
 *
 * ВЕРСИЯ, А НЕ ДОКУМЕНТ
 *
 * Позиции принадлежат версии. Экран так и устроен: список документов с их
 * версиями, и таблица позиций — у версии. Показать «позиции документа» значило
 * бы склеить два разбора одного файла в один список и потерять то, ради чего
 * версии неизменны (§12).
 *
 * ИЗОЛЯЦИЯ АРЕНДАТОРА ИДЁТ ЧЕРЕЗ RLS, А НЕ ЧЕРЕЗ WHERE
 *
 * Как и в остальном вебе: `withTenant`, а не `where: { tenantId }`. Приписка в
 * запросе была бы третьим способом делать то же самое — и первым, который
 * однажды забудут написать.
 */
import { positionSubject } from "@platform/db/extraction-repository";
import { createPrismaClient, withTenant } from "@platform/db/prisma";

/** Версия документа: неизменный разбор одного содержимого. */
export interface VersionRow {
  readonly id: string;
  readonly revision: number;
  /** Полный хэш; экран показывает отпечаток, но сверять надо по полному. */
  readonly contentHash: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly storagePath: string;
  /** parsed | imported | confirmed_by_human | ocr_unconfirmed (ADR-R-019). */
  readonly acquisition: string;
  readonly createdAt: Date;
  readonly positions: number;
}

export interface DocumentRow {
  readonly id: string;
  readonly kind: string;
  readonly fileName: string;
  readonly createdAt: Date;
  readonly versions: readonly VersionRow[];
}

export interface DocumentsCard {
  readonly objectCode: string;
  readonly objectName: string;
  readonly documents: readonly DocumentRow[];
}

/**
 * Позиция сметы в том виде, в котором её показывает экран.
 *
 * Числа остаются СТРОКАМИ. В базе они десятичные строки, потому что рубли не
 * переживают двоичного округления; приводить их к `number` по дороге к экрану
 * значило бы завести то самое округление, от которого их и уберегли.
 */
/** Поля позиции, которые экран разрешает править. */
export type RevisableField = "количество" | "сумма";

/**
 * Ревизия извлечённого значения в том виде, в котором её показывает экран.
 *
 * `contentHash` доезжает до разметки ЦЕЛИКОМ и не для красоты: он уходит в форму
 * подтверждения, и ядро сверяет с ним состояние базы. Подтверждают то, что
 * видно, а не то, что лежит в базе на момент нажатия (§12).
 */
export interface RevisionView {
  readonly id: string;
  readonly field: RevisableField;
  readonly value: string;
  /** разбор | правка */
  readonly origin: string;
  readonly contentHash: string;
  readonly author: string | null;
  readonly reason: string | null;
  readonly confirmedBy: string | null;
  readonly confirmedAt: Date | null;
  readonly createdAt: Date;
}

export interface PositionView {
  readonly id: string;
  readonly ordinal: string;
  readonly section: string;
  readonly sourceName: string;
  /** Шифр нормы. Пусто, если позиция не сопоставлена — и это показывается. */
  readonly basis: string;
  readonly unit: string;
  readonly quantity: string | null;
  /** NULL — суммы в смете НЕТ (нет стоимостной части), а не «ноль рублей». */
  readonly amount: string | null;
  readonly sourceRow: number;
  /** Лист книги; пусто у формы 421/пр — там он один. */
  readonly sheet: string | null;
  /**
   * КАК ПОЛУЧЕНА ПОЗИЦИЯ (Т11) — `parsed` либо `agent_normalized`.
   *
   * Едет до экрана, потому что «разобрано из файла» и «структуру распознала
   * роль» — разные основания, и показать их одинаково значило бы обесценить
   * первое.
   */
  readonly acquisition: string;
  /** Цепочка ревизий предмета: разбор, затем правки. Пусто, если не правили. */
  readonly revisions: readonly RevisionView[];
}

export interface VersionCard {
  readonly objectCode: string;
  readonly objectName: string;
  readonly documentId: string;
  readonly fileName: string;
  readonly kind: string;
  readonly version: VersionRow;
  /** Прочие версии того же документа: между разборами надо уметь переходить. */
  readonly siblings: readonly { readonly id: string; readonly revision: number }[];
  readonly positions: readonly PositionView[];
  /** Сколько позиций без шифра нормы: главный вопрос к разбору. */
  readonly unmatched: number;
  /** Разделы в порядке появления — для сводки над таблицей. */
  readonly sections: readonly (readonly [string, number])[];
  /** Сколько правок ждёт подписи человека: §12 блокирует сильный вердикт до них. */
  readonly awaitingConfirmation: number;
}

/**
 * Отпечаток содержимого → версия документа. Переход к строке (вехи Д3, Т6.4).
 *
 * ПОЧЕМУ ПО ОТПЕЧАТКУ, А НЕ ПО ИМЕНИ ФАЙЛА
 *
 * Здесь стояло «имя файла → САМАЯ СВЕЖАЯ ревизия», и это был тихий разрыв в том
 * самом месте, которое задача называет главной особенностью продукта. Сметы
 * правят и присылают заново; после перезаливки ссылка из прогона недельной
 * давности вела в НОВУЮ версию, где строка 148 — уже другая строка. Читатель
 * нажимал «откуда взято» и получал не то, откуда взято, причём без единого
 * признака подмены.
 *
 * Замечание несёт `contentHash` разобранного файла — его кладёт оболочка агента
 * и всегда клала. Он однозначно называет ту версию, которую действительно
 * читали, и по нему в базе есть индекс.
 *
 * ЕСЛИ ПРОВЕРЕННОЙ ВЕРСИИ НЕТ — ССЫЛКИ НЕТ, и это правило, а не сбой.
 * Возврат к свежей ревизии «чтобы хоть куда-то вело» — ровно тот случай,
 * который здесь и чинится: ссылка в никуда хуже её отсутствия, а ссылка в
 * похожее место хуже ссылки в никуда.
 */
export async function versionsByContentHash(
  tenant: string,
  code: string,
): Promise<ReadonlyMap<string, string>> {
  if (tenant === "") {
    throw new Error("Арендатор не задан: просмотр не показывает данные без контекста доступа.");
  }

  const db = createPrismaClient(process.env["DATABASE_URL"]);

  try {
    return await withTenant(db, tenant, async (tx) => {
      const versions = await tx.documentVersion.findMany({
        where: { document: { object: { code } } },
        // Свежая ревизия первой: один и тот же файл могли загрузить дважды без
        // изменений, и тогда отпечаток совпадает у двух версий. Разницы для
        // читателя нет — содержимое то же, — но выбор обязан быть определённым,
        // иначе адрес меняется от прогона к прогону.
        orderBy: { revision: "desc" },
        select: { id: true, contentHash: true },
      });

      const byHash = new Map<string, string>();

      for (const version of versions) {
        if (!byHash.has(version.contentHash)) byHash.set(version.contentHash, version.id);
      }

      return byHash;
    });
  } finally {
    await db.$disconnect();
  }
}

export async function listDocuments(tenant: string, code: string): Promise<DocumentsCard | undefined> {
  if (tenant === "") {
    throw new Error("Арендатор не задан: просмотр не показывает данные без контекста доступа.");
  }

  const db = createPrismaClient(process.env["DATABASE_URL"]);

  try {
    return await withTenant(db, tenant, async (tx) => {
      const object = await tx.projectObject.findFirst({
        where: { code },
        include: {
          documents: {
            orderBy: { createdAt: "desc" },
            include: {
              versions: {
                orderBy: { revision: "desc" },
                include: { _count: { select: { positions: true } } },
              },
            },
          },
        },
      });

      if (object === null) return undefined;

      return {
        objectCode: object.code,
        objectName: object.name,
        documents: object.documents.map((document) => ({
          id: document.id,
          kind: document.kind,
          fileName: document.fileName,
          createdAt: document.createdAt,
          versions: document.versions.map((version) => ({
            id: version.id,
            revision: version.revision,
            contentHash: version.contentHash,
            mimeType: version.mimeType,
            // `BigInt` до экрана не доезжает: React его не сериализует, а
            // размеры файлов в байтах в `number` укладываются с запасом.
            byteSize: Number(version.byteSize),
            storagePath: version.storagePath,
            acquisition: version.acquisition,
            createdAt: version.createdAt,
            positions: version._count.positions,
          })),
        })),
      };
    });
  } finally {
    await db.$disconnect();
  }
}

/**
 * Одна версия со всеми её позициями.
 *
 * Позиции читаются ЦЕЛИКОМ, а страница нарезается в разметке (`paginate`).
 * Причина: сводка над таблицей — сколько позиций без шифра, какие разделы — это
 * утверждение о ВЕРСИИ, а не о показанной странице. Считать её по первым
 * пятидесяти строкам значило бы соврать в числе, ради которого экран и открыт.
 *
 * Договорный предел — 2000 позиций (§20); столько строк из базы читаются одним
 * запросом без затей. Когда предел вырастет, сводка переедет в агрегат, а не
 * пересчитается по странице.
 */
export async function readVersion(
  tenant: string,
  code: string,
  versionId: string,
): Promise<VersionCard | undefined> {
  if (tenant === "") {
    throw new Error("Арендатор не задан: просмотр не показывает данные без контекста доступа.");
  }

  const db = createPrismaClient(process.env["DATABASE_URL"]);

  try {
    return await withTenant(db, tenant, async (tx) => {
      const version = await tx.documentVersion.findFirst({
        where: { id: versionId },
        include: {
          document: {
            include: {
              object: true,
              versions: { orderBy: { revision: "desc" }, select: { id: true, revision: true } },
            },
          },
          positions: { orderBy: { sourceRow: "asc" } },
          _count: { select: { positions: true } },
        },
      });

      if (version === null) return undefined;

      // Версия найдена, но принадлежит другому объекту: шифр в адресе обязан
      // совпасть с владельцем, иначе чужой разбор открывался бы по прямой
      // ссылке при верном арендаторе.
      if (version.document.object.code !== code) return undefined;

      const sections = new Map<string, number>();
      for (const position of version.positions) {
        sections.set(position.section, (sections.get(position.section) ?? 0) + 1);
      }

      // Ревизии берутся ОДНИМ запросом на всю версию, а не по позиции: сто одна
      // позиция дала бы двести два запроса, из которых почти все вернули бы
      // пустоту — правят единицы строк.
      //
      // Предмет собирается той же функцией, что его пишет (`positionSubject`), а
      // не разбирается обратно из строки. Разбор формата здесь был бы ВТОРЫМ
      // знанием о ней, и он разошёлся бы с первым при первой же правке формата.
      const subjects = new Map<string, { readonly ordinal: string; readonly field: RevisableField }>();
      for (const position of version.positions) {
        for (const field of ["количество", "сумма"] as const) {
          subjects.set(positionSubject(version.id, position.ordinal, field), {
            ordinal: position.ordinal,
            field,
          });
        }
      }

      const revisions = await tx.extractionRevision.findMany({
        where: { subject: { in: [...subjects.keys()] } },
        orderBy: { createdAt: "asc" },
      });

      const byOrdinal = new Map<string, RevisionView[]>();
      let awaitingConfirmation = 0;

      for (const revision of revisions) {
        const key = subjects.get(revision.subject);
        if (key === undefined) continue;

        const view: RevisionView = {
          id: revision.id,
          field: key.field,
          value: revision.value,
          origin: revision.origin,
          contentHash: revision.contentHash,
          author: revision.author,
          reason: revision.reason,
          confirmedBy: revision.confirmedBy,
          confirmedAt: revision.confirmedAt,
          createdAt: revision.createdAt,
        };

        const bucket = byOrdinal.get(key.ordinal);
        if (bucket === undefined) byOrdinal.set(key.ordinal, [view]);
        else bucket.push(view);

        // Подтверждения ждёт ПРАВКА, а не разбор: подтверждают вмешательство,
        // а не работу парсера (ADR-R-019).
        if (revision.origin === "правка" && revision.confirmedBy === null) awaitingConfirmation += 1;
      }

      return {
        objectCode: version.document.object.code,
        objectName: version.document.object.name,
        documentId: version.document.id,
        fileName: version.document.fileName,
        kind: version.document.kind,
        version: {
          id: version.id,
          revision: version.revision,
          contentHash: version.contentHash,
          mimeType: version.mimeType,
          byteSize: Number(version.byteSize),
          storagePath: version.storagePath,
          acquisition: version.acquisition,
          createdAt: version.createdAt,
          positions: version._count.positions,
        },
        siblings: version.document.versions.map((row) => ({ id: row.id, revision: row.revision })),
        positions: version.positions.map((position) => ({
          id: position.id,
          ordinal: position.ordinal,
          section: position.section,
          sourceName: position.sourceName,
          basis: position.basis,
          unit: position.unit,
          quantity: position.quantity,
          amount: position.amount,
          sourceRow: position.sourceRow,
          sheet: position.sheet,
          acquisition: position.acquisition,
          revisions: byOrdinal.get(position.ordinal) ?? [],
        })),
        unmatched: version.positions.filter((position) => position.basis.trim() === "").length,
        sections: [...sections.entries()],
        awaitingConfirmation,
      };
    });
  } finally {
    await db.$disconnect();
  }
}
