/**
 * Порты проверки объекта — общие для командной строки, воркера и веба.
 *
 * ЗАЧЕМ ВЫНЕСЕНО
 *
 * Раньше эти порты были объявлены внутри `checkObjectCommand`, и проверку умела
 * запускать только командная строка. Воркер брал задачу из очереди и честно
 * отвечал «тип задачи не поддержан»: очередь работала, а выполнять было некому.
 *
 * Копировать порты в воркер было нельзя. Две копии разошлись бы — и разошлись бы
 * молча: проверка из веба начала бы давать не то, что проверка из командной
 * строки, а обнаружилось бы это на споре о числе в отчёте.
 *
 * ЧТО ЗДЕСЬ ЕСТЬ, А ЧЕГО НЕТ
 *
 * Здесь доступ к диску и склейка операций. Здесь НЕТ ни печати, ни выгрузок, ни
 * решения об исходе: обход и вердикт живут в `modules/workflow/check-object.ts`,
 * а порты только подают ему данные. Это та же граница, что и раньше, — просто
 * теперь она проходит между файлами, а не внутри одной функции.
 *
 * НАКОПЛЕННОЕ ОТДАЁТСЯ ОТДЕЛЬНО
 *
 * Хэши прочитанных документов и линейные позиции копятся ПО ХОДУ проверки:
 * снапшот записывает то, что прогон использовал, а не то, что лежало в папке
 * (ADR-R-027), а реверс объёма считается по уже разобранным позициям — повторный
 * разбор того же файла мог бы дать другой результат.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { isoDate } from "@contracts/index.js";
import type {
  Acquisition,
  DecimalString,
  MappedPosition,
  Money,
  Sha256,
  SourceRef,
  Valued,
} from "@contracts/index.js";
import { Decimal } from "decimal.js";

import { compareWithHeader } from "@modules/calculations/convergence.js";
import { reverseVolumes } from "@modules/calculations/volume-reversal.js";
import { buildScenarios } from "@modules/calculations/scenarios.js";
import { creditInterest } from "@modules/calculations/finance.js";
import type { FinanceModelBody } from "@modules/agents/operations/run-finance-model.js";
import type { ProcurementBody } from "@modules/agents/operations/run-procurement.js";
import { QUOTE_THRESHOLD } from "@modules/calculations/lead-time.js";
import { buildStartChecklist } from "@modules/agents/start-checklist.js";
import type { ContractAuditBody } from "@modules/agents/operations/run-contract-audit.js";
import type { ExecutiveDocsBody } from "@modules/agents/operations/run-executive-docs.js";
import type { ObjectPassportBody } from "@modules/agents/operations/run-object-passport.js";
import type { SubcontractPlanBody } from "@modules/agents/operations/run-subcontract-plan.js";
import type { VerdictAgentBody } from "@modules/agents/operations/run-verdict.js";
import type { ScheduleAgentBody } from "@modules/agents/operations/run-schedule.js";
import type { DepthMode } from "@modules/agents/depth-mode.js";
import type { TechOpinionBody } from "@modules/agents/operations/run-tech-opinion.js";
import { checkEstimate, topPositionsByShare } from "@modules/calculations/estimate-checks.js";
import { vatGap } from "@modules/calculations/vat-gap.js";
import { findCrossEstimateDuplicates } from "@modules/calculations/cross-estimate-duplicates.js";
import type { PositionForCheck } from "@modules/calculations/estimate-checks.js";
import type { EstimateReviewBody } from "@modules/agents/operations/run-estimate-review.js";
import { sumObjectTotals } from "@modules/calculations/object-total.js";
import type { LinearPosition } from "@modules/calculations/volume-reversal.js";
import { detectFormat } from "@modules/documents/format-detector.js";
import type { ParseEstimateBody } from "@modules/documents/operations/parse-estimate.js";
import { LsrParseError } from "@modules/documents/parsers/grand-smeta.js";
import { parseSsrss } from "@modules/documents/parsers/ssrss.js";
import { parseCostElements } from "@modules/documents/parsers/cost-elements.js";
import type { CheckConvergenceBody, EstimateForConvergence } from "@modules/calculations/operations/check-convergence.js";
import type {
  CheckObjectPorts,
  CheckProgress,
  DocumentKind,
  DocumentReviewer,
  ObjectReviewer,
  ReviewFinding,
  SynthesisReviewer,
} from "@modules/workflow/check-object.js";
import { AGENT_CONCURRENCY, mapWithLimit, NotAnEstimate } from "@modules/workflow/check-object.js";
import { awaitingParser, classifyDocument } from "@modules/workflow/classify-document.js";
import {
  DESIGN_TEXT_BUDGET,
  briefOf,
  briefToPrompt,
  type DesignDocument,
} from "@modules/documents/design-documents.js";
import type { ParserRegistry } from "@modules/documents/parser-registry.js";

import type { Platform } from "../bootstrap.js";
import type { TextPayload } from "../storage/adapters.js";
import { renderAllPages, renderDesignSheets, type DesignSheet } from "../storage/design-sheets.js";
import { expandArchiveInPlace } from "../storage/archive-expander.js";
import { imageAsSheet, imageMime } from "../storage/image-sheet.js";
import { extractByVision, visionBrief, VISION_PAGE_SCHEMA, VISION_PROMPT } from "@modules/documents/vision-extract.js";
import { anonymize } from "../security/anonymizer.js";
import { layoutSheet } from "@modules/documents/layout-sheet.js";
import { parseAnyEstimate } from "@modules/documents/parsers/any-estimate.js";

import { readSheetOf, detectFileFormat, parsableSheetFormats } from "../storage/sheet-reader.js";
import { rowNumbers } from "@modules/documents/sheet.js";
import { readAnything } from "../storage/universal-reader.js";
import { fileContentHash, listXlsxSheets, readXlsxExtras } from "../storage/xlsx-reader.js";

/** Документ, накопленный по ходу проверки: путь и хэш прочитанного содержимого. */
export interface ReadDocument {
  readonly path: string;
  readonly contentHash: string;
}

/**
 * Извлечённая строка сметы в форме, пригодной для сохранения.
 *
 * Отдельно от `LinearPosition`: та принадлежит контракту расчётного модуля и
 * несёт то, что нужно реверсу объёма. Здесь нужны раздел и СТРОКА ЛИСТА — без
 * строки число в таблице позиций нечем открыть, и §12.1д превращается в
 * обещание.
 */
export interface ExtractedRow {
  readonly document: string;
  readonly ordinal: string;
  readonly section: string;
  readonly sourceName: string;
  readonly basis: string;
  readonly unit: string;
  readonly quantity?: string | undefined;
  /** Пусто — сумма неизвестна (смета без стоимостной части), а не равна нулю. */
  readonly amount: string | undefined;
  readonly sourceRow: number;
  /**
   * КАК ПОЗИЦИЯ ПОЛУЧЕНА — Т11. Пусто означает `parsed`: разбор формы 421/пр.
   *
   * Позиция от роли (`agent_normalized`) считается наравне — в сходимости, в
   * гейтах, в дублях, — но помечается отдельно: структуру назвала модель.
   * Смешать их молча значило бы выдать распознанное за разобранное.
   */
  readonly acquisition?: Acquisition | undefined;
  /** Лист, на котором стоит строка. У формы 421/пр он один, у произвольной книги — нет. */
  readonly sheet?: string | undefined;
  /**
   * СТРОКА — ИТОГ ДОКУМЕНТА, А НЕ ПОЗИЦИЯ.
   *
   * ЗАМЕРЕНО НА ПРОГОНЕ 16: из 144 позиций объекта пятнадцать оказались
   * итоговыми строками — «Всего с НДС 413 072 947 ₽», «Итого без НДС
   * 338 584 383 ₽», «Итого до непредвиденных 328 722 702 ₽». Роль выписала их
   * добросовестно: в документе это строки с суммой, как и все остальные.
   *
   * ЧЕМ ЭТО ОПАСНО. Итог — это СУММА позиций, и положить его рядом с ними
   * значит посчитать документ дважды: свод «из чего объект состоит» показал бы
   * «Всего с НДС» самой дорогой работой объекта, а сходимость дала бы
   * расхождение размером в стоимость объекта.
   *
   * ПОЧЕМУ НЕ ОТБРАСЫВАЕМ. Итог, прочитанный ролью, — ценное число: им
   * сверяется сходимость, и в таблице позиций он виден человеку. Отбрасывается
   * не строка, а её участие в ДЕНЕЖНЫХ СВОДАХ.
   */
  readonly total?: boolean | undefined;
}

/** Документ в форме, пригодной для записи версии. */
export interface ReadDocumentDescriptor extends ReadDocument {
  readonly fileName: string;
  readonly kind: string;
  readonly mimeType: string;
  readonly byteSize: number;
}

/** То, что проверка собрала попутно. Нужно снапшоту, реверсу объёма и записи. */
export interface CollectedDuringCheck {
  readonly documentHashes: readonly ReadDocument[];
  readonly linearPositions: readonly (LinearPosition & { document: string })[];
  /** Строки для таблицы позиций (§5.5). Пусто, если разбор не выполнялся. */
  readonly extracted: readonly ExtractedRow[];
  /**
   * ПРИЁМ ПОЗИЦИЙ, НОРМАЛИЗОВАННЫХ РОЛЬЮ — Т11.
   *
   * Роли работают ПОСЛЕ обхода, а межсметный дубль, запись позиций, реверс
   * объёма и книги пакета читают этот же накопитель ПОСЛЕ ролей. Поэтому
   * позиция, поднятая ролью из документа вне формы 421/пр, попадает сюда и
   * дальше считается наравне с разобранной — решение владельца 08.09.2026.
   *
   * Явный приёмник, а не запись в массив снаружи: накопитель принадлежит
   * обходу, и правка его со стороны выглядела бы как совпадение ссылок.
   */
  readonly absorb?: (rows: readonly ExtractedRow[]) => void;
  readonly descriptors: readonly ReadDocumentDescriptor[];
  /** Текстовый слой рабочей документации объекта. Пусто, если её нет. */
  readonly designDocuments: readonly DesignDocument[];
  /**
   * Листы рабочей документации КАРТИНКОЙ — «понимать схемы и чертежи».
   *
   * Текстовый слой отдаёт подписи, но не связи между ними: на структурной
   * схеме электроснабжения текстом видно «150м» и «ШК 3.1» россыпью, а чем
   * какой шкаф питается — только на изображении.
   *
   * Рендерятся ОДИН раз на прогон, а не на смету: подшивка относится к
   * объекту, и три листа стоят четыре секунды на подшивку.
   */
  readonly designSheets: readonly DesignSheet[];
}

/**
 * Вид документа по ИМЕНИ И СОДЕРЖИМОМУ.
 *
 * Обход папки объекта раньше опирался только на имя: всё, что не `.xlsx`,
 * объявлялось рабочей документацией. Скан сметы и выгрузка в старом двоичном
 * формате попадали туда же — и пропускались без основания. Теперь у каждого
 * пропуска есть причина, взятая из содержимого файла.
 */
