/**
 * Агент Денчика (ГИП) — техзаключение для ВОР. ТЗ §5.1, §12.2.
 *
 * Второй из девяти договорных агентов и первый, написанный на общей оболочке
 * (`modules/agents/agent-shell.ts`). Здесь остаётся только частное: что сложить
 * Денчику на вход, как это изложить и откуда брать суммы.
 *
 * ЧТО МОДЕЛЬ ДОБАВЛЯЕТ К ДЕТЕРМИНИРОВАННОМУ МОДУЛЮ
 *
 * `modules/agents/tech-opinion.ts` считает реверс объёма (Д-7): кратности,
 * стоп-флаги, сумму необоснованного, статус ВОР. Это правила, и они правильно
 * детерминированы — §6.4 требует, чтобы выводимое считал модуль, а не модель.
 * Оба продукта живут рядом и не спорят: модуль решает, ВОЗВРАЩАТЬ ЛИ ВОР,
 * модель объясняет, ЧТО ЭТО ЗНАЧИТ ИНЖЕНЕРНО.
 *
 * Модель нужна там, где правил не хватает, — Д-3 и Д-4 промпта:
 *
 *  · СОСТАВ: «5 ИТП на плане против 7 зданий в задании» — сверка количеств;
 *  · ПОЛНОТА: «труба Ø219, 160 м, 10–12 млн выпала из перечня». Отсутствие
 *    не равно «не нужно».
 *
 * Разница принципиальная. Расчётный модуль находит неверное в том, что ЕСТЬ.
 * Найти то, чего НЕТ, правилами нельзя: перечень отсутствующего бесконечен,
 * пока кто-то не поймёт, что за работа описана. Это и есть та часть оригинала,
 * которую детерминированный модуль воспроизвести не мог.
 *
 * ПОЧЕМУ СОСТАВ РАБОТ ОБЯЗАН ПОПАСТЬ В ПРОМПТ
 *
 * Модель, не увидевшая состава, не скажет «камеры есть, а подводки к ним нет».
 * Реверс объёма показывает только те группы, где нашлась кратность; состав
 * показывает всю смету. Без него Д-4 не выполним в принципе.
 */
import type { AccuracyMarker, OperationDefinition, Sha256 } from "@contracts/index.js";

import { createAgentOperation } from "../agent-shell.js";
import type { DepthMode } from "../depth-mode.js";
import type {
  AgentEvidence,
  AgentRunRequest,
  AgentReviewBody,
  AgentTurn,
  RequiredSection,
} from "../agent-shell.js";
import type { ReversalForOpinion } from "../tech-opinion.js";

export type TechOpinionBody = AgentReviewBody;

export const RUN_TECH_OPINION: OperationDefinition = {
  id: "run-tech-opinion",
  version: 1,
  kind: "agent",
  variants: [],
  requires: [],
  optional: [],
  // Способность, а не имя агента: смежник просит `tech_opinion`, а не
  // «Денчика» (ADR-R-026).
  provides: ["tech_opinion"],
  preconditions: [],
};

/**
 * Группа работ по таблице норм — вход для Д-3 и Д-4.
 *
 * Не то же, что группа реверса: реверс показывает только линейные позиции с
 * найденной кратностью, а здесь ВСЯ смета. Пропущенную работу видно лишь на
 * полном составе.
 */
export interface WorkGroupSummary {
  readonly table: string;
  /** Наименование, по которому понятно, что за работа. */
  readonly name: string;
  readonly count: number;
  readonly unit: string;
  readonly totalQuantity: string;
  readonly totalAmount: string;
}

