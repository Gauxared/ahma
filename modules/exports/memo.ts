/**
 * Записка — ТЗ §10, третья из четырёх договорных выгрузок:
 *
 *   «Записка (Word) | Паспорт объекта, разделы по агентам, сводный вывод»
 *
 * ЧЕМ ЗАПИСКА ОТЛИЧАЕТСЯ ОТ ОСТАЛЬНЫХ ТРЁХ
 *
 * Три другие выгрузки — таблицы: их читает тот, кто уже знает, что ищет.
 * Записку читает руководитель, которому нужно принять решение, не открывая
 * смет. Отсюда обязанность, которой у таблиц нет: СКАЗАТЬ ВЫВОД ПЕРВЫМ. Вывод
 * после девяти разделов — это вывод, которого не прочтут.
 *
 * ПУСТОЙ РАЗДЕЛ АГЕНТА — ЭТО СОДЕРЖАНИЕ
 *
 * Агент, который не отработал, попадает в записку С ПОМЕТКОЙ, а не
 * отсутствует. Отсутствие раздела читается как «этой темы у объекта нет»;
 * пометка «не выполнен» — как «эту тему никто не смотрел». Это разные вещи, и
 * вторая — риск, о котором руководитель должен знать.
 *
 * СВОДНЫЙ ВЫВОД НЕ БЫВАЕТ СИЛЬНЕЕ СВОИХ РАЗДЕЛОВ
 *
 * Он ВЫВОДИТСЯ из разделов, а не пишется отдельно. Разреши писать его руками —
 * и «всё в порядке» окажется над разделом с находкой на 64 миллиона.
 *
 * ДОКУМЕНТ ОПИСАН ДАННЫМИ, А НЕ СОБРАН БИБЛИОТЕКОЙ
 *
 * Как и книга Excel: логика выгрузки не знает про `docx`, а проверять
 * структуру записки на её же рендере значит проверять библиотеку, а не себя.
 */
import { escapeFormulaInjection } from "@contracts/index.js";

export const MEMO_TEMPLATE_VERSION = "memo-1" as const;

export type MemoBlock =
  | { readonly kind: "heading"; readonly level: 1 | 2 | 3; readonly text: string }
  | { readonly kind: "paragraph"; readonly text: string; readonly emphasis?: boolean }
  | { readonly kind: "bullet"; readonly text: string }
  | { readonly kind: "field"; readonly text: string; readonly label: string; readonly value: string };

export interface ObjectPassport {
  readonly objectName: string;
  readonly customer: string;
  readonly documentCount: number;
  readonly checkedAt: string;
  readonly total: string;
}

export type SectionStatus = "выполнен" | "не выполнен" | "отказ";

export interface MemoSection {
  readonly agent: string;
  readonly role: string;
  readonly status: SectionStatus;
  readonly findings: readonly string[];
  readonly conclusion: string;
}

export interface MemoVerdict {
  readonly strong: boolean;
  readonly findingsCount: number;
  readonly reason: string;
}

export interface Memo {
  readonly blocks: readonly MemoBlock[];
  readonly verdict: MemoVerdict;
  readonly templateVersion: string;
}

/**
 * Разряды и запятая: записку читает человек, а не импортёр.
 *
 * Разделитель разрядов — НЕРАЗРЫВНЫЙ пробел (U+00A0). Обычный позволил бы Word
 * перенести «104 976» и «702,48» на разные строки, и сумма в записке
 * превратилась бы в два числа. Для документа, которым обосновывают решение на
 * сто миллионов, это не типографская придирка.
 */
const NBSP = "\u00A0";

/**
 * Формат вынесен НАРУЖУ намеренно.
 *
 * Находки — свободный текст, который собирает вызывающая сторона, и суммы в них
 * должны выглядеть так же, как сумма в паспорте. Своя реализация у вызывающего
 * даёт документ, где одно число с разрядами, а соседнее без, — читателю это
 * говорит, что числа пришли из разных мест и, возможно, посчитаны по-разному.
 */