export async function describeDocument(
  path: string,
  name: string,
  /**
   * Реестр текстовых адаптеров: он же держит границу §14 по сканам.
   *
   * Параметром, а не импортом: реестр собирается в композиционном корне вместе
   * с библиотеками чтения (ADR-R-025), а обход о библиотеках не знает.
   *
   * ОБЯЗАТЕЛЬНЫЙ, а не необязательный. Сначала он был необязательным — и это
   * был механизм, который можно молча не подключить: вызов без реестра
   * пропускал границу §14, и скан сметы становился рабочей документацией без
   * единого признака. Ровно от этого веха Д1б и заведена.
   */
  registry: ParserRegistry,
): Promise<{
  path: string;
  kind: ReturnType<typeof classifyDocument>;
  reason?: string;
  /**
   * Текстовый слой рабочей документации — веха «текст РД доходит до агентов».
   *
   * Он читался и ВЫБРАСЫВАЛСЯ: разбор вызывался только затем, чтобы проверить
   * границу §14, и результат не сохранялся. Отсюда спор агентов на экране —
   * паспорт объекта ссылался на подшивку PDF, а техническое заключение в том
   * же прогоне писало «геометрия РД отсутствует».
   *
   * §14 исключает распознавание СКАНОВ, а не чтение текстового слоя. Скан
   * по-прежнему отвергается: у него слоя нет, и порог в 100 знаков на страницу
   * его отделяет.
   */
  text?: { readonly text: string; readonly pages: number };
}> {
  let detection: { supported: boolean; reason?: string; format?: string };

  try {
    detection = await detectFileFormat(path, name);
  } catch (cause) {
    // Нечитаемый файл — это находка, а не повод оборвать обход папки.
    detection = { supported: false, reason: `файл не прочитан: ${(cause as Error).message}` };
  }

  /**
   * ТЕКСТОВЫЕ ДОКУМЕНТЫ ЧИТАЕТ РЕЕСТР, И ГРАНИЦУ §14 ДЕРЖИТ ОН ЖЕ.
   *
   * Здесь стояла своя проверка текстового слоя PDF — то есть правило §14 было
   * записано дважды: в `ParserRegistry` и тут. Две записи одного правила
   * расходятся, и расходятся молча; а сам реестр при этом не создавался в
   * продакшене ни разу — механизм без потребителя (веха Д1б).
   *
   * Файл читается ЦЕЛИКОМ, и это неизбежно: сигнатура `%PDF` одинакова у
   * чертежа и у скана, а отличие — в текстовом слое, о котором по восьми
   * килобайтам не узнать. Цена — секунды на файл при обходе, идущем минуты.
   */
  //
  // СПИСОК ФОРМАТОВ СПРАШИВАЕТСЯ У РЕЕСТРА, А НЕ ПОВТОРЯЕТСЯ ЗДЕСЬ. Он здесь
  // был записан литералом `pdf || docx` — четвёртой по счёту истиной о том,
  // что система умеет читать, и разошёлся бы с реестром в день, когда в него
  // добавят адаптер: файл читался бы реестром и не спрашивался обходом, то
  // есть текст пропадал бы молча. Именно так пропали бы `.txt` и XML.
  //
  // `format` необязателен: у нечитаемого файла его нет вовсе, и такой обязан
  // не совпасть ни с чем, а не сравняться с первым форматом реестра.
  /**
   * ИЗОБРАЖЕНИЕ — СКАН, а не «не разобран» (А11). PNG и JPG в комплекте
   * заказчика — фотографии актов, сканы писем, снимки чертежей. Читаются они
   * тем же путём, что PDF без текстового слоя: зрением, с уровнем доверия
   * «ориентир», — и лежат в рабочей папке экипажа картинкой.
   */
  if (detection.format === "скан-изображение") {
    return {
      path,
      kind: "скан" as const,
      reason: "изображение: читается распознаванием, уровень доверия «ориентир»",
    };
  }

  const текстовый = (registry.supportedFormats() as readonly string[]).includes(
    detection.format ?? "",
  );

  let текстСлоя: { readonly text: string; readonly pages: number } | undefined;

  if (detection.supported && текстовый) {
    try {
      const parsed = await registry.parse({ fileName: name, bytes: await readFile(path) });

      if (parsed.status === "отказ") {
        /**
         * СКАН БОЛЬШЕ НЕ ОТКАЗ (Т2.2б).
         *
         * До 6 сентября 2026 PDF без текстового слоя был отказом со ссылкой на
         * §14 договора, исключающий распознавание. Владелец снял это
         * ограничение: распознавание — ключевое требование к системе, и его
         * надо выполнить, даже если распознаёт внешняя модель.
         *
         * Документ помечается «скан» и уходит на распознавание зрением ниже, в
         * обходе. Здесь только помечается: рендер страниц и обращение к модели
         * стоят секунд, и делать их в определении вида документа значило бы
         * платить за них при каждом обходе, включая те, где зрение выключено.
         */
        const скан = parsed.reason?.includes("без текстового слоя") === true;

        return {
          path,
          kind: скан ? ("скан" as const) : ("не-разобран" as const),
          reason: скан
            ? "PDF без текстового слоя: читается распознаванием, уровень доверия «ориентир»"
            : (parsed.reason ?? `разбор ${parsed.format} не удался, причина не названа`),
        };
      }

      /**
       * Прочитанное СОХРАНЯЕТСЯ.
       *
       * Раньше результат разбора отбрасывался сразу после проверки §14 — файл
       * читался целиком и терялся целиком.
       *
       * Разбирается по полям, а не приводится типом: `payload` объявлен как
       * `unknown`, потому что реестр не знает, что кладут адаптеры, и
       * приведение выдало бы чужую структуру за свою.
       */
      const payload = parsed.payload as Partial<TextPayload> | undefined;

      if (payload?.kind === "текст" && typeof payload.text === "string" && payload.text.trim() !== "") {
        текстСлоя = { text: payload.text, pages: typeof payload.pages === "number" ? payload.pages : 1 };
      }
    } catch (cause) {
      return {
        path,
        kind: "не-разобран" as const,
        reason: `документ не прочитан: ${(cause as Error).message}`,
      };
    }
  }

  const parsable = parsableSheetFormats();
  const определённый = classifyDocument(name, detection, parsable);

  /**
   * PDF, В КОТОРОМ ЕСТЬ ТАБЛИЦА СМЕТЫ, — СМЕТА, А НЕ РАБОЧАЯ ДОКУМЕНТАЦИЯ.
   *
   * Классификатор судит по формату и имени, и по ним PDF всегда документ:
   * иначе сметой стал бы каждый чертёж комплекта, а их сотни. Но смета,
   * выгруженная в PDF, — обычное дело, и позиций из неё не выходило вовсе.
   *
   * Решает СОДЕРЖИМОЕ: таблица читается по раскладке колонок и признаётся
   * только если её подтвердила арифметика самого документа — количество × цена
   * = сумма (`any-estimate.ts`). Скан, распознанный с искажением цифр, этой
   * проверки не проходит и остаётся документом, каким и был.
   */
  const kind =
    определённый === "рабочая-документация" && detection.format === "pdf" && текстСлоя !== undefined
      ? (сметаВТексте(текстСлоя.text, name) ? ("лср" as const) : определённый)
      : определённый;

  // Причина от детектора формата ГЛАВНЕЕ: «файл не открыть» точнее, чем «нет
  // адаптера». Если детектор молчит, причину даёт отсутствие разбора — иначе
  // «не разобран» приехал бы на экран без объяснения.
  const reason = detection.reason ?? awaitingParser(detection.format, parsable);

  return {
    path,
    kind,
    ...(reason === undefined ? {} : { reason }),
    ...(текстСлоя === undefined ? {} : { text: текстСлоя }),
  };
}

/**
 * Есть ли в тексте PDF таблица сметы, подтверждённая арифметикой документа.
 *
 * Разбор здесь ОДНОРАЗОВЫЙ и только ради ответа «да/нет»: позиции берёт
 * операция разбора, чтобы у реестра и у проверки был один источник чисел.
 */
function сметаВТексте(text: string, name: string): boolean {
  try {
    const документ = parseAnyEstimate(layoutSheet(text, name), { требоватьАрифметику: true });
    return документ.sections.some((section) => section.positions.length > 0);
  } catch {
    // Таблицы нет либо арифметика её не подтвердила — это рабочая документация.
    return false;
  }
}

/**
 * ПОТОЛОК ОДНОВРЕМЕННОСТИ ОБХОДА.
 *
 * Тот же по смыслу, что у агентов (Д5), и по той же причине: цена ошибки на
 * четырёх файлах и на трёхстах разная, и владелец контура вправе назначить
 * своё число под свою машину.
 */
export function потолокОбхода(): number {
  const названный = Number.parseInt(process.env["STROYINTELLECT_WALK_CONCURRENCY"] ?? "", 10);

  return Number.isFinite(названный) && названный > 0 ? названный : AGENT_CONCURRENCY;
}

/**
 * Описание найденных файлов — С ПОТОЛКОМ, а не все разом.
 *
 * ЧТО ЭТО ЗАКРЫВАЕТ
 *
 * Здесь стоял `Promise.all` по всему списку. На четырёх файлах это незаметно;
 * на партии из двухсот открывается двести файлов ОДНОВРЕМЕННО, и каждый PDF,
 * docx, txt и XML при этом читается ЦЕЛИКОМ: `describeDocument` обязан
 * отличить чертёж от скана, а по восьми килобайтам этого не узнать.
 *
 * Двести чертежей курганского размера — это около 860 МБ в одних только
 * буферах, до всякого разбора. Воркер идёт с потолком кучи 1 ГБ. То есть
 * штатный вход из брифа — «сто смет одним ZIP» — упирался в потолок не из-за
 * объёма данных, а из-за того, что мы читали их все сразу.
 *
 * Замерено на партии в 200 файлов: пик RSS воркера 1087 МБ при потолке кучи
 * 1024 МБ. Прогон выжил, но запас был отрицательным, а дверь пускает до
 * трёхсот файлов.
 *
 * Вынесено отдельной функцией не ради красоты: потолок, спрятанный внутри
 * композиционного корня, нельзя ни проверить, ни увидеть. Гейт считает
 * одновременность именно здесь.
 */
export async function описатьНайденное<T, R>(
  found: readonly T[],
  описать: (entry: T) => Promise<R>,
  limit = потолокОбхода(),
): Promise<R[]> {
  return mapWithLimit(found, limit, async (entry) => описать(entry));
}

/**
 * Документ позиции и его отпечаток — для ссылки «откуда взято».
 *
 * ЗАЧЕМ ОТДЕЛЬНЫМ РАСЧЁТОМ. Объектные агенты — снабженец, договорник,
 * подрядчик, исполнительная — получают позиции ИЗ РАЗНЫХ СМЕТ, а источник у
 * них был один на всех: путь папки объекта и отпечаток ПЕРВОГО документа
 * обхода (`documentHashes[0]`). Замерено на курганском прогоне: 63 замечания
 * из 72 с координатой приходили от этих агентов, то есть у 63 из 72 ссылка
 * называла не тот файл. Переход при этом работал и в двадцати случаях приводил
 * в «строки не нашлось», а в остальных мог показать чужую строку как источник.
 *
 * Отпечаток берётся по пути документа; неизвестный документ оставляет поля
 * пустыми, и агент честно падает на общий источник, а не получает выдуманный.
 */

/**
 * Строка листа, откуда взята позиция, — провенанс §12.1д.
 *
 * ИСТОЧНИК НЕ ОБЯЗАН БЫТЬ СУММОЙ. Раньше строка читалась только из провенанса
 * суммы, и у сметы без стоимостной части ссылка на исходник терялась целиком:
 * позиция есть, а «где смотреть» — нет. Между тем объём взят из той же строки
 * и несёт тот же провенанс.
 *
 * Ноль означает «строка неизвестна», а не «строка нулевая»: подставить сюда
 * догадку значило бы выдать выдуманную ссылку за настоящую.
 */
/**
 * Позиции С ИЗВЕСТНОЙ СУММОЙ — денежные своды строятся только по ним.
 *
 * Своды по таблицам норм ранжируют работы деньгами: «из чего объект состоит»,
 * «самая дорогая позиция группы», «кандидаты в пакеты закупки». В смете без
 * стоимостной части сумм нет, и подстановка нуля превратила бы всё это в
 * ровный список нулей, где крупное неотличимо от мелкого.
 *
 * Пустой свод честнее: почему он пуст, объясняет отдельная находка «смета без
 * стоимостной части», которую обход выдаёт по такому документу.
 */
function сСуммой<T extends { readonly amount?: string | undefined; readonly total?: boolean | undefined }>(
  positions: readonly T[],
): readonly (T & { amount: string })[] {
  return positions.filter(
    (position): position is T & { amount: string } =>
      // Итоговая строка в денежный свод не идёт: она и есть сумма остальных, и
      // рядом с ними считалась бы вторым разом (см. `total`).
      position.amount !== undefined && position.total !== true,
  );
}

/**
 * Уточняет вид документа в РЕЕСТРЕ, когда разбор узнал правду.
 *
 * НАЙДЕНО ПОВТОРНЫМ ПРОГОНОМ: поправка «книга-не-смета» изменила результат
 * обхода и НЕ изменила запись в базе. Вид в реестр пишется при обходе папки,
 * до разбора, — то есть по догадке классификатора по имени файла. На экране
 * «Документы объекта» девятнадцать счетов поставщика так и остались «лср».
 *
 * Расхождение экрана с результатом — худший исход правки: она выглядит
 * сделанной и не сделана. Поэтому вид уточняется здесь, где известны обе
 * истины: и первичная догадка, и вердикт разбора.
 */
function уточнитьВид(
  descriptors: ReadDocumentDescriptor[],
  path: string,
  kind: DocumentKind,
): void {
  const index = descriptors.findIndex((descriptor) => descriptor.path === path);
  if (index < 0) return;

  descriptors[index] = { ...descriptors[index]!, kind };
}

function строкаПозиции(position: MappedPosition): number {
  for (const значение of [position.amount, position.quantity, position.unitPrice]) {
    if (значение === undefined) continue;
    const { provenance } = значение;
    if (provenance.kind === "source" && provenance.ref.locator.kind === "row") {
      return provenance.ref.locator.row;
    }
  }

  return 0;
}

function источникПозиции(
  collected: CollectedDuringCheck,
  document: string,
): { document?: string; documentHash?: Sha256 } {
  const hash = collected.documentHashes.find((entry) => entry.path === document)?.contentHash;

  return hash === undefined ? {} : { document, documentHash: hash as Sha256 };
}

/**
 * Приведение разобранной сметы ко входу проверки сходимости.
 *
 * Используется и портами, и командной строкой, поэтому вынесено наружу: две
 * копии этого преобразования разошлись бы в том, какие итоги считать
 * объявленными.
 */
export function toConvergenceInput(
  parsed: ParseEstimateBody,
  documentPath: string,
  contentHash: Sha256,
): EstimateForConvergence {
  return {
    documentPath,
    contentHash,
    sections: parsed.sections.map((section) => ({
      number: section.number,
      name: section.name,
      declaredTotal: section.declaredTotal,
      // `undefined` доходит до расчёта намеренно: сходимость обязана увидеть
      // неизвестное, а не получить ноль вместо него.
      positionTotals: section.positions.map((position) => position.amount?.value.amount),
    })),
    declaredTotal: parsed.declaredTotal,
    headerTotalThousands: parsed.headerTotalThousands,
  };
}


/**
 * Собирает порты проверки.
 *
 * `withAgent` включает обзор сметчика: он требует зарегистрированной операции и
 * доступной модели, поэтому включается решением вызывающего, а не наличием
 * переменных окружения.
 */
/**
 * Сколько листов подшивки уходит роли. Шестьдесят, а не три: экипаж смотрит их
 * сам, и урезание за него — потеря, а не экономия (замер: у «CNTR» 59 листов
 * чертежей, до роли доходило 12).
 */
const SHEETS_PER_DOCUMENT = Number.parseInt(process.env["STROYINTELLECT_DESIGN_SHEETS"] ?? "60", 10);

