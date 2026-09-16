/**
 * Ревизии извлечения — роадмап M4.
 *
 *   «Immutable `ExtractionRevision`, правка как новая ревизия, подтверждение по
 *    ХЭШУ ПРЕДМЕТА; сильный вердикт ЗАБЛОКИРОВАН до подтверждения критичных
 *    ревизий.»
 *
 * ЗАЧЕМ НЕИЗМЕНЯЕМОСТЬ
 *
 * Извлечённое значение правят руками: разбор взял из объединённой ячейки не то
 * число, единица прочиталась как «шт» вместо «компл». Если правка ЗАМЕНЯЕТ
 * исходное значение, восстановить, что именно система прочитала в документе,
 * становится невозможно, — а спор с подрядчиком идёт как раз об этом: «в смете
 * написано другое». Ответ «система читает так, человек исправил вот на это, вот
 * обе версии» — единственный, который защищает обе стороны.
 *
 * ПОДТВЕРЖДЕНИЕ ПРИВЯЗАНО К ХЭШУ ПРЕДМЕТА
 *
 * Подтверждение — подпись человека под конкретным значением. Пережив изменение
 * предмета, подпись прикрывает то, чего человек не видел. Подтверждение,
 * пережившее правку, ХУЖЕ его отсутствия: отсутствие видно, а ложное
 * подтверждение выглядит проверенным.
 *
 * При этом подпись НЕ ОТЗЫВАЕТСЯ задним числом: человек действительно
 * подтвердил то значение, и стирать это — переписывать историю. Подтверждение
 * просто перестаёт относиться к текущему предмету.
 *
 * ПОДТВЕРЖДАЮТ ВМЕШАТЕЛЬСТВО, А НЕ РАБОТУ ПАРСЕРА
 *
 * Разбор без правки подтверждения не требует. Иначе подтверждать пришлось бы
 * каждую из тысяч позиций, человек начал бы подтверждать не глядя, и
 * подтверждение обесценилось бы — превратившись из проверки в формальность.
 */
import { createHash } from "node:crypto";

/** Откуда взялось значение ревизии. */
export type RevisionOrigin = "разбор" | "правка";

export interface ExtractionSource {
  readonly document: string;
  /** Где именно в документе: адрес ячейки, номер строки, страница. */
  readonly locator: string;
}

export interface ExtractionRevision {
  readonly id: string;
  /** Что именно извлечено: `позиция-14/количество`. */
  readonly subject: string;
  readonly value: string;
  readonly unit?: string;
  readonly source: ExtractionSource;
  readonly origin: RevisionOrigin;
  /**
   * Критично ли значение для сильного вердикта. Количество и стоимость —
   * критичны; имя исполнителя в шапке — нет.
   */
  readonly critical: boolean;
  /** Хэш содержания. К нему привязано подтверждение. */
  readonly contentHash: string;
  readonly previousId?: string;
  readonly author?: string;
  readonly reason?: string;
  readonly confirmedBy?: string;
  readonly confirmedAt?: string;
}

export interface StrongVerdictGate {
  readonly allowed: boolean;
  /** Предметы, из-за которых вердикт заблокирован. Список целиком. */
  readonly blocking: readonly string[];
  readonly reason: string;
}

function hashOf(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex");
}

/**
 * Хэш содержания ревизии.
 *
 * Вынесен наружу, потому что ревизии теперь ещё и ХРАНЯТСЯ: подтверждение
 * привязано к хэшу, и вторая реализация хэша означала бы, что подпись,
 * поставленная через журнал, перестаёт совпадать с подписью из базы. Разошлись
 * бы они молча — подтверждение просто перестало бы находиться.
 */
export function revisionHash(input: {
  readonly subject: string;
  readonly value: string;
  readonly unit?: string | undefined;
  readonly sourceDocument: string;
  readonly sourceLocator: string;
  readonly origin: RevisionOrigin;
}): string {
  return hashOf([
    input.subject,
    input.value,
    input.unit ?? "",
    input.sourceDocument,
    input.sourceLocator,
    input.origin,
  ]);
}

/**
 * Журнал извлечений одного документа или объекта.
 *
 * Ревизии не удаляются и не изменяются: `revise` добавляет новую, `confirm`
 * ставит подпись на существующую. Ни один метод не переписывает значение.
 */
export class ExtractionLedger {
  readonly #byId = new Map<string, ExtractionRevision>();
  /** Последняя ревизия каждого предмета: «текущее значение». */
  readonly #headBySubject = new Map<string, string>();
  #counter = 0;

