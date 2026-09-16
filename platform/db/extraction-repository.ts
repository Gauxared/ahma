/**
 * Сохранение разбора: документ, версия, позиции, ревизии — ТЗ §5.5, ADR-R-019.
 *
 * ЧТО ЭТО ЗАКРЫВАЕТ
 *
 * Три запроса фронтового трека, каждый из которых блокировал экран §5.5
 * «загрузка и разбор»:
 *
 *  · `Document` и `DocumentVersion` лежали в схеме и не заполнялись:
 *    `storagePath` не писал никто, и загруженный документ негде было взять;
 *  · извлечённые позиции жили только внутри артефакта Проверки, и то
 *    счётчиками — «позиций 101, по шифру 98». Таблицу строк построить не из
 *    чего: считать нечего, кроме итога;
 *  · `ExtractionLedger` вёл ревизии в памяти и терял их на выходе процесса.
 *    Подтверждение человеком привязано к ХЭШУ значения, и в памяти оно не
 *    переживало перезапуск.
 *
 * ВЕРСИЯ АДРЕСУЕТСЯ СОДЕРЖИМЫМ (ADR-R-024, R-027)
 *
 * Тот же файл — та же версия, и позиции переписываются, а не удваиваются. Иначе
 * каждая перепроверка объекта удваивала бы таблицу, и «позиций 202» стало бы
 * правдой базы и ложью о смете.
 *
 * Другое содержимое — НОВАЯ версия, прежняя остаётся. Правка исходного файла
 * это новая версия и новый разбор, а не мутация строк: сравнить два разбора
 * можно только если сохранены оба.
 *
 * ЧИСЛА ХРАНЯТСЯ СТРОКАМИ
 *
 * Рубли и объёмы считает `decimal.js` с точностью 34. Привести их к `numeric`
 * базы значит завести второе округление в другом месте — и разойтись с
 * расчётным модулем на копейку там, где сходимость обязана быть нулевой.
 */
import { revisionHash } from "@modules/documents/extraction-revision.js";

import type { Tx } from "./prisma.js";

/**
 * Предмет ревизии для позиции сметы.
 *
 * ВЕРСИЯ В ПРЕДМЕТЕ ОБЯЗАТЕЛЬНА
 *
 * Схема приводит пример `позиция-14/количество`, и он неполон: позиция 14
 * встречается в каждой смете объекта. Подтвердили количество в одной — считалось
 * бы подтверждённым в другой, а подтверждение это подпись человека под
 * КОНКРЕТНЫМ значением.
 *
 * Собирается здесь, а не в интерфейсе: форма предмета — свойство таблицы, и
 * второй экран, собравший её по-своему, разошёлся бы с первым молча.
 */
export function positionSubject(
  documentVersionId: string,
  ordinal: string,
  field: "количество" | "сумма",
): string {
  return `версия-${documentVersionId}/позиция-${ordinal}/${field}`;
}

/** Исход подтверждения: подпись поставлена либо назван повод отказа. */
export type ConfirmOutcome =
  | { readonly confirmed: true; readonly value: string }
  | { readonly confirmed: false; readonly reason: string };

export interface DocumentDescriptor {
  /** Путь, по которому файл лежит. Он же `storagePath` версии. */
  readonly objectPath: string;
  readonly fileName: string;
  /** лср | ссрсс | рабочая-документация | … */
  readonly kind: string;
  readonly mimeType: string;
  readonly byteSize: number;
}

export interface PositionRow {
  readonly ordinal: string;
  readonly section: string;
  readonly sourceName: string;
  readonly basis: string;
  readonly unit: string;
  readonly quantity?: string | undefined;
  /** NULL в базе — сумма НЕИЗВЕСТНА, а не равна нулю (миграция `position_amount_optional`). */
  readonly amount: string | undefined;
  readonly sourceRow: number;
  /** Лист книги; пусто у формы 421/пр. */
  readonly sheet?: string | undefined;
  /** Как получена (Т11). Пусто — `parsed`, разбор формы. */
  readonly acquisition?: string | undefined;
}