export function buildCheckPorts(input: {
  readonly platform: Platform;
  readonly tenantId: string;
  readonly now: string;
  /**
   * Агенты, смотрящие каждую смету. ФАБРИКА, а не готовый список: Денчику нужны
   * позиции, собранные обходом, а обход ещё не начался в момент сборки портов.
   *
   * Накопитель отдаётся фабрике ссылкой и заполняется по ходу — к моменту, когда
   * рецензенты работают, он полон: `checkObject` запускает их ПОСЛЕ обхода.
   */
  readonly reviewers?: (collected: CollectedDuringCheck) => readonly DocumentReviewer[];
  /** Агенты, чей предмет — объект целиком. Те же соображения о фабрике. */
  readonly objectReviewers?: (collected: CollectedDuringCheck) => readonly ObjectReviewer[];
  /** Агенты синтеза: читают замечания остальных, поэтому идут последними. */
  readonly synthesisReviewers?: (collected: CollectedDuringCheck) => readonly SynthesisReviewer[];
  /**
   * Куда сообщать ход прогона (Д2). Нет — обход работает молча: командной
   * строке ход не нужен, она печатает результат сама.
   */
  readonly progress?: (event: CheckProgress) => Promise<void>;
  /**
   * Продолжать ли обход. Возврат строки означает «остановиться», и строка —
   * причина. Спрашивается на границах тактов (см. `CheckObjectPorts`).
   *
   * Нужен воркеру: потеряв аренду задачи, он обязан прекратить работу, иначе
   * платит за модель второй раз и пишет поверх того, что делает другой.
   */
  readonly stopRequested?: () => string | undefined;
}): { ports: CheckObjectPorts; collected: CollectedDuringCheck } {
  const { platform, tenantId, now } = input;

  // Накопители живут ЗДЕСЬ и отдаются наружу ссылкой: проверка заполняет их по
  // ходу, а вызывающий читает после её завершения.
  const documentHashes: ReadDocument[] = [];
  const linearPositions: (LinearPosition & { document: string })[] = [];
  const extracted: ExtractedRow[] = [];
  const descriptors: ReadDocumentDescriptor[] = [];
  /** Пути, уже заведённые в реестр: обход одного объекта идёт партиями. */
  const описанные = new Set<string>();
  const designDocuments: DesignDocument[] = [];
  const designSheets: DesignSheet[] = [];

  /**
   * Книга — текстом, для агентов.
   *
   * ЗОВЁТСЯ У ЛЮБОЙ КНИГИ, включая разобранную (Т10, решение 08.09.2026).
   * Прежде — только у той, чей разбор не удался, из опасения дать агенту два
   * описания одного. Замер показал обратную беду: удачный разбор ТЕРЯЛ больше
   * неудачного — второй лист с ведомостью объёмов, расчёт индексов, лист
   * согласований, примечания сметчика не доходили никуда.
   *
   * Плата за полноту — риск двойного счёта: роль видит строки формы в тексте и
   * может переписать их в `positions`. Он снят там, где позиции принимаются:
   * строка, уже разобранная кодом, второй раз в счёт не идёт и уходит находкой
   * (`toExtractedRows`).
   *
   * Строки склеиваются табуляцией, а не пробелом: колонки должны остаться
   * различимыми, иначе таблица превращается в поток слов, где «шт» и «2» стоят
   * рядом без связи.
   */
  const книгуТекстом = async (path: string): Promise<void> => {
    if (designDocuments.some((document) => document.path === path)) return;

    try {
      /**
       * ЧЕРЕЗ ЕДИНЫЙ ЧИТАТЕЛЬ, А НЕ СВОИМ КОДОМ — И ЭТО НЕ КОСМЕТИКА.
       *
       * Здесь стоял `readSheetOf(path)` БЕЗ ИМЕНИ ЛИСТА, то есть чтение
       * ПЕРВОГО листа книги. Замерено на боевом прогоне 08.09.2026: у книги
       * «Обоснование НМЦК.xls» 4 листа и 485 ячеек — до роли доехало 2 759
       * знаков одного листа; у «Ведомости объёмов» из 3 листов доехал один.
       *
       * Починка перечня листов, сделанная в тот же день, этот путь НЕ ЗАДЕЛА:
       * она лежала в `universal-reader`, а до Codex книга шла отсюда. Механизм
       * был написан и не подключён — то есть барьер остался стоять, а
       * отчитаться было чем. Поэтому реализация здесь ОДНА и общая: всё, что
       * умеет читатель, автоматически доезжает до роли.
       */
      const прочитано = await readAnything(path);
      const текст = прочитано.text;
      if (текст.trim() === "") return;

      // Страница здесь одна: у книги их нет, а выдумывать разбиение значило бы
      // дать сжатию текста РД ложный признак колонтитула.
      designDocuments.push({ path, pages: 1, text: `[${прочитано.how}]\n${текст}` });

      /**
       * ИЗОБРАЖЕНИЯ ИЗ КНИГИ — В ТЕ ЖЕ ЛИСТЫ, ЧТО И ЧЕРТЕЖИ (Т10).
       *
       * В книгах заказчика лежат схемы узлов, штампы и фотографии, вставленные
       * прямо на лист. Ячеек у такого листа может не быть вовсе: разбор видел
       * пустой лист и шёл дальше, а человек, открыв книгу, видел схему.
       *
       * Кладём их тем же путём, что листы чертежей PDF: тогда они доезжают до
       * рабочей папки роли и до зрения модели без единой новой ветки.
       */
      for (const name of await listXlsxSheets(path).catch(() => [] as string[])) {
        const extras = await readXlsxExtras(path, name);

        for (const [index, image] of (extras?.images ?? []).entries()) {
          const mime = image.extension === "jpeg" ? "image/jpeg" : `image/${image.extension}`;
          designSheets.push({
            document: path,
            page: index + 1,
            dataUrl: `data:${mime};base64,${image.bytes.toString("base64")}`,
            bytes: image.bytes.length,
          });
        }
      }
    } catch {
      // Книгу не открыть — она уже названа неразобранной с причиной от
      // читателя. Второй отказ здесь ничего не добавит.
    }
  };

  /**
   * ПОСЛЕДНЯЯ ПОПЫТКА — Т10: «в модель и в анализ должно попадать ВСЁ».
   *
   * Файл, которого не знает ни один читатель — чертёж САПР, база Кодекса,
   * неопознанные байты, — до сих пор доходил до роли ОДНИМ ИМЕНЕМ: в ОБЪЕКТ.md
   * стояло «только исходник», и содержимое в анализ не попадало. Формально
   * честно, по существу — потеря: в `.dwg` лежат подписи листов и штампы, в
   * `.frw` — спецификация, и человек их видит, открыв файл глазами.
   *
   * Здесь извлекается всё, что извлекается без знания формата:
   *   · контейнер ZIP (docx, xlsx, pptx, odt, сам zip) — опись вложений и текст
   *     их XML-частей: имена листов, подписи, штампы;
   *   · любой другой файл — печатные последовательности в UTF-8 и CP1251.
   *
   * ЭТО НЕ РАЗБОР, И ТАК И НАПИСАНО. Первая строка результата говорит, что
   * извлечено частично и чем: роль, прочитавшая мусор как содержание, ошибётся
   * дороже, чем роль, которой ничего не дали.
   *
   * ПОТОЛОК ОБЪЯВЛЕН. Двоичный файл даёт сколько угодно случайных
   * последовательностей, и без границы один `.dwg` вытеснил бы из хода роли
   * настоящие документы. Граница названа в тексте, а не применена молча.
   */
  /**
   * ПОСЛЕДНЯЯ ПОПЫТКА — Т10: «в модель и в анализ должно попадать ВСЁ».
   *
   * Файл, которого не знает ни один читатель — чертёж САПР, база Кодекса,
   * неопознанные байты, — до этого доходил до роли ОДНИМ ИМЕНЕМ: в ОБЪЕКТ.md
   * стояло «только исходник».
   *
   * ИЗВЛЕЧЕНИЕ ЗДЕСЬ НЕ СВОЁ, А ОБЩЕЕ. Своя копия уже однажды разошлась с
   * читателем: починка перечня листов легла в `universal-reader`, а книга
   * доезжала до Codex другим кодом — и барьер остался стоять при готовой
   * починке. Одна реализация значит, что поддержанный формат работает на всех
   * путях сразу.
   */
  const последняяПопытка = async (path: string): Promise<void> => {
    if (designDocuments.some((document) => document.path === path)) return;

    const прочитано = await readAnything(path).catch(() => undefined);
    if (прочитано === undefined) return;

    // Изображения внутри файла — в те же листы, что чертежи: их читает зрение.
    for (const [index, image] of прочитано.images.entries()) {
      const mime = image.extension === "jpeg" ? "image/jpeg" : `image/${image.extension}`;
      designSheets.push({
        document: path,
        page: index + 1,
        dataUrl: `data:${mime};base64,${image.bytes.toString("base64")}`,
        bytes: image.bytes.length,
      });
    }

    if (прочитано.text.trim() === "") return;

    designDocuments.push({
      path,
      pages: 1,
      // Способ и оговорка идут ПЕРВОЙ строкой: роль обязана видеть, чем
      // прочитано, до того как поверит содержимому.
      text:
        `[${прочитано.how}${прочитано.caveat === undefined ? "" : `; ${прочитано.caveat}`}]\n\n` +
        прочитано.text,
    });
  };

  /**
   * Начисление НДС из сводного расчёта — собирается ПО ХОДУ, как и хэши.
   *
   * Сводный расчёт читается один раз, при сверке итогов; читать его второй раз
   * ради одной строки значило бы допустить, что два чтения дадут разное.
   */
  let vatAccrual: { rate: string; amount: string; row: number } | undefined;

  /**
   * Потолок одновременности агентов — из окружения, если он там назван (Д5).
   *
   * Композиционный корень — единственное место, которое вправе знать про
   * окружение: обход о переменных не знает, у него есть порт с числом. Не
   * названо — работает объявленный в обходе `AGENT_CONCURRENCY`.
   */
  const concurrency = Number.parseInt(process.env["STROYINTELLECT_AGENT_CONCURRENCY"] ?? "", 10);

  const ports: CheckObjectPorts = {
    // Условный спред, а не `?? undefined`: при `exactOptionalPropertyTypes`
    // «порта нет» и «порт равен undefined» — разные вещи для типов.
    ...(input.progress === undefined ? {} : { progress: input.progress }),
    ...(input.stopRequested === undefined ? {} : { stopRequested: input.stopRequested }),
    ...(Number.isFinite(concurrency) && concurrency > 0 ? { concurrency } : {}),

    // Сводный сметный расчёт — не пропущенный документ, а ЭТАЛОН сверки:
    // сумма локальных смет обязана сойтись с «Итого по Главам 1-9» в пределах
    // гранулярности шкалы (ССРСС в тыс. руб., ЛСР в рублях).
    /**
     * Ставка НДС сводного расчёта против действующей на дату Проверки.
     *
     * Расчёт `vatGap` был написан и не подключён — очередной механизм без
     * применения. Не хватало ему одного: объявленной ставки. Она всё это время
     * лежала в разобранном сводном расчёте строкой начисления «НДС - 20%», и
     * разбор её извлекал.
     *
     * Сводный расчёт номинирован в ТЫС. РУБЛЕЙ — база восстанавливается из
     * суммы начисления делением на ставку и переводится в рубли. Гранулярность
     * шкалы (10 ₽) сохраняется в примечании: точность здесь не выдумывается.
     */
    /**
     * Реверс объёма по ВСЕМ линейным позициям объекта сразу.
     *
     * Группировка идёт по таблице норм, и разбить её по файлам значило бы
     * потерять базу там, где однородные позиции разошлись по разным сметам.
     */
    /**
     * Свод структуры затрат по всем сметам объекта.
     *
     * Читается ПОВТОРНО из файлов, а не копится по ходу: блок «в том числе»
     * лежит в шапке, а разбор позиций до шапки не доходит. Цена — четыре
     * чтения xlsx на объект; Проверка идёт минутами, и это не заметно.
     */
    costStructure: async () => {
      const zero = new Decimal(0);
      let total = zero;
      let construction = zero;
      let assembly = zero;
      let equipment = zero;
      let other = zero;
      let materials = zero;
      let overheadAndProfit = zero;
      let outsideRegistry = zero;
      const unread: string[] = [];
      const byDocument: {
        document: string;
        total: string;
        construction: string;
        assembly: string;
        equipment: string;
        other: string;
      }[] = [];

      for (const entry of documentHashes) {
        if (!/\.xlsx$/iu.test(entry.path)) continue;

        try {
          const elements = parseCostElements(await readSheetOf(entry.path));

          // Шапка без итога — не шапка сметы: сводный расчёт и посторонние
          // книги сюда попадать не должны, и молча складывать их нельзя.
          if (elements.total === undefined) {
            unread.push(entry.path.split("/").pop() ?? entry.path);
            continue;
          }

          byDocument.push({
            document: entry.path.split("/").pop() ?? entry.path,
            total: elements.total,
            construction: elements.construction ?? "0.00",
            assembly: elements.assembly ?? "0.00",
            equipment: elements.equipment ?? "0.00",
            other: elements.other ?? "0.00",
          });

          total = total.plus(elements.total);
          construction = construction.plus(elements.construction ?? "0");
          assembly = assembly.plus(elements.assembly ?? "0");
          equipment = equipment.plus(elements.equipment ?? "0");
          other = other.plus(elements.other ?? "0");
          materials = materials.plus(elements.materials ?? "0");
          overheadAndProfit = overheadAndProfit
            .plus(elements.overhead ?? "0")
            .plus(elements.profit ?? "0");
          outsideRegistry = outsideRegistry.plus(elements.outsideRegistry ?? "0");
        } catch {
          unread.push(entry.path.split("/").pop() ?? entry.path);
        }
      }

      return {
        total: total.toFixed(2),
        construction: construction.toFixed(2),
        assembly: assembly.toFixed(2),
        equipment: equipment.toFixed(2),
        other: other.toFixed(2),
        materials: materials.toFixed(2),
        overheadAndProfit: overheadAndProfit.toFixed(2),
        outsideRegistry: outsideRegistry.toFixed(2),
        byDocument,
        unread,
      };
    },

    reverseVolume: async () => {
      const reversal = reverseVolumes(linearPositions);

      return {
        flaggedAmount: reversal.flaggedAmount,
        groups: reversal.groups
          .filter((group) => Number(group.flaggedAmount) > 0)
          .map((group) => ({
            table: group.table,
            baseQuantity: group.baseQuantity,
            totalQuantity: group.totalQuantity,
            unit: group.unit,
            totalAmount: group.totalAmount,
            positions: group.positions.length,
          })),
      };
    },

    checkVat: async () => {
      if (vatAccrual === undefined) return undefined;

      const declared = vatAccrual.rate;
      const resolved = input.platform.parameters.resolve(
        "tax.vat.rate",
        isoDate(input.now.slice(0, 10)),
      );

      if (resolved === undefined) return undefined;
      const current = resolved.value;

      // База = сумма начисления / ставка. Тысячи → рубли.
      const base = new Decimal(vatAccrual.amount).dividedBy(declared).times(1000);

      const report = vatGap({
        baseAmount: base.toFixed(2),
        contractRate: declared.toString(),
        currentRate: current,
        // Твёрдая цена — допущение: договора у системы нет. Оно названо в
        // примечании, а не подразумевается.
        priceIsFirm: true,
      });

      // НМЦК — производная величина, и она НАЗВАНА производной: база плюс
      // объявленный НДС. Эталон печатает её как «потолок цены», и без неё
      // разговор о цене контракта опирается на Гл. 1-9, то есть на сумму без
      // начислений.
      const ceiling = base.times(new Decimal(1).plus(declared));

      return {
        declaredRate: `${new Decimal(declared).times(100).toFixed(0)}%`,
        currentRate: `${new Decimal(current).times(100).toFixed(0)}%`,
        gap: report.gap,
        applicable: report.applicable,
        note:
          `${report.note} База ${base.toFixed(2)} ₽ восстановлена из начисления ` +
          `${vatAccrual.amount} тыс.₽ (строка ${vatAccrual.row} сводного расчёта). ` +
          `НМЦК по объявленной ставке: ${ceiling.toFixed(2)} ₽ ` +
          `(база + НДС ${new Decimal(declared).times(100).toFixed(0)} %). ` +
          "Цена принята твёрдой — договора на входе нет.",
      };
    },

    /**
     * СКОЛЬКО ПОЗИЦИЙ НАКОПЛЕНО И ОТКУДА.
     *
     * Считается по накопителю ПОСЛЕ ролей — там же, где лежат и разобранные
     * строки, и выписанные ролью. Отдельный счётчик рядом с обходом разошёлся
     * бы с этим на первой же правке приёмника.
     */
    collectedPositions: async () => ({
      parsed: extracted.filter((row) => row.acquisition === undefined || row.acquisition === "parsed").length,
      byAgent: extracted.filter((row) => row.acquisition === "agent_normalized").length,
    }),

    // Сопоставление смет между собой идёт по ВСЕМ извлечённым строкам, а не по
    // линейным: двойной счёт не выбирает единицу измерения. Курганский случай —
    // пусконаладка в штуках.
    crossEstimateCheck: async () =>
      // Двойной счёт — совпадение шифра И суммы: без суммы он не определён.
      // Позиции сметы без цен сюда не идут, иначе весь такой пакет оказался бы
      // одним огромным «повтором на 0,00 ₽».
      findCrossEstimateDuplicates(
        сСуммой(extracted).map((row) => ({
          document: row.document,
          ordinal: row.ordinal,
          name: row.sourceName,
          basis: row.basis,
          amount: row.amount,
          sourceRow: row.sourceRow,
          // Уровень доверия решает, искать ли повтор внутри одного документа:
          // у разобранной сметы это делает `checkEstimate`, у позиций роли —
          // не делал никто.
          acquisition: row.acquisition,
        })),
      ),

    checkSummary: async (document, estimates) => {
      const parsed = parseSsrss(await readSheetOf(document.path));

      // Ставка НДС берётся из НАЗВАНИЯ начисления («НДС - 20%»), а не из
      // умолчания: сводный расчёт составлен по той ставке, которая в нём
      // написана, и подставить сюда «двадцать» значило бы решить за документ.
      const vat = parsed.accruals.find((accrual) => /НДС/iu.test(accrual.name));
      const percent = vat?.name.match(/(\d+(?:[.,]\d+)?)\s*%/u);

      if (vat !== undefined && percent !== null && percent !== undefined) {
        vatAccrual = {
          rate: new Decimal(percent[1]!.replace(",", ".")).dividedBy(100).toString(),
          amount: vat.total,
          row: vat.row,
        };
      }

      const blocking = parsed.issues.filter((issue) => issue.severity === "blocking");
      if (blocking.length > 0) throw new Error(причинойОтказа(blocking));

      const chapters = parsed.totals.find((total) => total.scope === "chapters:1-9");
      if (chapters === undefined) {
        throw new Error("в сводном расчёте нет итога «Итого по Главам 1-9»");
      }

      /**
       * СУММУ СМЕТ МОЖНО СЛОЖИТЬ, ТОЛЬКО ЕСЛИ ОНА ИЗВЕСТНА У ВСЕХ.
       *
       * На пакете без стоимостной части итога нет ни у одной сметы. Сложить их
       * как нули значило бы сверять ноль с объявленными в сводном расчёте
       * 86 778 920,38 ₽ и предъявить «расхождение» размером во всю стоимость
       * объекта — число, выглядящее посчитанным.
       *
       * Сказать при этом нечего — неверно: НМЦК из сводного расчёта прочитана,
       * и она главная цифра объекта. Возвращается она, а сверка объявляется
       * невыполненной с причиной.
       */
      const безИтога = estimates.filter((estimate) => estimate.documentTotal === undefined);

      if (безИтога.length > 0) {
        throw new Error(
          `сумма смет не сложена: у ${безИтога.length} из ${estimates.length} нет стоимостной части. ` +
            `Сводный расчёт объявляет ${chapters.total} ₽ по «${chapters.label}» — ` +
            "подтвердить эту цифру сметами нечем",
        );
      }

      const objectTotal = sumObjectTotals(
        estimates.map((estimate) => ({
          path: estimate.path.split("/").pop() ?? estimate.path,
          total: estimate.documentTotal as never,
        })),
      );

      /**
       * Шкала — из самого документа. Сводный расчёт пакета Нижнего Тагила
       * составлен в РУБЛЯХ, курганский — в тыс. руб.; зашитый множитель дал бы
       * на первом расхождение в 999 раз больше стоимости объекта.
       */
      const comparison = compareWithHeader(objectTotal.total, chapters.total, {
        scale: parsed.scale === "rubles" ? "unit" : "thousand",
        fractionDigits: 2,
      });
      if (comparison === undefined) throw new Error("сверка со шкалой не выполнена");

      return {
        path: document.path,
        scope: chapters.scope,
        label: chapters.label,
        declaredThousands: chapters.total,
        declaredRubles: comparison.headerInRubles,
        delta: comparison.delta,
        granularity: comparison.granularity,
        explainedByScale: comparison.explainedByScale,
      };
    },

    /**
     * Обход папки объекта — ПО ВСЕМУ ДЕРЕВУ, а не по верхнему уровню.
     *
     * Плоский `readdir` работал, пока файлы приходили по одному: их клали
     * рядом, и подпапок не бывало. С распаковкой архивов подпапки стали
     * штатными — внутри клиентского ZIP смета лежит в «Смета/Раздел 3/».
     *
     * Плоский обход на таком входе делал худшее из возможного: подкаталог
     * попадал в перечень как «документ», `describeDocument` пытался открыть
     * каталог, получал `EISDIR` и записывал «файл не прочитан», а СМЕТЫ ВНУТРИ
     * не видел вовсе. То есть сто смет из архива давали сто пропущенных файлов
     * и вердикт по пустому обходу — принято у двери, потеряно внутри.
     *
     * Глубина ограничена: партия — не файловая система, и двенадцати уровней
     * (столько же разрешает `safeEntryPath` при распаковке) хватает с запасом.
     * Ограничение стоит потому, что символьная ссылка на родителя даёт
     * бесконечный спуск, а обход обязан заканчиваться.
     */
    discover: async (path) => {
      const found: { path: string; name: string }[] = [];

      const walk = async (folder: string, depth: number): Promise<void> => {
        if (depth > 12) return;

        const entries = (await readdir(folder, { withFileTypes: true })).sort((left, right) =>
          left.name.localeCompare(right.name, "ru"),
        );

        for (const entry of entries) {
          const full = join(folder, entry.name);

          if (entry.isDirectory()) {
            await walk(full, depth + 1);
            continue;
          }

          // Символьные ссылки не читаются: ссылка в папке объекта указывает
          // куда угодно, включая чужого арендатора, а изоляция здесь держится
          // каталогом.
          if (!entry.isFile()) continue;

          /**
           * АРХИВ РАСКРЫВАЕТСЯ НА МЕСТЕ И ОБХОДИТСЯ ДАЛЬШЕ (А11).
           *
           * Дверь раскрывает только верхний ZIP; вложенные архивы, .rar и .7z
           * доезжают до партии файлами. Здесь они распаковываются в соседнюю
           * папку `<имя>.распаковано/` — один раз, повторный обход находит папку
           * готовой, — и файлы внутри читаются как остальные. Сам архив в
           * перечень не попадает: его содержимое — и есть документы.
           */
          const раскрыто = await expandArchiveInPlace(full);

          if (раскрыто !== undefined) {
            await walk(раскрыто.folder, depth + 1);
            continue;
          }

          found.push({ path: full, name: entry.name });
        }
      };

      await walk(path, 0);

      const described = await описатьНайденное(found, async (entry) =>
        describeDocument(entry.path, entry.name, platform.parsers),
      );

      /**
       * ТЕКСТ РАБОЧЕЙ ДОКУМЕНТАЦИИ НАКАПЛИВАЕТСЯ ЗДЕСЬ.
       *
       * Он уже прочитан обходом — `describeDocument` открывает PDF целиком,
       * чтобы отличить документ от скана по §14. До этой вехи прочитанное
       * отбрасывалось, и техническое заключение получало
       * `hasDesignDocuments: false` литералом: два агента одного прогона
       * противоречили друг другу об одном объекте.
       *
       * НЕ КОПИТСЯ У РАЗОБРАННОЙ СМЕТЫ: её текстовый слой — это её же позиции,
       * и подать их агенту вторым способом значит дать ему два описания одного,
       * способных разойтись.
       *
       * А ВОТ У НЕРАЗОБРАННОЙ — КОПИТСЯ, И ЭТО НЕ ПРОТИВОРЕЧИЕ. Выгрузка
       * ГРАНД-Сметы в XML опознана как смета, но в позиции не разложена: схемы
       * у нас нет, и парсер по догадке дал бы правдоподобный мусор. Второго
       * описания здесь взяться неоткуда — первого не существует. Прочитать
       * такую смету глазами агента лучше, чем не прочитать вовсе, а статус
       * «не разобран» с причиной остаётся на экране, и никто не сочтёт её итоги
       * учтёнными в сходимости.
       */
      const ЧИТАЕМЫЕ: ReadonlySet<string> = new Set(["рабочая-документация", "не-разобран"]);

      /**
       * В РЕЕСТР ПОПАДАЕТ КАЖДЫЙ ОБОЙДЁННЫЙ ФАЙЛ, А НЕ ТОЛЬКО РАЗОБРАННАЯ СМЕТА.
       *
       * Дескриптор заводился ровно там, где разбирается ЛСР. Всё остальное —
       * сводный сметный расчёт, подшивки РД, договоры, неразобранное — до
       * реестра не доходило. Замерено на эталонном входе `input-1`: загружено
       * семь файлов, на экране «Документы» четыре.
       *
       * Это тот же класс, что «принято и молча потеряно», только на шаг позже:
       * дверь файл приняла, обход его прочитал, а экран, на который клиент
       * смотрит первым делом («вы вообще получили мои файлы?»), про него молчит.
       *
       * Позиции при этом остаются только у тех, у кого они есть: реестр
       * показывает «позиций 0» и вид документа, а не выдумывает разбор.
       */
      for (const document of described) {
        if (описанные.has(document.path)) continue;
        описанные.add(document.path);

        descriptors.push({
          path: document.path,
          // Отпечаток считается ЗДЕСЬ, по самому файлу: разбор идёт позже
          // обхода, и брать хэш у него значило бы записать в реестр пустоту.
          // Тот же алгоритм, что у разбора, — значения совпадают.
          contentHash: await fileContentHash(document.path),
          fileName: document.path.split("/").pop() ?? document.path,
          kind: document.kind,
          mimeType: mimeTypeOf(document.path),
          byteSize: await byteSizeOf(document.path),
        });
      }

      /**
       * СКАНЫ — РАСПОЗНАЮТСЯ (Т2.2б).
       *
       * Страницы рендерятся подряд и читаются зрением модели. Результат идёт
       * агентам ТЕКСТОМ с объявленным уровнем доверия «ориентир»: у него есть
       * номер страницы и нет координаты строки, и подменять этим разбор из
       * файла нельзя (§12.1д).
       *
       * Зрение выключено — скан остаётся нечитаемым, и это сказано словом. Не
       * молча: «прочитан» и «читать было нечем» разные исходы.
       */
      for (const document of described) {
        if (document.kind !== "скан") continue;

        const runtime = platform.agentRuntime;

        if (runtime === undefined) {
          designDocuments.push({
            path: document.path,
            pages: 1,
            text: "[СКАН НЕ ПРОЧИТАН: распознавание требует модели со зрением, она не настроена]",
          });
          continue;
        }

        try {
          /**
           * СКАН РЕНДЕРИТСЯ С ТЕМ ЖЕ ПОТОЛКОМ, ЧТО И ЧЕРТЕЖИ.
           *
           * Здесь стоял вызов БЕЗ потолка, и действовало значение по умолчанию
           * `DESIGN_SHEETS_MAX` — ТРИ страницы. Для подшивки чертежей три листа
           * ещё как-то объяснимы отбором, а для СКАНА это обрыв документа:
           * тридцатишестистраничная смета прочитывалась зрением на три
           * страницы, и никто об этом не узнавал.
           *
           * Замерено 09.09.2026: у скана сводного сметного расчёта две
           * страницы — он проходил целиком случайно, потому что их меньше трёх.
           */
          // Изображение — сам лист: рендерить нечего, страница одна.
          const страницы = imageMime(document.path) !== undefined
            ? [await imageAsSheet(document.path)]
            : await renderAllPages(document.path, await readFile(document.path), SHEETS_PER_DOCUMENT);

          const распознано = await extractByVision({
            document: document.path,
            pages: страницы.map((s) => ({ page: s.page, dataUrl: s.dataUrl })),
            reader: {
              read: async (dataUrl) => {
                /**
                 * РАСПИСКА ОБЯЗАТЕЛЬНА И ЗДЕСЬ.
                 *
                 * Первый живой прогон распознавания отказал целиком: шлюз не
                 * выпустил ни одной страницы — «классы [commercial_secret] не
                 * выпускаются в исходном виде». Третий путь к модели, и снова
                 * мимо защиты, стоящей на первом.
                 *
                 * Обезличивается ПРОМПТ. Клиентских данных в нём нет вовсе —
                 * это инструкция «прочитай страницу», — и расписка выходит
                 * чистой сразу. Но выдать её обязан анонимизатор, а не мы:
                 * расписка, поставленная вызывающим, — это то самое
                 * `anonymized: true`, от которого ушли.
                 *
                 * КАРТИНКА НЕ ОБЕЗЛИЧИВАЕТСЯ, И ЭТО ЗАПИСАНО В ПРАВИЛЕ: фамилии
                 * в штампе чертежа стоят растром. Поэтому листы уходят только
                 * туда, куда владелец разрешил их отправлять явно.
                 */
                const чистый = anonymize({ text: VISION_PROMPT, knownEntities: [], salt: document.path });

                const turn = await runtime.run({
                  prompt: чистый.text,
                  anonymization: чистый.receipt,
                  images: [dataUrl],
                  outputSchema: VISION_PAGE_SCHEMA as unknown as Record<string, unknown>,
                  /**
                   * ОЦЕНКА ПО ПРОМПТУ, А НЕ ПО КАРТИНКЕ, И ЭТО НАЗВАННЫЙ ПРОБЕЛ.
                   *
                   * Первая версия считала `dataUrl.length / 3` и давала 553
                   * тысячи «токенов» на страницу — потолок профиля отвергал
                   * запрос, и распознавание не начиналось вовсе.
                   *
                   * Символы base64 токенами не являются: зрение считает
                   * изображение плитками, и по длине строки этого не узнать.
                   * Конвейер листы чертежей тоже не считает — то есть потолок
                   * §11 стоит только на тексте, и это верно записать как
                   * пробел, а не изображать точность подгонкой множителя.
                   */
                  estimatedInputTokens: Math.ceil(VISION_PROMPT.length / 3),
                  needsVision: true,
                });

                // Распознавание — тоже обращение наружу, и §12.1л требует
                // записи каждого. Страница, прочитанная зрением, стоит дороже
                // текстового вызова, и не увидеть её в журнале нельзя.
                platform.recordModelCall?.({
                  operationId: "распознавание-скана",
                  contour: turn.contour,
                  provider: turn.provider,
                  model: turn.model,
                  anonymized: чистый.receipt.clean,
                  inputTokens: turn.inputTokens,
                  outputTokens: turn.outputTokens,
                });

                return turn.output;
              },
            },
          });

          const сводка = visionBrief(распознано);
          if (сводка !== "") {
            /**
             * ПОТОЛОК СТРАНИЦ НАЗЫВАЕТСЯ, А НЕ УМАЛЧИВАЕТСЯ.
             *
             * Скан читается зрением до потолка страниц. Если страниц в
             * документе больше, роль обязана знать: прочитано не всё. Иначе
             * «в спецификации этого нет» будет сказано о странице, которую
             * никто не открывал, — а это наш сбой, выданный за факт документа.
             */
            const всегоСтраниц = страницы[0]?.total;
            const оговорка =
              всегоСтраниц !== undefined && всегоСтраниц > страницы.length
                ? `\n\n[ПРОЧИТАНО ЗРЕНИЕМ ${страницы.length} СТРАНИЦ ИЗ ${всегоСтраниц}: потолок STROYINTELLECT_DESIGN_SHEETS. Об остальных страницах ничего не известно — это не «там пусто».]`
                : "";

            designDocuments.push({ path: document.path, pages: страницы.length, text: `${сводка}${оговорка}` });
          }
        } catch (cause) {
          // Отказ распознавания НАЗЫВАЕТСЯ: агент должен знать, что документ
          // существует и прочитать его не удалось, а не думать, что его нет.
          designDocuments.push({
            path: document.path,
            pages: 1,
            text: `[СКАН НЕ ПРОЧИТАН: ${(cause as Error).message}]`,
          });
        }
      }

      /**
       * НИЧЕГО НЕ ТЕРЯЕТСЯ (Т10): у файла, до которого не дотянулся ни один
       * читатель, содержимое всё равно извлекается. До этой правки такой файл
       * доходил до роли одним именем — «только исходник», — и `.dwg` со
       * штампами листов и `.frw` со спецификацией не участвовали в анализе.
       *
       * Порядок важен: сначала штатные читатели, и только по остатку —
       * последняя попытка. Иначе разобранный документ получил бы вместо разбора
       * обрывки строк.
       */
      for (const document of described) {
        if (ЧИТАЕМЫЕ.has(document.kind) && document.text !== undefined) continue;
        if (document.kind === "скан") continue;
        await последняяПопытка(document.path);
      }

      for (const document of described) {
        if (!ЧИТАЕМЫЕ.has(document.kind) || document.text === undefined) continue;
        designDocuments.push({ path: document.path, pages: document.text.pages, text: document.text.text });

        /**
         * ЛИСТЫ РЕНДЕРЯТСЯ ЗДЕСЬ, В ОБХОДЕ, А НЕ У АГЕНТА.
         *
         * Техническое заключение вызывается по каждой смете; рендерить в нём
         * значило бы отрисовать одну и ту же подшивку четыре раза. Замер: три
         * листа — около четырёх секунд на подшивку.
         *
         * Отказ рендера не роняет обход: лист, который не отрисовался, просто
         * не попадает агенту — это меньше сведений, а не поломка.
         */
        try {
          /**
           * ПОТОЛОК ЛИСТОВ — ДЛЯ КОНВЕЙЕРА, НЕ ДЛЯ ЭКИПАЖА.
           *
           * Он стоял ради стоимости прогона: техническое заключение конвейера
           * зовётся по каждой смете, и три листа превращаются в двенадцать
           * передач. Но эти же отрисованные листы кладутся в рабочую папку
           * экипажа, где роль смотрит их САМА и платит своим ходом.
           *
           * Замерено на комплекте «CNTR»: 59 листов чертежей, до роли доходило
           * 12. Сорок семь листов не доезжали никуда, и выбор, КАКИЕ двенадцать,
           * делала наша эвристика плотности подписей — то есть мы решали за
           * роль, что ей смотреть.
           *
           * Потолок объявлен переменной и по умолчанию снят до 60 листов: это
           * дороже по рендеру и честнее по содержанию. `STROYINTELLECT_DESIGN_SHEETS`
           * по-прежнему его опускает там, где стоимость важнее полноты.
           */
          const sheets = await renderDesignSheets(document.path, await readFile(document.path), SHEETS_PER_DOCUMENT);
          designSheets.push(...sheets);
        } catch (cause) {
          /**
           * ОТКАЗ РЕНДЕРА НЕ РОНЯЕТ ОБХОД, НО И НЕ ПРОПАДАЕТ.
           *
           * Прежде причина терялась в пустом `catch`: у роли не было листов, и
           * почему — не знал никто. Теперь она доходит текстом, как и всё
           * остальное: «схем нет» и «схемы не отрисовались» — разные исходы.
           */
          designDocuments.push({
            path: document.path,
            pages: 1,
            text: `[ЛИСТЫ ЧЕРТЕЖЕЙ НЕ ОТРИСОВАНЫ: ${(cause as Error).message.slice(0, 200)}. Схемы этого документа роли недоступны — это не «схем нет».]`,
          });
        }
      }

      return described;
    },

    /**
     * Сколько листов этого документа отрисовано и отправлено агентам.
     *
     * Считается по накопителю рендера, а не заново: второй счёт разошёлся бы с
     * тем, что реально ушло в промпт.
     */
    sheetsOf: (documentPath) => designSheets.filter((sheet) => sheet.document === documentPath).length,

    /**
     * Сколько знаков этого документа ушло агентам текстом.
     *
     * По тому же накопителю, что уходит в промпт: отдельный счёт разошёлся бы
     * с тем, что агенты действительно прочитали.
     */
    charsOf: (documentPath) =>
      designDocuments
        .filter((document) => document.path === documentPath)
        .reduce((sum, document) => sum + document.text.length, 0),

    checkDocument: async (document) => {
      /**
       * КНИГА, НЕ РАЗОБРАННАЯ В ПОЗИЦИИ, ВСЁ РАВНО ДОХОДИТ ДО АГЕНТОВ.
       *
       * Разбор смет держится на форме 421/пр: у неё известна шапка, известны
       * колонки. Замерено на клиентском корпусе: из ста настоящих книг по этой
       * форме составлены тридцать четыре, остальные шестьдесят шесть — расчёты
       * и калькуляции своей вёрстки.
       *
       * До этой правки такая книга не читалась НИКЕМ: позиций из неё не выходит
       * (и не должно — они были бы выдуманы), а текстового адаптера у книг нет,
       * потому что у разобранной сметы текст — это её же позиции, и подавать их
       * вторым способом значило бы дать агенту два описания одного.
       *
       * Но у НЕ разобранной второго описания взяться неоткуда: первого не
       * существует. Поэтому лист выкладывается текстом здесь — в обработке
       * отказа, а не в обходе, — и только для тех книг, чей разбор не удался.
       */
      const parsed = await platform.operations
        .run<unknown, ParseEstimateBody>(
          "parse-estimate",
          { documentPath: document.path },
          { tenantId, entryPoint: "subgraph", subjects: new Map(), now },
        )
        .catch(async (cause: unknown) => {
          await книгуТекстом(document.path);

          /**
           * ФОРМА НЕ РАСПОЗНАНА — переводится в тип ОБХОДА, а не пробрасывается
           * как есть.
           *
           * `LsrParseError` бросается ровно в двух случаях: нет шапки «№ п/п» и
           * нет подзаголовка «всего». Оба означают «этой формы в книге нет», то
           * есть документ не смета. Обход про `LsrParseError` знать не может —
           * между ним и `documents` узкая талия (ADR-R-025), — поэтому перевод
           * делается здесь, в адаптере, где обе стороны видны.
           */
          if (cause instanceof LsrParseError) {
            // Реестр обязан сказать то же, что результат: иначе экран назовёт
            // счёт поставщика сметой, а отчёт — не сметой.
            уточнитьВид(descriptors, document.path, "книга-не-смета");
            throw new NotAnEstimate((cause as Error).message);
          }

          throw cause;
        });

      if (!parsed.ok) throw new Error("разбор заблокирован: не разрешены обязательные способности");

      const blocking = parsed.artifact.body.issues.filter((issue) => issue.severity === "blocking");
      if (blocking.length > 0) {
        // Блокирующее замечание — тот же отказ разбора, что и исключение:
        // позиций не будет. Значит книгу надо отдать агентам текстом.
        await книгуТекстом(document.path);
        throw new Error(причинойОтказа(blocking));
      }

      const convergence = await platform.operations.run<unknown, CheckConvergenceBody>(
        "check-convergence",
        toConvergenceInput(parsed.artifact.body, document.path, parsed.artifact.inputHashes[0]!),
        {
          tenantId,
          entryPoint: "subgraph",
          subjects: new Map([["estimate", { id: "estimate", status: "draft" as const, returnedCount: 0 }]]),
          now,
        },
      );

      if (!convergence.ok) throw new Error("сходимость не посчитана");

      documentHashes.push({ path: document.path, contentHash: parsed.artifact.inputHashes[0]! });

      /**
       * РАЗОБРАННАЯ СМЕТА ТОЖЕ УХОДИТ ТЕКСТОМ ЦЕЛИКОМ — Т10.
       *
       * Разбор берёт из книги форму 421/пр: позиции, разделы, итоги. Всё
       * остальное в той же книге — второй лист с ведомостью объёмов, расчёт
       * индексов, лист согласований, примечания сметчика — до сих пор не
       * доходило никуда: позиций там нет, а текстом книгу отдавали ТОЛЬКО при
       * отказе разбора.
       *
       * То есть удачный разбор ТЕРЯЛ больше, чем неудачный. Теперь книга
       * уходит и позициями, и текстом: позиции дают координату и арифметику,
       * текст — всё, что в форму не уложилось.
       */
      await книгуТекстом(document.path);

      // Дескриптор заводит ОБХОД, один на каждый файл (см. `описанные`). Здесь
      // остаётся только отпечаток: заводить второй дескриптор той же смете
      // значило бы показать её в реестре дважды.

      // Позиции копятся ЗДЕСЬ, а не разбираются повторно: второй разбор того же
      // файла мог бы дать другой результат, и реестр разошёлся бы с проверкой.
      for (const section of parsed.artifact.body.sections) {
        for (const position of section.positions) {
          const basis =
            position.mapping.kind === "by_code"
              ? `${position.mapping.code.system}${position.mapping.code.code}`
              : "";

          extracted.push({
            document: document.path,
            ordinal: position.ordinal,
            section: section.number,
            sourceName: position.sourceName,
            basis,
            unit: position.quantity?.value.unit ?? "",
            ...(position.quantity === undefined ? {} : { quantity: position.quantity.value.value }),
            amount: position.amount?.value.amount,
            sourceRow: строкаПозиции(position),
          });

          linearPositions.push({
            ordinal: position.ordinal,
            basis:
              position.mapping.kind === "by_code"
                ? `${position.mapping.code.system}${position.mapping.code.code}`
                : "",
            name: position.sourceName,
            unit: position.quantity?.value.unit ?? "",
            ...(position.quantity === undefined ? {} : { quantity: position.quantity.value.value }),
            amount: position.amount?.value.amount,
            document: document.path,
          });
        }
      }

      const result = convergence.artifact.body;

      return {
        path: document.path,
        positions: parsed.artifact.body.sections.reduce((n, section) => n + section.positions.length, 0),
        byCode: parsed.artifact.body.summary.byCode,
        unmatched: parsed.artifact.body.summary.unmatched,
        converged: result.converged,
        // Расхождения нет — но и итога нет: у сметы без стоимостной части
        // складывать нечего. «0.00» здесь означало бы «сошлось».
        delta: result.document.delta?.value.amount,
        documentTotal: result.document.computed?.value.amount,
      };
    },
  };

  const collected: CollectedDuringCheck = {
    documentHashes,
    linearPositions,
    extracted,
    /**
     * ОДНА СТРОКА ДОКУМЕНТА ПОПАДАЕТ В СЧЁТ ОДИН РАЗ.
     *
     * ЗАМЕРЕНО НА ПРОГОНЕ 16 (08.09.2026): в базу легли 144 позиции, а разных
     * строк документов среди них — 105. Тридцать девять строк задвоены, строка
     * «Итого затрат Заказчика до резерва» — пять раз.
     *
     * ПРИЧИН ДВЕ, И ОБЕ ЗАКОННЫЕ. Одну и ту же смету контракта читают четыре
     * роли — сметчик, экономист, снабженец, подрядный, — и каждая выписывает
     * нужные ей строки. Плюс переделка по возврату выписывает их заново: у
     * сметчика было 15 позиций, после возврата стало 66.
     *
     * ЧТО ЭТО СТОИЛО БЫ. Сумма позиций документа считалась бы с задвоенными
     * строками — то есть сходимость и своды врали бы; поиск двойного счёта
     * увидел бы наши собственные повторы и обвинил бы подрядчика в том, чего
     * он не делал; в таблице позиций строка 43 стояла бы пять раз.
     *
     * КЛЮЧ — ДОКУМЕНТ, ЛИСТ И НОМЕР СТРОКИ: это физическое место в файле, и
     * дважды оно существовать не может. Позиция без номера строки (роль его не
     * назвала) в ключ не годится и принимается как есть: отбросить её значило
     * бы потерять данные ради удобства.
     *
     * ПЕРВАЯ ЗАПИСЬ ОСТАЁТСЯ. Разобранная кодом строка сюда не попадает вовсе
     * (её отсекает `toExtractedRows`), поэтому спор возможен только между
     * ролями — и решается он не молчанием: расхождение видно тем, что вторая
     * роль назвала ту же строку, и это лежит в её заключении.
     */
    absorb: (rows) => {
      const место = (row: ExtractedRow): string =>
        `${row.document}#${row.sheet ?? ""}#${row.sourceRow}`;

      const занято = new Set(
        extracted.filter((row) => row.sourceRow > 0).map((row) => место(row)),
      );

      for (const row of rows) {
        if (row.sourceRow > 0) {
          const ключ = место(row);
          if (занято.has(ключ)) continue;
          занято.add(ключ);
        }

        extracted.push(row);
      }
    },
    descriptors,
    designDocuments,
    designSheets,
  };

  return {
    ports: {
      ...ports,
      ...(input.reviewers === undefined ? {} : { reviewers: input.reviewers(collected) }),
      ...(input.objectReviewers === undefined
        ? {}
        : { objectReviewers: input.objectReviewers(collected) }),
      ...(input.synthesisReviewers === undefined
        ? {}
        : { synthesisReviewers: input.synthesisReviewers(collected) }),
    },
    collected,
  };
}