  extract(input: {
    readonly subject: string;
    readonly value: string;
    readonly unit?: string;
    readonly source: ExtractionSource;
    readonly critical: boolean;
  }): ExtractionRevision {
    return this.#append({
      subject: input.subject,
      value: input.value,
      ...(input.unit === undefined ? {} : { unit: input.unit }),
      source: input.source,
      origin: "разбор",
      critical: input.critical,
    });
  }

  revise(
    previousId: string,
    change: { readonly value: string; readonly author: string; readonly reason: string },
  ): ExtractionRevision {
    const previous = this.#byId.get(previousId);

    if (previous === undefined) {
      throw new Error(`Ревизия ${previousId} не найдена`);
    }

    if (change.reason.trim() === "") {
      // Значение без объяснения нечем защитить: спор о нём упрётся в «так
      // поправили», и правка станет слабее исходного разбора.
      throw new Error("Правка требует причины: значение без объяснения нечем защитить");
    }

    if (this.#headBySubject.get(previous.subject) !== previousId) {
      // Иначе две правки от разных людей разойдутся в две ветки, и «текущее
      // значение» станет вопросом порядка записи, а не решения человека.
      throw new Error(
        `Ревизия ${previousId} не последняя для предмета «${previous.subject}»: ` +
          "правьте текущую, иначе история разойдётся в ветки",
      );
    }

    return this.#append({
      subject: previous.subject,
      value: change.value,
      ...(previous.unit === undefined ? {} : { unit: previous.unit }),
      source: previous.source,
      origin: "правка",
      critical: previous.critical,
      previousId,
      author: change.author,
      reason: change.reason,
    });
  }

  /** Ставит подпись на ревизию. Существующие ревизии не переписываются. */
  confirm(id: string, by: { readonly by: string; readonly at: string }): ExtractionRevision {
    const revision = this.#byId.get(id);

    if (revision === undefined) {
      throw new Error(`Ревизия ${id} не найдена`);
    }

    const confirmed: ExtractionRevision = { ...revision, confirmedBy: by.by, confirmedAt: by.at };
    this.#byId.set(id, confirmed);

    return confirmed;
  }

  get(id: string): ExtractionRevision | undefined {
    return this.#byId.get(id);
  }

  /** Текущее значение предмета. */
  current(subject: string): ExtractionRevision | undefined {
    const head = this.#headBySubject.get(subject);
    return head === undefined ? undefined : this.#byId.get(head);
  }

  /** Вся цепочка ревизий предмета от разбора до текущей. */
  history(subject: string): readonly ExtractionRevision[] {
    const chain: ExtractionRevision[] = [];

    let cursor = this.current(subject);
    while (cursor !== undefined) {
      chain.unshift(cursor);
      cursor = cursor.previousId === undefined ? undefined : this.#byId.get(cursor.previousId);
    }

    return chain;
  }

  /**
   * Подтверждён ли ПРЕДМЕТ, а не ревизия.
   *
   * Подпись на старой ревизии текущего предмета не подтверждает: она относится
   * к значению, которого больше нет.
   */
  isConfirmed(subject: string): boolean {
    return this.current(subject)?.confirmedBy !== undefined;
  }

  subjects(): readonly string[] {
    return [...this.#headBySubject.keys()];
  }

  /**
   * Разрешён ли сильный вердикт.
   *
   * Блокируют только КРИТИЧНЫЕ предметы, у которых текущая ревизия — правка без
   * подтверждения. Список выдаётся целиком: человек, увидевший один предмет,
   * подтвердит его и снова упрётся в блокировку.
   */
  strongVerdictAllowed(): StrongVerdictGate {
    const blocking = this.subjects().filter((subject) => {
      const current = this.current(subject);
      return (
        current !== undefined &&
        current.critical &&
        current.origin === "правка" &&
        current.confirmedBy === undefined
      );
    });

    if (blocking.length === 0) {
      return {
        allowed: true,
        blocking: [],
        reason: "критичных неподтверждённых правок нет",
      };
    }

    return {
      allowed: false,
      blocking,
      reason:
        `сильный вердикт заблокирован: критичные правки не подтверждены (${blocking.length}) — ` +
        blocking.join(", "),
    };
  }

  #append(
    draft: Omit<ExtractionRevision, "id" | "contentHash">,
  ): ExtractionRevision {
    this.#counter += 1;

    const contentHash = revisionHash({
      subject: draft.subject,
      value: draft.value,
      unit: draft.unit,
      sourceDocument: draft.source.document,
      sourceLocator: draft.source.locator,
      origin: draft.origin,
    });

    // Идентификатор ревизии выводится из содержания и порядкового номера:
    // две правки на одно и то же значение — разные события, и склеивать их
    // нельзя, иначе вторая подпись прикроет первую.
    const revision: ExtractionRevision = {
      ...draft,
      id: `${contentHash.slice(0, 12)}-${this.#counter}`,
      contentHash,
    };

    this.#byId.set(revision.id, revision);
    this.#headBySubject.set(revision.subject, revision.id);

    return revision;
  }
}
