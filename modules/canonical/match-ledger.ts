/**
 * Журнал сопоставлений и их подтверждений — ADR-R-013.
 *
 * Дословно ADR: «неоднозначные требуют подтверждения человеком, ИСХОДНАЯ И
 * ПОДТВЕРЖДЁННАЯ ВЕРСИИ ХРАНЯТСЯ ОБЕ».
 *
 * ЗАЧЕМ ХРАНИТЬ ОБЕ
 *
 * Через месяц спор пойдёт о цифре в сравнительной таблице, и вопрос будет
 * ровно один: система так решила или человек так поправил. Если подтверждение
 * ЗАМЕЩАЕТ исходное сопоставление, ответить нельзя — а от ответа зависит, чью
 * ошибку исправлять: алгоритма или сотрудника.
 *
 * Тот же принцип, что у ревизий извлечения, применённый к другому предмету:
 * там правят ЧИСЛО, прочитанное из документа, здесь — СВЯЗЬ между позицией КП
 * и справочником.
 *
 * ЧЕЛОВЕК МОЖЕТ СКАЗАТЬ «НИ ОДИН»
 *
 * Подтверждение — не выбор из предложенного. Если верного кандидата в списке
 * нет, ответ «не сопоставлено» обязан быть доступен, иначе человека вынуждают
 * согласиться с лучшим из неправильных.
 *
 * ПОДТВЕРЖДАЮТ ТОЛЬКО НЕОДНОЗНАЧНОЕ
 *
 * Уверенные сопоставления в очередь не ставятся. Иначе человек начнёт
 * подтверждать не глядя, и подтверждение обесценится, превратившись из
 * проверки в формальность, — тот же довод, что у ревизий извлечения.
 *
 * НЕСОПОСТАВЛЕННОЕ — НЕ ВОПРОС К ЧЕЛОВЕКУ
 *
 * Это исход §5.2, а не незакрытая задача: подтверждать там нечего. Такие
 * позиции выделяются отдельным списком и в расчёт разброса не входят.
 */

export type ProposedOutcome = "сопоставлено" | "требует подтверждения" | "не сопоставлено";

export interface ProposedMatch {
  /** Строка предложения: чем она названа у подрядчика. */
  readonly offerLine: string;
  readonly outcome: ProposedOutcome;
  /** Отсутствует при исходе «не сопоставлено». */
  readonly candidateId?: string;
  readonly confidence: number;
  readonly explanation: string;
}

export interface ConfirmedMatch {
  /** Отсутствует, когда человек отверг все варианты. */
  readonly candidateId?: string;
  readonly by: string;
  readonly at: string;
  readonly reason: string;
}

export interface MatchRecord {
  readonly offerLine: string;
  /** Что предложила система. Не изменяется никогда. */
  readonly proposed: ProposedMatch;
  /** Что решил человек. Отсутствует, пока решения нет. */
  readonly confirmed?: ConfirmedMatch;
}

export interface Readiness {
  readonly ready: boolean;
  readonly reason: string;
}

export class MatchLedger {
  readonly #records = new Map<string, MatchRecord>();

  propose(match: ProposedMatch): MatchRecord {
    const record: MatchRecord = { offerLine: match.offerLine, proposed: match };
    this.#records.set(match.offerLine, record);

    return record;
  }

  get(offerLine: string): MatchRecord | undefined {
    return this.#records.get(offerLine);
  }

  /** Человек согласился с кандидатом или указал другого. */
  confirm(
    offerLine: string,
    decision: { readonly candidateId: string; readonly by: string; readonly at: string; readonly reason: string },
  ): MatchRecord {
    return this.#decide(offerLine, {
      candidateId: decision.candidateId,
      by: decision.by,
      at: decision.at,
      reason: decision.reason,
    });
  }

  /** Человек отверг все варианты: верной позиции в справочнике нет. */
  reject(
    offerLine: string,
    decision: { readonly by: string; readonly at: string; readonly reason: string },
  ): MatchRecord {
    return this.#decide(offerLine, decision);
  }

  /**
   * Действующее сопоставление: подтверждённое, если оно есть, иначе исходное.
   *
   * Отсутствует, когда человек отверг варианты или система не сопоставила.
   */
  effective(offerLine: string): { readonly candidateId: string } | undefined {
    const record = this.#records.get(offerLine);
    if (record === undefined) return undefined;

    if (record.confirmed !== undefined) {
      return record.confirmed.candidateId === undefined
        ? undefined
        : { candidateId: record.confirmed.candidateId };
    }

    // Неподтверждённое неоднозначное действующим НЕ считается: иначе
    // подтверждение стало бы необязательным, а расчёт пошёл бы по догадке.
    if (record.proposed.outcome !== "сопоставлено" || record.proposed.candidateId === undefined) {
      return undefined;
    }

    return { candidateId: record.proposed.candidateId };
  }

  /** Что ждёт решения человека. */
  pending(): readonly MatchRecord[] {
    return [...this.#records.values()].filter(
      (record) => record.proposed.outcome === "требует подтверждения" && record.confirmed === undefined,
    );
  }

  /** Несопоставленные позиции — отдельный список §5.2. */
  unmatched(): readonly MatchRecord[] {
    return [...this.#records.values()].filter(
      (record) =>
        record.proposed.outcome === "не сопоставлено" ||
        (record.confirmed !== undefined && record.confirmed.candidateId === undefined),
    );
  }

  all(): readonly MatchRecord[] {
    return [...this.#records.values()];
  }

  /**
   * Можно ли считать разброс.
   *
   * Считать по неподтверждённым сопоставлениям значит считать по догадкам и
   * выдать результат как факт.
   */
  readiness(): Readiness {
    if (this.#records.size === 0) {
      return { ready: true, reason: "сопоставлений нет: считать нечего" };
    }

    const pending = this.pending();

    if (pending.length === 0) {
      return {
        ready: true,
        reason: `все ${this.#records.size} сопоставлений разрешены, неоднозначных не осталось`,
      };
    }

    return {
      ready: false,
      reason:
        `ждут подтверждения человеком (${pending.length}): ` +
        pending.map((record) => record.offerLine).join("; "),
    };
  }

  #decide(offerLine: string, confirmed: ConfirmedMatch): MatchRecord {
    const record = this.#records.get(offerLine);

    if (record === undefined) {
      throw new Error(`Сопоставление для строки «${offerLine}» не найдено: подтверждать нечего`);
    }

    if (confirmed.reason.trim() === "") {
      throw new Error(
        "Решение человека требует причины: без неё его нельзя ни проверить, ни оспорить",
      );
    }

    // Исходное сопоставление переносится КАК ЕСТЬ: оно не изменяется никогда.
    const updated: MatchRecord = { ...record, confirmed };
    this.#records.set(offerLine, updated);

    return updated;
  }
}