/**
 * Порт обзора одной сметы.
 *
 * Вход агента собирается из ДЕТЕРМИНИРОВАННЫХ проверок, а не из самой сметы:
 * модель классифицирует и объясняет, арифметику делает расчётный модуль
 * (ТЗ §6.4). Это же держит расход контекста в пределах потолка целевой
 * локальной модели.
 *
 * ПОЧЕМУ ЗДЕСЬ, А НЕ В КОМАНДНОЙ СТРОКЕ
 *
 * Порт был объявлен внутри `apps/cli` — и обзор сметчика умела делать только
 * командная строка. Воркер, выполняющий проверку из веба, до него не дотягивался
 * и молча отдавал результат без обзора: пользователь видел завершённую проверку,
 * в которой не было главного. Это та же развилка, ради устранения которой
 * выносились остальные порты, — просто замеченная позже.
 */
export function buildReviewDocument(
  platform: Platform,
  tenantId: string,
  now: string,
  depth: DepthMode,
): DocumentReviewer["review"] {
  return async (document: { readonly path: string }) => {
    const parsed = await platform.operations.run<unknown, ParseEstimateBody>(
      "parse-estimate",
      { documentPath: document.path },
      { tenantId, entryPoint: "subgraph", subjects: new Map(), now },
    );
    if (!parsed.ok) throw new Error("разбор заблокирован");

    const subjects = new Map([["estimate", { id: "estimate", status: "draft" as const, returnedCount: 0 }]]);

    const convergence = await platform.operations.run<unknown, CheckConvergenceBody>(
      "check-convergence",
      toConvergenceInput(parsed.artifact.body, document.path, parsed.artifact.inputHashes[0]!),
      { tenantId, entryPoint: "subgraph", subjects, now },
    );
    if (!convergence.ok) throw new Error("сходимость не посчитана");

    const positions: PositionForCheck[] = parsed.artifact.body.sections.flatMap((section) =>
      section.positions.map((position) => ({
        ordinal: position.ordinal,
        section: section.number,
        name: position.sourceName,
        basis: position.mapping.kind === "by_code"
          ? `${position.mapping.code.system}${position.mapping.code.code}`
          : "",
        unit: position.quantity?.value.unit ?? "",
        amount: position.amount?.value.amount,
        row: строкаПозиции(position),
      })),
    );

    const review = await platform.operations.run<unknown, EstimateReviewBody>(
      "run-estimate-review",
      {
        documentPath: document.path,
        depth,
        contentHash: parsed.artifact.inputHashes[0]!,
        hasEstimate: true,
        convergence: {
          converged: convergence.artifact.body.converged,
          documentTotal: convergence.artifact.body.document.computed?.value.amount,
          documentDelta: convergence.artifact.body.document.delta?.value.amount,
          sections: convergence.artifact.body.sections.map((section) => ({
            scope: section.scope,
            name: section.name ?? "",
            computed: section.computed?.value.amount,
            delta: section.delta?.value.amount,
            status: section.status,
          })),
        },
        checks: checkEstimate(positions),
        topPositions: topPositionsByShare(positions, { minShare: "0.05", limit: 5 }),
        // Только для координаты замечания: в промпт этот список не идёт.
        positions: positions.map((position) => ({
          ordinal: position.ordinal,
          ...(position.amount === undefined ? {} : { amount: position.amount }),
          row: position.row,
        })),
      },
      { tenantId, entryPoint: "subgraph", subjects, now },
    );

    if (!review.ok) throw new Error("операция обзора заблокирована предусловиями");

    /**
     * СМЕТА БЕЗ ЦЕН — НАХОДКА ОТ КОДА, А НЕ ОТ МОДЕЛИ.
     *
     * Факт установлен разбором: в итоговой колонке нет ни одного числа. Ждать,
     * что модель заметит это сама и одинаково сформулирует на каждом прогоне,
     * значило бы поставить главную находку объекта в зависимость от удачи.
     *
     * Формулировка и адресат взяты из эталона заказчика по этому кейсу: находка
     * №1, красная, «Заказчик / Людмила», вес «блокирует проверку НМЦК».
     */
    const безЦен: readonly ReviewFinding[] = parsed.artifact.body.withoutPrices
      ? [
          {
            severity: "critical",
            statement:
              "Смета БЕЗ ЦЕН: позиции содержат только шифры ГЭСН/ФСБЦ, единицы и объёмы, " +
              "денежных колонок нет. Построчная проверка расценок, индексов и двойного счёта " +
              "по этому документу невозможна.",
            basis:
              `${document.path}: позиций ${positions.length}, ` +
              "ни одна не несёт суммы; итоговая колонка пуста и по позициям, и по разделам, и по смете" +
              (parsed.artifact.body.headerTotalThousands === undefined
                ? ""
                : `. В шапке объявлена сметная стоимость ${parsed.artifact.body.headerTotalThousands} тыс. руб. — ` +
                  "она не подтверждена ни одной строкой таблицы"),
          },
        ]
      : [];

    return {
      verdict: review.artifact.body.verdict,
      depthViolations: review.artifact.body.depth.violations,
      findings: [...безЦен, ...review.artifact.body.findings.map(мнение)],
      openQuestions: review.artifact.body.openQuestions,
      sections: review.artifact.body.sections,
    };
  };
}