export function rubles(value: string): string {
  const [whole = "0", fraction = "00"] = value.split(".");
  const spaced = whole.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${spaced},${fraction.padEnd(2, "0")} ₽`;
}

function verdictOf(sections: readonly MemoSection[]): MemoVerdict {
  const findingsCount = sections.reduce((sum, section) => sum + section.findings.length, 0);

  if (sections.length === 0) {
    // Ноль разделов — это «никто не смотрел», а не «замечаний нет».
    return {
      strong: false,
      findingsCount: 0,
      reason: "сильный вывод невозможен: ни один агент не отработал по объекту",
    };
  }

  const idle = sections.filter((section) => section.status !== "выполнен");

  if (idle.length > 0) {
    return {
      strong: false,
      findingsCount,
      reason:
        "сильный вывод невозможен: разделы не закрыты — " +
        idle.map((section) => `${section.agent} (${section.status})`).join(", "),
    };
  }

  if (findingsCount > 0) {
    return {
      strong: false,
      findingsCount,
      reason: `сильный вывод невозможен: находок ${findingsCount}, они требуют решения`,
    };
  }

  return {
    strong: true,
    findingsCount: 0,
    reason: `все разделы закрыты (${sections.length}), находок нет`,
  };
}

export function buildMemo(input: {
  readonly passport: ObjectPassport;
  readonly sections: readonly MemoSection[];
}): Memo {
  const verdict = verdictOf(input.sections);
  const blocks: MemoBlock[] = [];

  const safe = (value: string): string => escapeFormulaInjection(value);

  blocks.push({ kind: "heading", level: 1, text: `Записка по объекту «${safe(input.passport.objectName)}»` });

  blocks.push({ kind: "heading", level: 2, text: "Паспорт объекта" });
  const fields: ReadonlyArray<readonly [string, string]> = [
    ["Объект", input.passport.objectName],
    ["Заказчик", input.passport.customer],
    ["Документов проверено", String(input.passport.documentCount)],
    ["Дата проверки", input.passport.checkedAt],
    ["Итог по объекту", rubles(input.passport.total)],
  ];
  for (const [label, value] of fields) {
    blocks.push({ kind: "field", label, value: safe(value), text: `${label}: ${safe(value)}` });
  }

  // Вывод ПЕРЕД разделами: записку читает тот, кто решает.
  blocks.push({ kind: "heading", level: 2, text: "СВОДНЫЙ ВЫВОД" });
  blocks.push({ kind: "paragraph", text: verdict.reason, emphasis: true });

  if (verdict.findingsCount > 0) {
    // Руководитель, дочитавший до вывода, обязан увидеть, о чём спор, — а не
    // идти за этим в разделы.
    blocks.push({ kind: "paragraph", text: "Находки, требующие решения:" });
    for (const section of input.sections) {
      for (const finding of section.findings) {
        blocks.push({ kind: "bullet", text: `${section.agent}: ${safe(finding)}` });
      }
    }
  }

  blocks.push({ kind: "heading", level: 2, text: "Разделы по агентам" });

  for (const section of input.sections) {
    blocks.push({
      kind: "heading",
      level: 3,
      text: `${safe(section.agent)} — ${safe(section.role)} (${section.status})`,
    });

    if (section.status !== "выполнен") {
      // Пометка обязательна: без неё отсутствие содержания читается как
      // отсутствие темы.
      blocks.push({
        kind: "paragraph",
        text:
          section.status === "отказ"
            ? "Раздел не закрыт: агент вернул отказ. Тема объекта НЕ проверена."
            : "Раздел не закрыт: агент не отработал. Тема объекта НЕ проверена.",
        emphasis: true,
      });

      // ПРИЧИНА печатается, если она названа.
      //
      // «Не отработал» руководителю нечего делать: он не знает, ждать ли, или
      // чего-то не хватает от него самого. «Не строится: не задана
      // себестоимость» — это поручение. Раздел собственных принципов записки
      // требует, чтобы пустой раздел был содержанием; молчание о причине
      // оставляло его пустым по существу.
      if (section.conclusion.trim() !== "") {
        blocks.push({ kind: "paragraph", text: safe(section.conclusion) });
      }

      continue;
    }

    if (section.findings.length === 0) {
      blocks.push({ kind: "paragraph", text: "Находок нет." });
    } else {
      for (const finding of section.findings) {
        blocks.push({ kind: "bullet", text: safe(finding) });
      }
    }

    if (section.conclusion.trim() !== "") {
      blocks.push({ kind: "paragraph", text: `Вывод: ${safe(section.conclusion)}` });
    }
  }

  return { blocks, verdict, templateVersion: MEMO_TEMPLATE_VERSION };
}