export interface TechOpinionAgentInput {
  readonly documentPath: string;
  /** Режим глубины ответа (§5.4). «Стандарт», если не задан. */
  readonly depth?: DepthMode;
  readonly contentHash: Sha256;
  /**
   * Разобрана ли рабочая документация.
   *
   * Долгое время здесь стояло `false` литералом с оговоркой «пока всегда» — и
   * это было верно: текстовый слой PDF читался обходом и выбрасывался. Теперь
   * признак следует из того, дошёл ли текст.
   */
  readonly hasDesignDocuments: boolean;
  /**
   * Текст рабочей документации, готовый к вставке в промпт.
   *
   * Строками, а не одним куском: выжимку собирает `design-documents`, и она же
   * объявляет замер — сколько страниц, сколько знаков было, сколько показано.
   * Собирать её здесь значило бы завести второе место, знающее про бюджет.
   *
   * ГЕОМЕТРИЯ ЧЕРТЕЖЕЙ СЮДА НЕ ВХОДИТ. Это текстовый слой: подписи, ведомости,
   * примечания. Растровые схемы и координаты линий им не заменяются, и промпт
   * говорит это прямо — иначе агент прочитает «РД есть» как «геометрия есть».
   */
  readonly designText?: readonly string[] | undefined;
  /**
   * Листы рабочей документации изображениями — `data:image/png;base64,…`.
   *
   * НАБЛЮДЕНИЯ С ЛИСТА — ОРИЕНТИР, А НЕ ФАКТ. Замерено: модель прочитала
   * подписанную на чертеже суммарную мощность «315 кВт» как «31,5». Значит
   * взятое с листа требует сверки человеком, и промпт говорит это агенту
   * прямо — иначе он положит прочитанное в основание как измеренное.
   */
  readonly designSheets?: readonly string[] | undefined;
  /** Чем подписаны листы: документ и номер страницы. Для ссылки на источник. */
  readonly designSheetLabels?: readonly string[] | undefined;
  /** Группы реверса, посчитанные расчётным модулем (Д-7). */
  readonly reversal: readonly ReversalForOpinion[];
  readonly unjustifiedAmount: string;
  /** Весь состав работ сметы — вход для Д-3 и Д-4. */
  readonly workGroups: readonly WorkGroupSummary[];
}

export interface TechOpinionDeps {
  /** Опорная база агента (лениво). Пусто — режим [БЕЗ БАЗЫ]. */
  readonly referenceBase?: () => Promise<string | undefined>;
  /**
   * Каркас роли из манифеста: листы, обязательные при ЛЮБОМ объекте.
   *
   * Приходит извне, а не задаётся здесь: тот же список нужен сборщику книги —
   * чтобы назвать не данный лист пробелом, — и два списка разошлись бы молча.
   */
  readonly requiredSections?: readonly RequiredSection[];
  readonly prompt: string;
  /**
   * Маркер точности считает расчётный модуль. Агент его не выводит и не
   * импортирует напрямую: между модулями ходит только талия (ADR-R-025).
   */
  readonly accuracyMarker: (context: { hasDesignDocuments: boolean }) => AccuracyMarker;
  readonly runAgent: (request: AgentRunRequest) => Promise<AgentTurn>;
}

const NO_DESIGN_DOCS =
  "рабочая документация не разобрана: геометрия от осей недоступна, длины " +
  "проверить нечем (Д-1)";