/**
 * Порт техзаключения ГИПа (Денчик).
 *
 * Берёт позиции, УЖЕ собранные обходом, и не разбирает файл повторно: второй
 * разбор того же файла мог бы дать другой результат, и заключение разошлось бы
 * с проверкой. К моменту работы рецензентов накопитель полон — `checkObject`
 * запускает их после обхода.
 *
 * Реверс объёма считается ВНУТРИ одного документа: база группы — наименьший
 * объём по таблице норм, и мешать в неё позиции соседней сметы значит портить
 * базу. Это же требует чек-лист приёмки: «шина не влияет на базу контактной
 * сети».
 */
export function buildTechOpinionReviewer(
  platform: Platform,
  tenantId: string,
  now: string,
  collected: CollectedDuringCheck,
  depth: DepthMode,
): DocumentReviewer["review"] {
  return async (document: { readonly path: string }) => {
    const own = collected.linearPositions.filter(
      (position) => position.document === document.path,
    );

    const reversal = reverseVolumes(own);

    // Состав работ — ВЕСЬ документ, а не только группы с найденной кратностью.
    // Пропущенную работу (Д-4) видно лишь на полном составе: реверс показывает
    // то, что есть, а Денчик должен назвать то, чего нет.
    const groups = new Map<string, { name: string; count: number; unit: string; quantity: Decimal; amount: Decimal; quantityUnknown: number }>();

    for (const position of сСуммой(own)) {
      const table = normTable(position.basis);
      const existing = groups.get(table);

      if (existing === undefined) {
        groups.set(table, {
          name: position.name,
          count: 1,
          unit: position.unit,
          /**
           * ОБЪЁМ НЕИЗВЕСТЕН — ГРУППА ПОМЕЧАЕТСЯ, А НЕ ПОЛУЧАЕТ НОЛЬ.
           *
           * Позиция без количества, сложенная как ноль, занижает объём группы:
           * реверс объёма сравнивает его с проектным и объявляет расхождение,
           * которого нет, — либо не объявляет то, которое есть.
           */
          // ноль-осознанно: сумма объёма считается по известным, а число
          // неизвестных копится рядом и печатается вместе с итогом группы.
          quantity: new Decimal(position.quantity ?? "0"),
          quantityUnknown: position.quantity === undefined ? 1 : 0,
          amount: new Decimal(position.amount),
        });
        continue;
      }

      groups.set(table, {
        ...existing,
        count: existing.count + 1,
        // ноль-осознанно: то же — неизвестные посчитаны строкой ниже.
        quantity: existing.quantity.plus(position.quantity ?? "0"),
        quantityUnknown: existing.quantityUnknown + (position.quantity === undefined ? 1 : 0),
        amount: existing.amount.plus(position.amount),
      });
    }

    const hash = collected.documentHashes.find((entry) => entry.path === document.path);

    const opinion = await platform.operations.run<unknown, TechOpinionBody>(
      "run-tech-opinion",
      {
        documentPath: document.path,
        depth,
        contentHash: hash?.contentHash ?? ("" as Sha256),
        /**
         * РАБОЧАЯ ДОКУМЕНТАЦИЯ ДОХОДИТ ДО АГЕНТА.
         *
         * Здесь стояло `false` литералом с комментарием «§14 исключает OCR».
         * Комментарий был шире самого §14: тот исключает распознавание
         * СКАНОВ, а текстовый слой PDF мы читаем — у курганских подшивок
         * около 3000 знаков на страницу. Слой читался обходом и выбрасывался,
         * и на экране это выглядело спором агентов: паспорт объекта ссылался
         * на подшивку, а техническое заключение писало «геометрия РД
         * отсутствует».
         *
         * Геометрия чертежей по-прежнему недоступна, и промпт говорит это
         * прямо: текст — не схемы.
         */
        hasDesignDocuments: collected.designDocuments.length > 0,
        designText: briefToPrompt(briefOf(collected.designDocuments, DESIGN_TEXT_BUDGET)),
        /**
         * СХЕМЫ И ЧЕРТЕЖИ — то, чего текстовый слой не отдаёт.
         *
         * Замер на курганской подшивке: с листов модель взяла разбивочные
         * расстояния (39 395, 50 401, 33 814 мм), трубу ПНД Ø50 на глубине 3 м,
         * модели камер и номера опор контактной сети — то есть ровно ту
         * геометрию, отсутствие которой техническое заключение объявляло
         * деградацией.
         *
         * Уйдут ли листы наружу, решает композиционный корень по адресу
         * модели: изображение обезличиванию не подлежит.
         */
        designSheets: collected.designSheets.map((sheet) => sheet.dataUrl),
        designSheetLabels: collected.designSheets.map(
          (sheet) => `${sheet.document.split("/").pop() ?? sheet.document}, лист ${sheet.page}`,
        ),
        unjustifiedAmount: reversal.unjustifiedAmount,
        reversal: reversal.groups.map((group) => ({
          table: group.table,
          baseQuantity: group.baseQuantity,
          unit: group.unit,
          totalQuantity: group.totalQuantity,
          totalAmount: group.totalAmount,
          flaggedAmount: group.flaggedAmount,
          assumption: group.assumption,
          flagged: group.positions
            .filter((position) => position.flagged)
            .map((position) => ({
              ordinal: position.ordinal,
              ...(position.multiple === undefined ? {} : { multiple: position.multiple }),
            })),
        })),
        workGroups: [...groups].map(([table, group]) => ({
          table,
          name: group.name,
          count: group.count,
          unit: group.unit,
          /**
           * Объём назван вместе с ЧИСЛОМ ПОЗИЦИЙ, У КОТОРЫХ ЕГО НЕТ.
           *
           * Без этого «объём 1250 м³» по группе из двадцати позиций, где у
           * пяти количества нет вовсе, читается как полный объём работ — и
           * агент сравнивает его с проектным как равное с равным.
           */
          totalQuantity:
            group.quantityUnknown === 0
              ? group.quantity.toString()
              : `${group.quantity.toString()} (по ${group.count - group.quantityUnknown} позициям из ${group.count}; у ${group.quantityUnknown} объём в смете не указан)`,
          totalAmount: group.amount.toFixed(2),
        })),
      },
      { tenantId, entryPoint: "subgraph", subjects: new Map(), now },
    );

    if (!opinion.ok) throw new Error("операция техзаключения заблокирована предусловиями");

    return {
      verdict: opinion.artifact.body.verdict,
      depthViolations: opinion.artifact.body.depth.violations,
      findings: opinion.artifact.body.findings.map(мнение),
      openQuestions: opinion.artifact.body.openQuestions,
      sections: opinion.artifact.body.sections,
    };
  };
}

