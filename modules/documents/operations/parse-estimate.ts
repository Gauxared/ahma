/**
 * Разбор сметы как первоклассная операция (ADR-R-022).
 *
 * До этого разбор был функцией, которую вызывал тест. Операцией он становится
 * ради четырёх точек входа: полная Проверка, подграф, одиночный вызов и
 * обслуживание. Без этого невозможно ни частичное исполнение, ни прогон корпуса
 * пакетом.
 *
 * Справочник канонических позиций объявлен НЕОБЯЗАТЕЛЬНОЙ способностью. Это не
 * послабление: разобрать смету можно и без каталога, просто все позиции окажутся
 * несопоставленными. Разница между «не смогли» и «не с чем сопоставлять»
 * фиксируется деградацией в артефакте, а не молчанием (ADR-R-026, ТЗ §9).
 */
import type {
  DocumentSource,
  IsoDate,
  MappedPosition,
  MappingSummary,
  OperationDefinition,
  Sha256,
} from "@contracts/index.js";

import { parseAnyEstimate } from "../parsers/any-estimate.js";
import { LsrParseError, parseLsr } from "../parsers/grand-smeta.js";
import type { LsrDocument, LsrPosition } from "../parsers/grand-smeta.js";
import type { LsrForm, ParseIssue } from "../parsers/grand-smeta.js";
import type { Sheet } from "../sheet.js";

export const CANONICAL_ITEMS = "canonical_items";
/** Сырьё: локальные сметные расчёты в папке объекта. Даёт источник. */
export const ESTIMATE_DOCUMENTS = "estimate_documents";
/** Извлечённое: позиции смет. Даёт эта операция. */
export const ESTIMATE_POSITIONS = "estimate_positions";

export const PARSE_ESTIMATE: OperationDefinition = {
  id: "parse-estimate",
  version: 1,
  kind: "io",
  variants: [],
  // Разбор требует ДОСТУПА к сметным документам объекта — это и есть сырьё,
  // которое даёт источник `object-documents`. Позиции разбор не требует, а
  // производит: они в `provides`.
  //
  // Раньше здесь стояло `requires: []` с пояснением «разбор не требует знаний:
  // он читает документ». Из-за этого область знания оставалась декоративной —
  // выключение источника ничего не останавливало, потому что операции нечего
  // было у него требовать.
  requires: [ESTIMATE_DOCUMENTS],
  // Без каталога позиции не с чем сопоставлять — это деградация, не отказ.
  optional: [CANONICAL_ITEMS],
  provides: [ESTIMATE_POSITIONS],
  preconditions: [],
};

export interface ParseEstimateInput {
  readonly documentPath: string;
}

export interface ParsedSection {
  readonly number: string;
  readonly name: string;
  readonly declaredTotal: string | undefined;
  readonly positions: readonly MappedPosition[];
}

export interface ParseEstimateBody {
  readonly form: LsrForm;
  readonly sheet: string;
  readonly documentPath: string;
  readonly sections: readonly ParsedSection[];
  readonly declaredTotal: string | undefined;
  readonly headerTotalThousands: string | undefined;
  /** В смете НЕТ СТОИМОСТНОЙ ЧАСТИ: объёмы есть, денежных колонок нет. */
  readonly withoutPrices: boolean;
  readonly summary: MappingSummary;
  readonly issues: readonly ParseIssue[];
}

export interface LoadedDocument {
  /**
   * ВСЕ ЛИСТЫ КНИГИ, А НЕ ПЕРВЫЙ.
   *
   * Здесь стоял один `sheet`, и это молча означало «лист номер один». Книга, у
   * которой первым идёт титул или расчёт индексов, а смета лежит вторым листом,
   * объявлялась не сметой — при живом разборе, который прочёл бы её без единой
   * правки. Какой лист смета, знает разбор, а не читатель.
   */
  readonly sheets: readonly Sheet[];
  /**
   * ОТКУДА ВЗЯЛИСЬ ЯЧЕЙКИ. `ячейки` — книга или таблица Word: что в ячейке
   * написано, то и прочитано. `раскладка` — текст PDF, где ячеек нет вовсе:
   * границы колонок восстановлены по просветам, а сам текст бывает распознан со
   * скана. Разница решает, можно ли верить прочитанным числам без проверки, и
   * поэтому она приезжает сюда, а не выводится из имени листа.
   */
  readonly ячейки?: "ячейки" | "раскладка";
  readonly contentHash: Sha256;
}

/**
 * Сопоставление позиции живёт в модуле канонизации, но разбор не имеет права
 * его импортировать: между модулями ходит только узкая талия (ADR-R-025).
 * Поэтому сопоставитель приходит зависимостью, а связывает их композиционный
 * корень — единственное место, где части системы знают друг о друге.
 */
export type PositionMapper = (position: LsrPosition, source: DocumentSource) => MappedPosition;