export interface SaveExtractionInput {
  readonly tenantId: string;
  readonly objectId: string;
  readonly document: DocumentDescriptor;
  readonly contentHash: string;
  readonly positions: readonly PositionRow[];
  /**
   * Как получены данные (ADR-R-019): `parsed` — машинным разбором,
   * `confirmed_by_human` — подтверждены человеком, `ocr_unconfirmed` — OCR без
   * подтверждения. По умолчанию разбор.
   */
  readonly acquisition?: string;
}

export interface SavedExtraction {
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly revision: number;
  readonly positions: number;
}

export interface SaveRevisionInput {
  readonly tenantId: string;
  readonly subject: string;
  readonly value: string;
  readonly unit?: string | undefined;
  readonly sourceDocument: string;
  readonly sourceLocator: string;
  /** разбор | правка */
  readonly origin: string;
  readonly critical: boolean;
  readonly contentHash: string;
  readonly previousId?: string | undefined;
  readonly author?: string | undefined;
  readonly reason?: string | undefined;
}

export class ExtractionRepository {
  /**
   * Сохраняет разбор одного документа.
   *
   * Идемпотентно по содержимому: повторный разбор того же файла возвращает ту
   * же версию и переписывает её позиции.
   */
  async saveExtraction(tx: Tx, input: SaveExtractionInput): Promise<SavedExtraction> {
    const document =
      (await tx.document.findFirst({
        where: { tenantId: input.tenantId, objectId: input.objectId, fileName: input.document.fileName },
      })) ??
      (await tx.document.create({
        data: {
          tenantId: input.tenantId,
          objectId: input.objectId,
          kind: input.document.kind,
          fileName: input.document.fileName,
        },
      }));

    const existing = await tx.documentVersion.findFirst({
      where: { tenantId: input.tenantId, documentId: document.id, contentHash: input.contentHash },
    });

    if (existing !== null) {
      // Тот же файл: позиции переписываются, а не добавляются. Разбор
      // детерминирован, поэтому результат тот же — но удвоенных строк не будет
      // даже если он изменится.
      await tx.position.deleteMany({ where: { documentVersionId: existing.id } });
      const written = await this.#writePositions(tx, input, existing.id);

      return {
        documentId: document.id,
        documentVersionId: existing.id,
        revision: existing.revision,
        positions: written,
      };
    }

    // Номер ревизии — следующий по документу. Считается ЗДЕСЬ, а не приходит
    // снаружи: вызывающий не знает, что уже сохранено, и ошибётся при гонке.
    const last = await tx.documentVersion.findFirst({
      where: { tenantId: input.tenantId, documentId: document.id },
      orderBy: { revision: "desc" },
      select: { revision: true },
    });

    const version = await tx.documentVersion.create({
      data: {
        tenantId: input.tenantId,
        documentId: document.id,
        revision: (last?.revision ?? 0) + 1,
        contentHash: input.contentHash,
        mimeType: input.document.mimeType,
        byteSize: BigInt(input.document.byteSize),
        storagePath: input.document.objectPath,
        acquisition: input.acquisition ?? "parsed",
      },
    });

    const written = await this.#writePositions(tx, input, version.id);

    return {
      documentId: document.id,
      documentVersionId: version.id,
      revision: version.revision,
      positions: written,
    };
  }