/**
 * Замечание агента без потерь.
 *
 * ЧТО ЭТО ЧИНИТ
 *
 * Все девять портов срезали замечание до трёх полей и выбрасывали `impact` —
 * сумму под угрозой СО СЛЕДОМ до строки документа. Величина при этом честно
 * вычислялась: оболочка агента берёт у модели порядковый номер позиции и
 * подставляет сумму из разобранной сметы, потому что число из ответа модели
 * было бы числом без следа (§12.1д).
 *
 * То есть деньги каждого замечания считались — и терялись по дороге к экрану и
 * к выгрузке. В эталонном пакете эта сумма стоит у КАЖДОЙ строки замечания;
 * у нас её не было ни в одной.
 *
 * Отсутствие суммы передаётся отсутствием поля, а не нулём: замечание без
 * денежного последствия и замечание ценой в десять миллионов — разные вещи
 * (ТЗ §9).
 */
/**
 * Замечание агента, приведённое к тому, что понимает обход.
 *
 * ОДНА ВОРОНКА НА ДЕВЯТЬ ПОРТОВ, и это её главное свойство: поле, забытое
 * здесь, теряется у всех девяти агентов сразу — ровно так полгода терялась
 * сумма влияния, а с ней и координата строки (`Д3`).
 */
function мнение(finding: {
  readonly severity: string;
  readonly statement: string;
  readonly basis: string;
  readonly deviation?: string | undefined;
  readonly impact?: Valued<Money> | undefined;
  readonly source?: SourceRef | undefined;
}): ReviewFinding {
  return {
    severity: finding.severity,
    statement: finding.statement,
    basis: finding.basis,
    ...(finding.deviation === undefined ? {} : { deviation: finding.deviation }),
    ...(finding.impact === undefined ? {} : { impact: finding.impact }),
    // Координата едет отдельно от суммы: замечание без денежного влияния тоже
    // имеет право на строку исходного листа, и до Д3 именно оно её и теряло.
    ...(finding.source === undefined ? {} : { source: finding.source }),
  };
}

/** Таблица норм из шифра: `ГЭСНм20-03-035-01` → `ГЭСНм20-03-035`. */
function normTable(basis: string): string {
  if (basis === "") return "без шифра";

  const parts = basis.split("-");
  return parts.length > 1 ? parts.slice(0, -1).join("-") : basis;
}

