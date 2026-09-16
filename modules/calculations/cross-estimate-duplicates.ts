/**
 * Двойной счёт МЕЖДУ сметами объекта.
 *
 * ЧТО ЭТО ЛОВИТ И ПОЧЕМУ ЭТОГО НЕ ЛОВИЛО НИЧТО
 *
 * `checkEstimate` ищет дубли ВНУТРИ одного документа: одна расценка с одной
 * суммой дважды в одной смете. Это верно и полезно, но слепо ровно к тому
 * случаю, который эталонный разбор курганского объекта назвал вторым по
 * важности:
 *
 *   пусконаладка на 890 669,50 ₽ сидит и внутри ЛСР СОТ, и отдельным ЛСР ПНР.
 *
 * Каждая смета при этом сходится до рубля. Обе внутренние проверки проходят,
 * сумма смет сходится со сводным расчётом — и объект оплачивается дважды за одну
 * работу. Увидеть это можно, только сопоставив сметы между собой.
 *
 * ПРИЗНАК: ШИФР И СУММА, А НЕ ОДИН ИЗ НИХ
 *
 * Один шифр в двух сметах — норма: одна и та же расценка применяется на разных
 * участках. Одна сумма при разных шифрах — совпадение. А вот та же расценка с
 * ТОЙ ЖЕ суммой в двух документах — это либо двойной счёт, либо копия, которую
 * забыли убрать; в обоих случаях требуется решение человека.
 *
 * ПОЧЕМУ ЭТО «ТРЕБУЕТ ПРОВЕРКИ», А НЕ «НАРУШЕНИЕ»
 *
 * Законный случай существует: две очереди объекта с одинаковым составом и
 * одинаковой ценой. Объявить это нарушением значило бы обвинить сметчика в том,
 * что он, возможно, сделал правильно. Поэтому находка называет обе стороны и
 * оставляет вывод человеку — ровно как это делает эталон.
 */
import { Decimal } from "decimal.js";

import { decimal } from "@contracts/index.js";
import type { DecimalString } from "@contracts/index.js";

export const CROSS_DUPLICATE_FORMULA = "calculation.cross-estimate-duplicate" as const;

/** Позиция, участвующая в сопоставлении между сметами. */
export interface PositionAcrossEstimates {
  readonly document: string;
  readonly ordinal: string;
  readonly name: string;
  readonly basis: string;
  readonly amount: string;
  readonly sourceRow: number;
  /**
   * Как позиция получена: `parsed` — разбор формы 421/пр, `agent_normalized` —
   * выписана ролью из документа вне формы (Т11).
   *
   * РАЗЛИЧИЕ ЗДЕСЬ НУЖНО ДЛЯ ОДНОГО РЕШЕНИЯ: искать ли повтор ВНУТРИ одного
   * документа. У разобранной сметы это делает `checkEstimate`, и повторять за
   * ним значило бы показать человеку одну находку дважды. А позиции роли не
   * видит НИКТО: `checkEstimate` работает на разборе формы, которого в таком
   * документе нет. Замерено на прогоне 16: из 144 позиций объекта все 144 —
   * от ролей, и большинство из одного файла, где внутренний двойной счёт не
   * искал никто.
   */
  readonly acquisition?: string | undefined;
}

/** Одно вхождение повтора. */
export interface DuplicateOccurrence {
  readonly document: string;
  readonly ordinal: string;
  readonly sourceRow: number;
}

export interface CrossDuplicate {
  readonly basis: string;
  readonly name: string;
  /**
   * Где найден повтор. Разные вещи и разный разговор с подрядчиком: «одна
   * работа в двух сметах» и «одна работа дважды в одной смете».
   */
  readonly scope: "между документами" | "внутри документа";
  /** Сумма ОДНОГО вхождения — столько стоит работа, посчитанная дважды. */
  readonly amount: DecimalString;
  /** Сколько лишнего, если повтор подтвердится: сумма всех вхождений сверх первого. */
  readonly excess: DecimalString;
  readonly occurrences: readonly DuplicateOccurrence[];
}

export interface CrossDuplicateReport {
  readonly duplicates: readonly CrossDuplicate[];
  /** Сколько денег под вопросом суммарно. */
  readonly excess: DecimalString;
  readonly comparedDocuments: number;
}

function baseName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

export function findCrossEstimateDuplicates(
  positions: readonly PositionAcrossEstimates[],
): CrossDuplicateReport {
  const documents = new Set(positions.map((position) => position.document));

  const byKey = new Map<string, PositionAcrossEstimates[]>();

  for (const position of positions) {
    // Позиция без шифра в сопоставление не идёт: у неё нет опознавательного
    // признака, и совпадение сумм у двух безымянных строк ничего не значит.
    if (position.basis.trim() === "") continue;

    const key = `${position.basis}|${new Decimal(position.amount).toFixed(2)}`;
    byKey.set(key, [...(byKey.get(key) ?? []), position]);
  }

  const duplicates: CrossDuplicate[] = [];

  for (const group of byKey.values()) {
    /**
     * ОДНА ПОЗИЦИЯ — НЕ ПОВТОР, И ПРОВЕРЯТЬ ЭТО НАДО ЯВНО.
     *
     * Прежде одиночную группу отсекало условие «документов меньше двух»: у
     * одной позиции документ один. Когда к поиску добавились повторы ВНУТРИ
     * документа, это условие перестало быть защитой — и каждая одинокая
     * позиция роли пошла в отчёт «повтором» с превышением 0,00 ₽. Поймано
     * набором до того, как дошло до прогона.
     */
    if (group.length < 2) continue;

    const distinctDocuments = new Set(group.map((position) => position.document));

    /**
     * ПОВТОР ВНУТРИ ОДНОГО ДОКУМЕНТА БЕРЁТСЯ ТОЛЬКО У ПОЗИЦИЙ РОЛИ.
     *
     * У разобранной сметы внутренний дубль ищет `checkEstimate`, и повторять
     * за ним значило бы показать человеку одну находку дважды. Но позицию,
     * выписанную ролью из документа вне формы 421/пр, он не видит: разбора
     * формы там нет вовсе. До этой правки такой повтор не искал НИКТО — а
     * именно из таких позиций состоит объект без ЛСР.
     */
    const внутриДокумента = distinctDocuments.size < 2;
    const всеОтРолей = group.every((position) => position.acquisition === "agent_normalized");
    if (внутриДокумента && !всеОтРолей) continue;

    const single = new Decimal(group[0]!.amount);

    duplicates.push({
      basis: group[0]!.basis,
      name: group[0]!.name,
      scope: внутриДокумента ? "внутри документа" : "между документами",
      amount: decimal(single.toFixed(2)),
      excess: decimal(single.times(group.length - 1).toFixed(2)),
      occurrences: group.map((position) => ({
        document: baseName(position.document),
        ordinal: position.ordinal,
        sourceRow: position.sourceRow,
      })),
    });
  }

  duplicates.sort((a, b) => new Decimal(b.excess).comparedTo(new Decimal(a.excess)));

  return {
    duplicates,
    excess: decimal(
      duplicates
        .reduce((sum, entry) => sum.plus(new Decimal(entry.excess)), new Decimal(0))
        .toFixed(2),
    ),
    comparedDocuments: documents.size,
  };
}