export type MappingSummarizer = (positions: readonly MappedPosition[]) => MappingSummary;

export interface ParseEstimateDeps {
  readonly loadDocument: (path: string) => Promise<LoadedDocument>;
  readonly mapPosition: PositionMapper;
  readonly summarize: MappingSummarizer;
  readonly today: () => IsoDate;
}

export function createParseEstimateOperation(deps: ParseEstimateDeps) {
  return {
    definition: PARSE_ESTIMATE,
    run: async (input: ParseEstimateInput) => {
      const loaded = await deps.loadDocument(input.documentPath);
      const { sheets, contentHash } = loaded;
      const { lsr, прочие } = выбратьЛист(sheets, loaded.ячейки === "раскладка");
      const checkedAt = deps.today();

      const source = {
        sourceId: input.documentPath,
        contentHash,
        sheet: lsr.sheet,
        checkedAt,
      };

      const sections: ParsedSection[] = lsr.sections.map((section) => ({
        number: section.number,
        name: section.name,
        declaredTotal: section.declaredTotal,
        positions: section.positions.map((position) => deps.mapPosition(position, source)),
      }));

      const body: ParseEstimateBody = {
        form: lsr.form,
        sheet: lsr.sheet,
        documentPath: input.documentPath,
        sections,
        declaredTotal: lsr.declaredTotal,
        headerTotalThousands: lsr.headerTotalThousands,
        withoutPrices: lsr.withoutPrices,
        summary: deps.summarize(sections.flatMap((section) => section.positions)),
        issues: прочие.length === 0 ? lsr.issues : [...lsr.issues, {
          severity: "warning" as const,
          message:
            `в книге разобран лист «${lsr.sheet}»; позиции есть и на других листах ` +
            `(${прочие.join(", ")}) — они дошли до ролей текстом книги, но в позиции не сведены: ` +
            "у каждого листа свой заявленный итог, и сложить их значило бы посчитать смету дважды",
        }],
      };

      // Хэш содержимого прочитанного документа — единственный вход операции
      // (ADR-R-027): состав базы не копируем, записываем использованное.
      return { body, inputHashes: [contentHash] as readonly Sha256[] };
    },
  };
}

/**
 * КАКОЙ ЛИСТ КНИГИ — СМЕТА.
 *
 * ПОРЯДОК ПОПЫТОК НЕ ПРОИЗВОЛЕН. Сначала форма приказа 421/пр на каждом листе:
 * у неё колонки НАЗВАНЫ документом, и читать их догадкой, когда есть форма, —
 * значит менять надёжное на правдоподобное. Только если формы нет ни на одном
 * листе, лист читается по шапке колонок (`any-estimate.ts`).
 *
 * ПОБЕЖДАЕТ ЛИСТ С НАИБОЛЬШИМ ЧИСЛОМ ПОЗИЦИЙ. Титул и расчёт индексов тоже
 * бывают таблицами, но позиций в них единицы.
 *
 * ОСТАЛЬНЫЕ РАЗОБРАННЫЕ ЛИСТЫ НЕ ЗАМАЛЧИВАЮТСЯ. Они не сводятся в один
 * документ — у каждого свой заявленный итог, и сложение задвоило бы смету, —
 * но их имена уходят замечанием, чтобы человек знал, что в книге есть ещё.
 */
function выбратьЛист(
  sheets: readonly Sheet[],
  требоватьАрифметику: boolean,
): { readonly lsr: LsrDocument; readonly прочие: readonly string[] } {
  if (sheets.length === 0) throw new LsrParseError("в книге нет ни одного листа", "книга");

  const позиций = (документ: LsrDocument): number =>
    документ.sections.reduce((sum, section) => sum + section.positions.length, 0);

  let перваяОшибка: unknown;

  const разборы = [parseLsr, (sheet: Sheet) => parseAnyEstimate(sheet, { требоватьАрифметику })];

  for (const разбор of разборы) {
    const удачные: LsrDocument[] = [];

    for (const sheet of sheets) {
      try {
        const документ = разбор(sheet);
        if (позиций(документ) > 0) удачные.push(документ);
      } catch (cause) {
        перваяОшибка ??= cause;
      }
    }

    if (удачные.length === 0) continue;

    const лучший = удачные.reduce((left, right) => (позиций(right) > позиций(left) ? right : left));
    return { lsr: лучший, прочие: удачные.filter((d) => d !== лучший).map((d) => d.sheet) };
  }

  // Ни один лист не дал позиций. Наружу уходит ПЕРВАЯ причина: она про первый
  // лист, а именно его человек и открывает, проверяя, смета ли это.
  throw ошибкаРазбора(перваяОшибка, sheets[0]?.name ?? "книга");
}

function ошибкаРазбора(cause: unknown, sheet: string): Error {
  if (cause instanceof Error) return cause;
  return new LsrParseError("ни на одном листе книги не найдено таблицы позиций", sheet);
}