/**
 * Все агенты, доступные Проверке.
 *
 * Один список на командную строку и на воркер. Два списка разошлись бы молча:
 * проверка из веба начала бы давать не то, что проверка из командной строки, —
 * ровно та развилка, из-за которой обзор сметчика полгода не доходил до веба.
 *
 * Агент попадает в список, ТОЛЬКО если его операция зарегистрирована. Модель не
 * настроена — операций нет, список пуст, Проверка остаётся детерминированной и
 * объявляет деградацию.
 */
/**
 * Объектные агенты, доступные Проверке.
 *
 * Отдельно от документных: у них другой предмет и другой момент запуска. Один
 * список на командную строку и на воркер — по той же причине, что и там.
 */
export function buildObjectReviewers(
  platform: Platform,
  tenantId: string,
  now: string,
  economics: { readonly revenue?: string | undefined; readonly costs?: string | undefined },
  depth: DepthMode = "стандарт",
): (collected: CollectedDuringCheck) => readonly ObjectReviewer[] {
  return (collected) => {

    const reviewers: ObjectReviewer[] = [];

    if (platform.operations.definition("run-finance-model") !== undefined) {
      reviewers.push({
        capability: "finance_model",
        review: buildFinanceModelReviewer(platform, tenantId, now, collected, economics, depth),
      });
    }

    if (platform.operations.definition("run-procurement") !== undefined) {
      reviewers.push({
        capability: "procurement_map",
        review: buildProcurementReviewer(platform, tenantId, now, collected, depth),
      });
    }

    if (platform.operations.definition("run-executive-docs") !== undefined) {
      reviewers.push({
        capability: "executive_docs",
        review: buildExecutiveDocsReviewer(platform, tenantId, now, collected, depth),
      });
    }

    if (platform.operations.definition("run-object-passport") !== undefined) {
      reviewers.push({
        capability: "object_passport",
        review: buildObjectPassportReviewer(platform, tenantId, now, collected, depth),
      });
    }

    if (platform.operations.definition("run-contract-audit") !== undefined) {
      reviewers.push({
        capability: "contract_audit",
        review: buildContractAuditReviewer(platform, tenantId, now, collected, depth),
      });
    }

    if (platform.operations.definition("run-subcontract-plan") !== undefined) {
      reviewers.push({
        capability: "subcontract_plan",
        review: buildSubcontractPlanReviewer(platform, tenantId, now, collected, depth),
      });
    }

    return reviewers;
  };
}

export function buildReviewers(
  platform: Platform,
  tenantId: string,
  now: string,
  depth: DepthMode = "стандарт",
): (collected: CollectedDuringCheck) => readonly DocumentReviewer[] {
  return (collected) => {
    const reviewers: DocumentReviewer[] = [];

    if (platform.operations.definition("run-estimate-review") !== undefined) {
      reviewers.push({
        capability: "estimate_review",
        review: buildReviewDocument(platform, tenantId, now, depth),
      });
    }

    if (platform.operations.definition("run-tech-opinion") !== undefined) {
      reviewers.push({
        capability: "tech_opinion",
        review: buildTechOpinionReviewer(platform, tenantId, now, collected, depth),
      });
    }

    return reviewers;
  };
}

/** Размер файла. Ноль при недоступности — но не выдумка: файл мы только что читали. */
async function byteSizeOf(path: string): Promise<number> {
  try {
    const { size } = await stat(path);
    return size;
  } catch {
    return 0;
  }
}