function buildPrompt(input: TechOpinionAgentInput): string {
  const lines: string[] = [`Документ: ${input.documentPath}`, ""];

  if (!input.hasDesignDocuments) {
    // Не сказав, что чертежей нет, мы получим заключение, написанное так,
    // будто геометрия проверена. Д-1 требует длину от осей.
    lines.push(`ЧЕГО НЕТ НА ВХОДЕ: ${NO_DESIGN_DOCS}.`, "");
  } else if (input.designText !== undefined && input.designText.length > 0) {
    // Текст РД идёт ПЕРВЫМ, до реверса объёма: он про то же самое, о чём агент
    // будет судить, и прочитанный после чисел уже не меняет вывода.
    lines.push(...input.designText, "");
  }

  const listy = input.designSheets ?? [];

  if (listy.length > 0) {
    /**
     * Оговорка про листы стоит РЯДОМ с листами, а не в конце промпта.
     *
     * Прочитанное с чертежа выглядит как измеренное: «39 395 мм» на картинке
     * ничем не отличается от «39 395 мм» из расчётного модуля. Разница в том,
     * что первое прочитала модель — и на замере она же прочитала «315 кВт» как
     * «31,5». Предупреждение, отложенное в конец, читается после того, как
     * вывод уже сложился.
     */
    lines.push(
      `ЛИСТЫ РАБОЧЕЙ ДОКУМЕНТАЦИИ (${listy.length} шт., изображения ниже): ` +
        (input.designSheetLabels ?? []).join("; "),
      "  Это СХЕМЫ И ЧЕРТЕЖИ. С них можно взять состав, связи, привязки и подписанные размеры.",
      "  ВСЁ, ВЗЯТОЕ С ЛИСТА, — ОРИЕНТИР, А НЕ ФАКТ: подпись на чертеже читается распознаванием",
      "  и может быть прочитана неверно. Каждое такое наблюдение обязано попасть в открытые",
      "  вопросы человеку со сверкой по листу, а не в основание как измеренная величина.",
      "  Числа расчёта берутся ТОЛЬКО из расчётного модуля выше.",
      "",
    );
  }

  if (input.reversal.length > 0) {
    lines.push("РЕВЕРС ОБЪЁМА (посчитан расчётным модулем, Д-7):");

    for (const group of input.reversal) {
      lines.push(
        `  ${group.table}: база ${group.baseQuantity} ${group.unit}, ` +
          `блок ${group.totalQuantity} ${group.unit}, ${group.totalAmount} ₽`,
      );
      // Допущение о базе идёт РЯДОМ с базой, а не отдельным блоком в конце:
      // прочитанное через экран число уже успеет стать фактом.
      lines.push(`    допущение: ${group.assumption}`);

      if (group.flagged.length > 0) {
        lines.push(
          "    кратность выше двух: " +
            group.flagged
              .map((position) => `поз. ${position.ordinal} ×${position.multiple ?? "?"}`)
              .join(", "),
        );
      }
    }

    lines.push(`  сумма объёмов без геометрического обоснования: ${input.unjustifiedAmount} ₽`, "");
  } else {
    lines.push("РЕВЕРС ОБЪЁМА: линейных групп с кратностью не найдено.", "");
  }

  lines.push("СОСТАВ РАБОТ ПО ТАБЛИЦАМ НОРМ:");
  for (const group of input.workGroups) {
    lines.push(
      `  ${group.table} «${group.name}» — позиций ${group.count}, ` +
        `${group.totalQuantity} ${group.unit}, ${group.totalAmount} ₽`,
    );
  }

  lines.push(
    "",
    "ЗАДАЧА.",
    "1. Сверь СОСТАВ (Д-3): нет ли работ, количество которых не согласуется",
    "   между собой — оборудование против подводок, монтаж против наладки.",
    "2. Проверь ПОЛНОТУ (Д-4): назови, чего в составе ОТСУТСТВУЕТ, хотя должно",
    "   быть по характеру описанных работ. Отсутствие не означает «не нужно».",
    "   Это главное, чего не может расчётный модуль: он проверяет то, что есть.",
    "3. Объясни инженерный смысл найденных кратностей: это ошибка объёма,",
    "   несколько участков или иное техническое решение.",
    "",
    "Числа НЕ пересчитывай: они посчитаны расчётным модулем и переданы выше.",
    "В impactOrdinal указывай порядковый номер позиции, к которой относится",
    "замечание, либо пустую строку.",
    "Допущения и требующее проверки помещай в openQuestions с владельцем и сроком.",
  );

  return lines.join("\n");
}

/**
 * Суммы влияния Денчика.
 *
 * Берутся из групп РЕВЕРСА: это единственные числа, которые расчётный модуль
 * посчитал для его предмета. Сумма группы относится ко всей группе, поэтому
 * назначается каждой её флагованной позиции — без геометрии не обоснован ни
 * один метр группы, а не только превышение над базой.
 */
function evidenceOf(input: TechOpinionAgentInput): AgentEvidence {
  const amounts = new Map<string, { amount: string; row: number }>();

  for (const group of input.reversal) {
    for (const position of group.flagged) {
      // Строка неизвестна: реверс работает с порядковыми номерами позиций, а
      // не со строками книги. Ноль честнее выдуманного номера — он не
      // притворяется ссылкой на конкретную строку.
      // Денег у группы может не быть — смета без стоимостной части. Тогда
      // позиция в этот свод не попадает: свод существует ради денежного веса.
      if (group.totalAmount !== undefined) {
        amounts.set(position.ordinal, { amount: group.totalAmount, row: 0 });
      }
    }
  }

  return {
    amounts,
    sourceId: input.documentPath,
    contentHash: input.contentHash,
    sheet: "ЛСР",
  };
}

export function createTechOpinionOperation(deps: TechOpinionDeps) {
  return createAgentOperation<TechOpinionAgentInput>({
    definition: RUN_TECH_OPINION,
    prompt: deps.prompt,
    ...(deps.referenceBase === undefined ? {} : { referenceBase: deps.referenceBase }),
    ...(deps.requiredSections === undefined ? {} : { requiredSections: deps.requiredSections }),
    buildPrompt,
    evidence: evidenceOf,
    images: (input) => input.designSheets ?? [],
    accuracy: (input) => deps.accuracyMarker({ hasDesignDocuments: input.hasDesignDocuments }),
    runAgent: deps.runAgent,
  });
}