  async #writePositions(
    tx: Tx,
    input: SaveExtractionInput,
    documentVersionId: string,
  ): Promise<number> {
    if (input.positions.length === 0) return 0;

    const result = await tx.position.createMany({
      data: input.positions.map((position) => ({
        tenantId: input.tenantId,
        documentVersionId,
        ordinal: position.ordinal,
        section: position.section,
        sourceName: position.sourceName,
        basis: position.basis,
        unit: position.unit,
        ...(position.quantity === undefined ? {} : { quantity: position.quantity }),
        // NULL, а не пропуск поля: Prisma трактует отсутствие ключа как
        // «не задавать», а нам нужно записать именно «сумма неизвестна».
        amount: position.amount ?? null,
        sourceRow: position.sourceRow,
        ...(position.sheet === undefined ? {} : { sheet: position.sheet }),
        // Умолчание `parsed` — в схеме: позиция без пометки разобрана формой.
        ...(position.acquisition === undefined ? {} : { acquisition: position.acquisition }),
      })),
    });

    return result.count;
  }

  /**
   * Сохраняет ревизию извлечённого значения.
   *
   * Правка НЕ затирает разбор, а ссылается на него через `previousId`: история
   * извлечения — это то, чем защищают число перед подрядчиком.
   */
  async saveRevision(tx: Tx, input: SaveRevisionInput): Promise<{ readonly id: string }> {
    const created = await tx.extractionRevision.create({
      data: {
        tenantId: input.tenantId,
        subject: input.subject,
        value: input.value,
        ...(input.unit === undefined ? {} : { unit: input.unit }),
        sourceDocument: input.sourceDocument,
        sourceLocator: input.sourceLocator,
        origin: input.origin,
        critical: input.critical,
        contentHash: input.contentHash,
        ...(input.previousId === undefined ? {} : { previousId: input.previousId }),
        ...(input.author === undefined ? {} : { author: input.author }),
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      },
    });

    return { id: created.id };
  }

  /**
   * Записывает ПРАВКУ извлечённого значения — готовая точка входа для экрана
   * §5.5, чтобы он не собирал цепочку ревизий сам.
   *
   * Разбор без правки ревизии НЕ ТРЕБУЕТ: иначе подтверждать пришлось бы каждую
   * из тысяч позиций, человек начал бы подтверждать не глядя, и подтверждение
   * обесценилось бы. Поэтому ревизия «разбор» создаётся здесь ЛЕНИВО — в момент
   * первой правки предмета, чтобы у правки было на что ссылаться.
   *
   * Правка без причины отклоняется: значение без объяснения нечем защитить,
   * спор о нём упрётся в «так поправили», и правка станет слабее разбора. То же
   * правило, что в `ExtractionLedger`.
   */
  async recordEdit(
    tx: Tx,
    input: {
      readonly tenantId: string;
      readonly subject: string;
      readonly sourceDocument: string;
      readonly sourceLocator: string;
      readonly unit?: string | undefined;
      readonly critical: boolean;
      /** Что прочитал разбор. Нужен, чтобы завести ревизию «разбор». */
      readonly parsedValue: string;
      readonly newValue: string;
      readonly author: string;
      readonly reason: string;
    },
  ): Promise<{ readonly id: string; readonly previousId: string }> {
    if (input.reason.trim() === "") {
      throw new Error("Правка требует причины: значение без объяснения нечем защитить");
    }

    const head = await tx.extractionRevision.findFirst({
      where: { tenantId: input.tenantId, subject: input.subject },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const previousId =
      head?.id ??
      (
        await this.saveRevision(tx, {
          tenantId: input.tenantId,
          subject: input.subject,
          value: input.parsedValue,
          unit: input.unit,
          sourceDocument: input.sourceDocument,
          sourceLocator: input.sourceLocator,
          origin: "разбор",
          critical: input.critical,
          contentHash: revisionHash({
            subject: input.subject,
            value: input.parsedValue,
            unit: input.unit,
            sourceDocument: input.sourceDocument,
            sourceLocator: input.sourceLocator,
            origin: "разбор",
          }),
        })
      ).id;

    const edited = await this.saveRevision(tx, {
      tenantId: input.tenantId,
      subject: input.subject,
      value: input.newValue,
      unit: input.unit,
      sourceDocument: input.sourceDocument,
      sourceLocator: input.sourceLocator,
      origin: "правка",
      critical: input.critical,
      contentHash: revisionHash({
        subject: input.subject,
        value: input.newValue,
        unit: input.unit,
        sourceDocument: input.sourceDocument,
        sourceLocator: input.sourceLocator,
        origin: "правка",
      }),
      previousId,
      author: input.author,
      reason: input.reason,
    });

    return { id: edited.id, previousId };
  }

  /**
   * Ставит подпись человека на ревизию — ТО, ЧЕГО НЕ ХВАТАЛО СХЕМЕ.
   *
   * Поля `confirmedBy` и `confirmedAt` лежали в таблице с самого начала, и не
   * писал их никто: подтверждение существовало только в `ExtractionLedger`, то
   * есть в памяти процесса. Экран §5.5 подтвердить ничего не мог.
   *
   * ПОДТВЕРЖДЕНИЕ ПРИВЯЗАНО К ХЭШУ, И ЭТО ГЛАВНОЕ ЗДЕСЬ
   *
   * Вызывающий передаёт хэш, который он ВИДЕЛ. Если в базе другой — предмет
   * изменился между показом и нажатием, и подпись прикрыла бы то, чего человек
   * не видел. Такое подтверждение хуже отсутствия: отсутствие заметно, а ложное
   * подтверждение выглядит проверенным (§12, ADR-R-019).
   *
   * ПОВТОР НЕ ПЕРЕПИСЫВАЕТ ПОДПИСЬ
   *
   * Уже подтверждённая ревизия возвращает отказ с именем подписавшего, а не
   * молча меняет автора. Первая подпись — факт, и переписывать её значит
   * переписывать историю.
   *
   * Запись одним `updateMany` со счётчиком, а не чтением и `update`: между
   * проверкой и записью строка может быть подтверждена кем-то ещё, и тогда
   * условие в `where` отсекает вторую подпись, а не второе чтение (`Ф-34`).
   */
  async confirm(
    tx: Tx,
    input: {
      readonly tenantId: string;
      readonly revisionId: string;
      /** Хэш, который подтверждающий видел на экране. */
      readonly contentHash: string;
      readonly actor: string;
      readonly now: Date;
    },
  ): Promise<ConfirmOutcome> {
    const revision = await tx.extractionRevision.findFirst({
      where: { id: input.revisionId, tenantId: input.tenantId },
      select: { contentHash: true, value: true, confirmedBy: true },
    });

    if (revision === null) {
      return { confirmed: false, reason: "ревизия не найдена" };
    }

    if (revision.confirmedBy !== null) {
      return {
        confirmed: false,
        reason: `ревизия уже подтверждена (${revision.confirmedBy}): подпись не переписывается`,
      };
    }

    if (revision.contentHash !== input.contentHash) {
      return {
        confirmed: false,
        reason:
          "хэш предмета устарел: значение изменилось после того, как его показали — " +
          "подтверждать надо то, что видно сейчас",
      };
    }

    const updated = await tx.extractionRevision.updateMany({
      where: { id: input.revisionId, tenantId: input.tenantId, contentHash: input.contentHash, confirmedBy: null },
      data: { confirmedBy: input.actor, confirmedAt: input.now },
    });

    if (updated.count === 0) {
      return {
        confirmed: false,
        reason: "состояние ревизии изменилось во время подтверждения: откройте заново, чтобы увидеть текущее",
      };
    }

    return { confirmed: true, value: revision.value };
  }

  /** История предмета в порядке появления: разбор, затем правки. */
  async historyOf(
    tx: Tx,
    subject: string,
  ): Promise<readonly { readonly id: string; readonly origin: string; readonly previousId: string | null }[]> {
    return tx.extractionRevision.findMany({
      where: { subject },
      orderBy: { createdAt: "asc" },
      select: { id: true, origin: true, previousId: true },
    });
  }
}