/** MIME по расширению. Достаточно для записи версии; разбор идёт по сигнатуре. */
function mimeTypeOf(path: string): string {
  const extension = path.toLowerCase().split(".").pop() ?? "";

  if (extension === "xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (extension === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (extension === "pdf") return "application/pdf";

  return "application/octet-stream";
}

/**
 * Порт финансовой модели (Ваныч) — ОБЪЕКТНЫЙ.
 *
 * Его предмет стройка целиком, поэтому он работает после обхода и получает
 * итог, а не отдельную смету.
 *
 * ЧТО СЧИТАЕТСЯ ЗДЕСЬ, А НЕ МОДЕЛЬЮ
 *
 * Сценарии — `buildScenarios`. Стоимость денег — `creditInterest` по ключевой
 * ставке из параметров, взятой С ДАТОЙ (§6.4: «ключевая ставка задаётся
 * параметром с датой, начиная с которой значение действует»).
 *
 * СЕБЕСТОИМОСТЬ НЕ БЕРЁТСЯ ИЗ СМЕТЫ
 *
 * Чек-лист Ваныча: «смета — цена заказчику, не затраты». Без заданной
 * себестоимости сценарии НЕ СТРОЯТСЯ, и это говорится вслух, а не подменяется
 * сметой (О-76).
 */
export function buildFinanceModelReviewer(
  platform: Platform,
  tenantId: string,
  now: string,
  collected: CollectedDuringCheck,
  economics: { readonly revenue?: string | undefined; readonly costs?: string | undefined },
  depth: DepthMode,
): ObjectReviewer["review"] {
  return async (context) => {
    /**
     * СТОИМОСТЬ ОБЪЕКТА НЕИЗВЕСТНА — ЭТО ГОВОРИТСЯ, А НЕ ЗАМЕНЯЕТСЯ НУЛЁМ.
     *
     * Ноль здесь давал два ложных утверждения сразу: стоимость денег на отсрочку
     * выходила «0 ₽», то есть финансирование бесплатно, а доля каждого пакета в
     * стоимости объекта — «0,0000», то есть пакет ничего не весит. Оба числа
     * выглядят посчитанными, и оба — о стоимости, которой мы не знаем.
     *
     * Комплекты без сводного расчёта — не исключение, а обычный случай: на трёх
     * кейсах заказчика сводного расчёта нет ни в одном.
     */
    const declaredTotal = context.declaredTotal;
    const известнаСтоимость = declaredTotal !== undefined;

    const scenarios =
      economics.revenue === undefined || economics.costs === undefined
        ? undefined
        : buildScenarios({ revenue: economics.revenue, costs: economics.costs });

    // Ставка берётся НА ДАТУ прогона и падает с внятной причиной, если её нет:
    // подставить «примерно двадцать процентов» значило бы выдать выдуманную
    // цену денег за посчитанную.
    const keyRate = platform.parameters.require("finance.key_rate", isoDate(now.slice(0, 10)));

    const DELAY_DAYS = 30;
    const cost = известнаСтоимость
      ? creditInterest({
          principal: declaredTotal!,
          annualRate: keyRate.value,
          days: DELAY_DAYS,
          basis: 365,
        })
      : undefined;

    // Кандидаты в пакеты — состав объекта по таблицам норм. Как делить на
    // пакеты, решает Ваныч; модуль показывает, из чего объект состоит.
    const byTable = new Map<string, { name: string; amount: Decimal }>();

    for (const position of сСуммой(collected.linearPositions)) {
      const table = normTable(position.basis);
      const existing = byTable.get(table);

      byTable.set(table, {
        name: existing?.name ?? position.name,
        amount: (existing?.amount ?? new Decimal(0)).plus(position.amount),
      });
    }

    const total = известнаСтоимость ? new Decimal(declaredTotal!) : undefined;

    const packages = [...byTable]
      .map(([table, group]) => ({
        table,
        name: group.name,
        amount: group.amount.toFixed(2),
        // Доля от неизвестного целого не считается: «0,0000» читалось бы как
        // «пакет ничего не весит», а вес просто не с чем сравнить.
        share: total !== undefined && total.greaterThan(0) ? group.amount.dividedBy(total).toFixed(4) : undefined,
      }))
      .sort((a, b) => Number(b.amount) - Number(a.amount))
      .slice(0, 12);

    const missing = [
      ...(economics.revenue === undefined ? ["выручка по договору (--revenue)"] : []),
      ...(economics.costs === undefined
        ? ["себестоимость (--costs): смета это цена заказчику, а не затраты"]
        : []),
      "график платежей заказчика — без него дата кассового разрыва не считается",
      "рыночные цены по группам — без них дельта «смета против рынка» не считается",
    ];

    const result = await platform.operations.run<unknown, FinanceModelBody>(
      "run-finance-model",
      {
        documentPath: context.objectPath,
        depth,
        contentHash: (collected.documentHashes[0]?.contentHash ?? "") as Sha256,
        declaredTotal,
        scenarios: (scenarios?.scenarios ?? []).map((scenario) => ({
          id: scenario.id,
          revenue: scenario.revenue,
          costs: scenario.costs,
          margin: scenario.margin,
          marginShare: scenario.marginShare,
          profitable: scenario.profitable,
        })),
        ...(scenarios?.breaksAt === undefined ? {} : { breaksAt: scenarios.breaksAt }),
        assumption: scenarios?.assumption ?? "сценарии не строились: нет выручки или затрат",
        packages,
        moneyCost: {
          days: DELAY_DAYS,
          annualRate: keyRate.value,
          rateSince: rateSince(keyRate),
          /**
           * Стоимость денег считается от стоимости объекта. Она неизвестна —
           * значит неизвестна и цена отсрочки. «0 ₽» здесь означало бы, что
           * отсрочка бесплатна, и экономист принял бы это за расчёт.
           */
          amount: cost?.interest ?? "не определена: стоимость объекта неизвестна",
        },
        missing,
      },
      { tenantId, entryPoint: "subgraph", subjects: new Map(), now },
    );

    if (!result.ok) throw new Error("операция финансовой модели заблокирована предусловиями");

    return {
      verdict: result.artifact.body.verdict,
      depthViolations: result.artifact.body.depth.violations,
      findings: result.artifact.body.findings.map(мнение),
      openQuestions: result.artifact.body.openQuestions,
      sections: result.artifact.body.sections,
    };
  };
}

/**
 * Дата, с которой действует ставка.
 *
 * Ставка без даты — не ставка: §6.4 требует значение с датой начала действия, и
 * старая ставка даёт правдоподобно неверную цену денег.
 *
 * ДЕФЕКТ, НАЙДЕННЫЙ САМИМ АГЕНТОМ
 *
 * Первая редакция искала дату в `locator.since`, которого у параметра нет, и
 * возвращала «дата не указана в параметре». Ваныч на первом же прогоне выдал
 * замечание «ставка требует проверки перед решением: дата действия не
 * указана» — по своему стандарту 3.6. Замечание было верным по форме и
 * неверным по существу: дата ЕСТЬ, её не прочитали.
 *
 * Параметр хранит её в `checkedAt` — это дата, с которой значение действует
 * (см. `ParameterRegistry.resolve`), а `recordId` имеет вид `id@дата`.
 */
function rateSince(rate: Valued<DecimalString>): string {
  return rate.provenance.kind === "source" ? rate.provenance.ref.checkedAt : "дата не указана";
}

/**
 * Порт карты закупки (Марина) — ОБЪЕКТНЫЙ.
 *
 * Отдаёт модели состав объекта по убыванию суммы: дорогое видно первым (3.2).
 * Порог трёх КП берётся из расчётного модуля, а не повторяется здесь — два
 * места правды о пороге разойдутся молча.
 *
 * ЛИД-ТАЙМЫ НЕ ПЕРЕДАЮТСЯ, ПОТОМУ ЧТО ИХ НЕТ
 *
 * Срок поставки живёт в коммерческом предложении, а не в смете. Подставить сюда
 * «обычно четыре недели» значило бы дать модели выдуманное число как факт.
 */
export function buildProcurementReviewer(
  platform: Platform,
  tenantId: string,
  now: string,
  collected: CollectedDuringCheck,
  depth: DepthMode,
): ObjectReviewer["review"] {
  return async (context) => {
    const candidates = [...collected.extracted]
      .sort((a, b) => Number(b.amount) - Number(a.amount))
      .slice(0, 25)
      .map((row) => ({
        ordinal: row.ordinal,
        name: row.sourceName,
        basis: row.basis,
        unit: row.unit,
        ...(row.quantity === undefined ? {} : { quantity: row.quantity }),
        amount: row.amount,
        requiresThreeQuotes: Number(row.amount) > QUOTE_THRESHOLD,
        sourceRow: row.sourceRow,
        ...источникПозиции(collected, row.document),
      }));

    const result = await platform.operations.run<unknown, ProcurementBody>(
      "run-procurement",
      {
        documentPath: context.objectPath,
        depth,
        contentHash: (collected.documentHashes[0]?.contentHash ?? "") as Sha256,
        candidates,
        quotesThreshold: String(QUOTE_THRESHOLD),
        missing: [
          "лид-таймы поставщиков — без них карта сроков не строится",
          "коммерческие предложения: три на позицию дороже порога (3.1)",
          "дата потребности по каждой позиции — из графика работ",
        ],
      },
      { tenantId, entryPoint: "subgraph", subjects: new Map(), now },
    );

    if (!result.ok) throw new Error("операция карты закупки заблокирована предусловиями");

    return {
      verdict: result.artifact.body.verdict,
      depthViolations: result.artifact.body.depth.violations,
      findings: result.artifact.body.findings.map(мнение),
      openQuestions: result.artifact.body.openQuestions,
      sections: result.artifact.body.sections,
    };
  };
}

/**
 * Порт исполнительной документации (Палыч) — ОБЪЕКТНЫЙ.
 *
 * Отдаёт состав работ и незакрытые пункты чек-листа старта. Чек-лист считает
 * `buildStartChecklist`; ответов на его вопросы у системы пока нет, и все семь
 * пунктов идут НЕОТВЕЧЕННЫМИ — что по правилу 3.1 и означает «выход на объект
 * преждевременный». Подставить «да» значило бы закрыть чек-лист за человека.
 */
export function buildExecutiveDocsReviewer(
  platform: Platform,
  tenantId: string,
  now: string,
  collected: CollectedDuringCheck,
  depth: DepthMode,
): ObjectReviewer["review"] {
  return async (context) => {
    const checklist = buildStartChecklist({});

    const works = [...collected.extracted]
      .sort((a, b) => Number(b.amount) - Number(a.amount))
      .slice(0, 25)
      .map((row) => ({
        ordinal: row.ordinal,
        name: row.sourceName,
        basis: row.basis,
        unit: row.unit,
        ...(row.quantity === undefined ? {} : { quantity: row.quantity }),
        amount: row.amount,
        sourceRow: row.sourceRow,
        ...источникПозиции(collected, row.document),
      }));

    const result = await platform.operations.run<unknown, ExecutiveDocsBody>(
      "run-executive-docs",
      {
        documentPath: context.objectPath,
        depth,
        contentHash: (collected.documentHashes[0]?.contentHash ?? "") as Sha256,
        works,
        startChecklistOpen: checklist.unanswered.map(
          (item) => `${item.question} — ${item.consequence}`,
        ),
        missing: [
          "график работ — без него дата освидетельствования не считается",
          "план закрытия: за десять рабочих дней до него пакет обязан быть собран",
          "ответы на чек-лист старта: сейчас не отвечен ни один пункт",
        ],
      },
      { tenantId, entryPoint: "subgraph", subjects: new Map(), now },
    );

    if (!result.ok) throw new Error("операция исполнительной документации заблокирована");

    return {
      verdict: result.artifact.body.verdict,
      depthViolations: result.artifact.body.depth.violations,
      findings: result.artifact.body.findings.map(мнение),
      openQuestions: result.artifact.body.openQuestions,
      sections: result.artifact.body.sections,
    };
  };
}

/** Паспорт объекта (Настенька) — объектный агент такта 0. */
export function buildObjectPassportReviewer(
  platform: Platform,
  tenantId: string,
  now: string,
  collected: CollectedDuringCheck,
  depth: DepthMode,
): ObjectReviewer["review"] {
  return async (context) => {
    const byTable = new Map<string, { name: string; count: number; amount: Decimal }>();

    for (const row of сСуммой(collected.extracted)) {
      const table = normTable(row.basis);
      const existing = byTable.get(table);

      byTable.set(table, {
        name: existing?.name ?? row.sourceName,
        count: (existing?.count ?? 0) + 1,
        amount: (existing?.amount ?? new Decimal(0)).plus(row.amount),
      });
    }

    const result = await platform.operations.run<unknown, ObjectPassportBody>(
      "run-object-passport",
      {
        documentPath: context.objectPath,
        depth,
        contentHash: (collected.documentHashes[0]?.contentHash ?? "") as Sha256,
        objectCode: context.objectPath.split("/").pop() ?? context.objectPath,
        documents: context.documents.map((document) => ({
          fileName: document.path.split("/").pop() ?? document.path,
          kind: document.kind,
          status: document.status,
          ...(document.reason === undefined ? {} : { reason: document.reason }),
        })),
        workGroups: [...byTable]
          .map(([table, group]) => ({
            table,
            name: group.name,
            count: group.count,
            amount: group.amount.toFixed(2),
          }))
          .sort((a, b) => Number(b.amount) - Number(a.amount))
          .slice(0, 15),
        positions: collected.extracted.length,
        ...(context.declaredTotal === undefined ? {} : { declaredTotal: context.declaredTotal }),
        // «Ожидается позже» и «отсутствует» — разные вещи; смешать их значит
        // либо поднять ложную тревогу, либо скрыть настоящую пропажу.
        expectedLater: [
          "финмодель и потолки — такт 2",
          "карта лид-таймов и коммерческие предложения — такт 3",
          "реестр исполнительной документации — по мере выполнения работ",
        ],
      },
      { tenantId, entryPoint: "subgraph", subjects: new Map(), now },
    );

    if (!result.ok) throw new Error("операция паспорта объекта заблокирована");

    return {
      verdict: result.artifact.body.verdict,
      depthViolations: result.artifact.body.depth.violations,
      findings: result.artifact.body.findings.map(мнение),
      openQuestions: result.artifact.body.openQuestions,
      sections: result.artifact.body.sections,
    };
  };
}

/**
 * Договорный аудит (Виктор) — объектный агент.
 *
 * `hasContractText: false` стоит здесь ЖЁСТКО, а не читается из настроек: текста
 * договора система сегодня не хранит нигде, и вычислять признак из пустоты
 * значило бы обещать, что когда-нибудь он посчитается сам. Появится хранилище
 * договоров — здесь будет чтение, и признак станет вопросом к нему.
 */
export function buildContractAuditReviewer(
  platform: Platform,
  tenantId: string,
  now: string,
  collected: CollectedDuringCheck,
  depth: DepthMode,
): ObjectReviewer["review"] {
  return async (context) => {
    // Дорогие позиции: спор о принадлежности идёт именно за них, и матрица
    // разграничения по грошовым строкам никому не нужна (дельта В-4).
    const works = [...collected.extracted]
      .sort((a, b) => Number(b.amount) - Number(a.amount))
      .slice(0, 25)
      .map((row) => ({
        ordinal: row.ordinal,
        name: row.sourceName,
        basis: row.basis,
        unit: row.unit,
        ...(row.quantity === undefined ? {} : { quantity: row.quantity }),
        amount: row.amount,
        sourceRow: row.sourceRow,
        ...источникПозиции(collected, row.document),
      }));

    const result = await platform.operations.run<unknown, ContractAuditBody>(
      "run-contract-audit",
      {
        documentPath: context.objectPath,
        depth,
        contentHash: (collected.documentHashes[0]?.contentHash ?? "") as Sha256,
        works,
        hasContractText: false,
        missing: [
          "текст договора — без него red-flag аудит не выполняется",
          "сторона сделки: генподряд или субподряд. От неё зависит, какое условие защищает, а какое бьёт",
          "график платежей и срок оплаты КС-2",
        ],
      },
      { tenantId, entryPoint: "subgraph", subjects: new Map(), now },
    );

    if (!result.ok) throw new Error("операция договорного аудита заблокирована");

    return {
      verdict: result.artifact.body.verdict,
      depthViolations: result.artifact.body.depth.violations,
      findings: result.artifact.body.findings.map(мнение),
      openQuestions: result.artifact.body.openQuestions,
      sections: result.artifact.body.sections,
    };
  };
}

/**
 * Ведомость распределения работ (Халиль) — объектный агент.
 *
 * Группировка по таблице норм, а не по сумме: пакет отдают на сторону целиком,
 * и «прокладка кабеля» — это одна работа, в скольких бы строках сметы она ни
 * стояла.
 *
 * Итог группы и сумма представительной позиции передаются РАЗДЕЛЬНО. Подставить
 * итог группы в замечание об одной строке значило бы приписать ей чужие деньги.
 */
export function buildSubcontractPlanReviewer(
  platform: Platform,
  tenantId: string,
  now: string,
  collected: CollectedDuringCheck,
  depth: DepthMode,
): ObjectReviewer["review"] {
  return async (context) => {
    const byTable = new Map<
      string,
      {
        name: string;
        count: number;
        amount: Decimal;
        ordinal: string;
        ordinalAmount: string;
        sourceRow: number;
        /** Документ ПРЕДСТАВИТЕЛЯ группы: замечание сошлётся именно на него. */
        document: string;
      }
    >();

    for (const row of сСуммой(collected.extracted)) {
      const table = normTable(row.basis);
      const existing = byTable.get(table);
      // Представитель группы — самая дорогая её позиция: замечание сошлётся на
      // неё, и её же деньги пойдут в основание.
      const richer = existing === undefined || Number(row.amount) > Number(existing.ordinalAmount);

      byTable.set(table, {
        name: richer ? row.sourceName : existing.name,
        count: (existing?.count ?? 0) + 1,
        amount: (existing?.amount ?? new Decimal(0)).plus(row.amount),
        ordinal: richer ? row.ordinal : existing.ordinal,
        ordinalAmount: richer ? row.amount : existing.ordinalAmount,
        sourceRow: richer ? row.sourceRow : existing.sourceRow,
        // Документ едет вместе со строкой: группа собирается по нормативной
        // таблице ПОПЕРЁК смет, и строка представителя принадлежит одному
        // конкретному файлу, а не всем сразу.
        document: richer ? row.document : existing.document,
      });
    }

    const result = await platform.operations.run<unknown, SubcontractPlanBody>(
      "run-subcontract-plan",
      {
        documentPath: context.objectPath,
        depth,
        contentHash: (collected.documentHashes[0]?.contentHash ?? "") as Sha256,
        packages: [...byTable]
          .map(([table, group]) => ({
            table,
            name: group.name,
            count: group.count,
            groupAmount: group.amount.toFixed(2),
            ordinal: group.ordinal,
            ordinalAmount: group.ordinalAmount,
            sourceRow: group.sourceRow,
            ...источникПозиции(collected, group.document),
          }))
          .sort((a, b) => Number(b.groupAmount) - Number(a.groupAmount))
          .slice(0, 20),
        hasCandidates: false,
        missing: [
          "реестр субподрядчиков — без него скоринг не существует",
          "финотчётность кандидатов за последний год, ФССП и арбитраж",
          "график работ — без него срок мобилизации не считается",
        ],
      },
      { tenantId, entryPoint: "subgraph", subjects: new Map(), now },
    );

    if (!result.ok) throw new Error("операция распределения работ заблокирована");

    return {
      verdict: result.artifact.body.verdict,
      depthViolations: result.artifact.body.depth.violations,
      findings: result.artifact.body.findings.map(мнение),
      openQuestions: result.artifact.body.openQuestions,
      sections: result.artifact.body.sections,
    };
  };
}

/**
 * Вердикт объекта (Артемий) — агент СИНТЕЗА.
 *
 * Работает третьей фазой: ему нужны замечания остальных, а параллельные задачи
 * результатов друг друга не видят.
 */
export function buildVerdictReviewers(
  platform: Platform,
  tenantId: string,
  now: string,
  depth: DepthMode = "стандарт",
): (collected: CollectedDuringCheck) => readonly SynthesisReviewer[] {
  return (collected) => {
    if (platform.operations.definition("run-verdict") === undefined) return [];

    return [
      {
        capability: "object_verdict",
        review: async (context) => {
          const result = await platform.operations.run<unknown, VerdictAgentBody>(
            "run-verdict",
            {
              documentPath: context.objectPath,
              depth,
              contentHash: (collected.documentHashes[0]?.contentHash ?? "") as Sha256,
              // Итог обхода и гейты вердикту не принадлежат: он их читает, а не
              // выносит. Подменить детерминированный итог мнением модели значило
              // бы отменить §12.1.
              walkVerdict: "посчитан детерминированно, см. гейты",
              gates: [],
              peers: context.reviews.map((review) => ({
                capability: review.capability ?? "неизвестный",
                verdict: review.verdict ?? "",
                findings: review.findings.map((finding) => ({
                  severity: finding.severity,
                  statement: finding.statement,
                })),
                ...(review.error === undefined ? {} : { error: review.error }),
              })),
              missing: ["выручка и себестоимость по договору", "график работ и платежей"],
            },
            { tenantId, entryPoint: "subgraph", subjects: new Map(), now },
          );

          if (!result.ok) throw new Error("операция вердикта заблокирована");

          return {
            verdict: result.artifact.body.verdict,
            depthViolations: result.artifact.body.depth.violations,
            findings: result.artifact.body.findings.map(мнение),
            openQuestions: result.artifact.body.openQuestions,
            sections: result.artifact.body.sections,
          };
        },
      },
    ];
  };
}

/**
 * График производства работ (Тимофей) — второй агент СИНТЕЗА.
 *
 * Читает то же, что вердикт, и отвечает на другой вопрос: не «брать ли объект»,
 * а «за сколько он делается и что этот срок сдвинет». Замечание снабженца о
 * длинной поставке — это недели ожидания; замечание ПТО о незакрытом чек-листе
 * старта — недели до выхода на объект.
 *
 * Он десятый документ пакета, который девять месяцев значился объявленным
 * отсутствием: «агента нет».
 */
export function buildScheduleReviewers(
  platform: Platform,
  tenantId: string,
  now: string,
  depth: DepthMode = "стандарт",
): (collected: CollectedDuringCheck) => readonly SynthesisReviewer[] {
  return (collected) => {
    if (platform.operations.definition("run-schedule") === undefined) return [];

    return [
      {
        capability: "work_schedule",
        review: async (context) => {
          const result = await platform.operations.run<unknown, ScheduleAgentBody>(
            "run-schedule",
            {
              documentPath: context.objectPath,
              depth,
              contentHash: (collected.documentHashes[0]?.contentHash ?? "") as Sha256,
              walkVerdict: "посчитан детерминированно, см. гейты",
              // Объём — грубая мера работ: сколько смет разобрано и сколько в
              // них позиций. Точнее из обхода не взять, и притворяться, что
              // взято, нельзя.
              estimates: collected.documentHashes.length,
              positions: collected.linearPositions.length,
              peers: context.reviews.map((review) => ({
                capability: review.capability ?? "неизвестный",
                verdict: review.verdict ?? "",
                findings: review.findings.map((finding) => ({
                  severity: finding.severity,
                  statement: finding.statement,
                })),
                ...(review.error === undefined ? {} : { error: review.error }),
              })),
              missing: [
                "дата подписания договора (Т0)",
                "срок производства работ по проектной документации",
                "график поставки давальческого оборудования",
              ],
            },
            { tenantId, entryPoint: "subgraph", subjects: new Map(), now },
          );

          if (!result.ok) throw new Error("операция графика заблокирована");

          return {
            verdict: result.artifact.body.verdict,
            depthViolations: result.artifact.body.depth.violations,
            findings: result.artifact.body.findings.map(мнение),
            openQuestions: result.artifact.body.openQuestions,
            sections: result.artifact.body.sections,
          };
        },
      },
    ];
  };
}


/**
 * ПРИЧИНА ОТКАЗА — СВОДКОЙ, А НЕ ТРИДЦАТЬ РАЗ ОДНА ФРАЗА.
 *
 * Замечания разбора склеивались подряд, и на смете с тридцатью нераскрытыми
 * позициями экран показывал «строка „Всего по позиции“ без суммы» тридцать раз.
 * Читателю это говорит ровно то же, что одна фраза, — но занимает экран и
 * выглядит поломкой вывода.
 *
 * Хуже другое: НОМЕР СТРОКИ БЫЛ В ДАННЫХ И НЕ ПОПАДАЛ В ТЕКСТ. То есть
 * повторялось бесполезное, а единственное полезное — где именно смотреть —
 * терялось. Теперь одинаковые замечания сводятся, и рядом стоят номера строк.
 *
 * Номеров показывается не больше десяти: список из тридцати чисел в ячейке
 * таблицы читается не лучше, чем тридцать одинаковых фраз. Остаток назван
 * числом, а не отброшен молча.
 */
export function причинойОтказа(
  issues: readonly { readonly message: string; readonly row?: number }[],
): string {
  const поСообщению = new Map<string, number[]>();

  for (const issue of issues) {
    const строки = поСообщению.get(issue.message) ?? [];
    if (issue.row !== undefined) строки.push(issue.row);
    поСообщению.set(issue.message, строки);
  }

  return [...поСообщению.entries()]
    .map(([сообщение, строки]) => {
      if (строки.length === 0) return сообщение;
      if (строки.length === 1) return `${сообщение} (строка ${строки[0]})`;

      const показать = строки.slice(0, 10).join(", ");
      const хвост = строки.length > 10 ? ` и ещё ${строки.length - 10}` : "";
      return `${сообщение} — ${строки.length} строк: ${показать}${хвост}`;
    })
    .join("; ");
}
