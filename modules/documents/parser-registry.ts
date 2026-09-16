/**
 * Реестр адаптеров разбора — роадмап M4.
 *
 *   «`ParserAdapter` как реестр с определением типа по содержимому, а не
 *    `switch` по расширению… Форматы за пределами §8.1 (doc, xlsb, rtf, dwg,
 *    архивы, db4 Кодекса) — политика трека A: либо адаптер, либо явный отказ с
 *    причиной; МОЛЧАЛИВЫЙ ПРОПУСК ЗАПРЕЩЁН.»
 *
 * ГЛАВНОЕ СВОЙСТВО РЕЕСТРА — ОН ВСЕГДА ОТВЕЧАЕТ
 *
 * У `switch` есть ветка `default`, и она почти всегда пустая. Реестр устроен
 * так, что пустой ветки нет: на любой файл возвращается либо разбор, либо отказ
 * С ПРИЧИНОЙ. Третьего исхода — «ничего не произошло» — не существует, потому
 * что именно он даёт зелёный вердикт на неполном обходе (§9).
 *
 * СКАН PDF — ОТКАЗ, А НЕ ПУСТОЙ РАЗБОР
 *
 * §14 исключает распознавание. PDF без текстового слоя разбирается «успешно» и
 * даёт ноль позиций — результат, неотличимый от пустой сметы. Это худший исход
 * из возможных: он выглядит успехом. Поэтому пустой текстовый слой превращается
 * в отказ со ссылкой на §14.
 *
 * ОШИБКА АДАПТЕРА — ТОЖЕ ОТКАЗ, А НЕ ПАДЕНИЕ
 *
 * Один повреждённый файл не должен обрывать обход папки объекта: остальные
 * сметы обязаны быть проверены, а этот — попасть в отчёт как отказ с текстом
 * ошибки. Проглотить исключение и продолжить молча нельзя по той же причине,
 * что и пропуск: обход станет неполным незаметно.
 */
import { detectFormat } from "./format-detector.js";
import type { DocumentFormat } from "./format-detector.js";

/** Что вернул адаптер. `textLength` заполняют форматы с текстовым слоем. */
export interface AdapterOutcome {
  readonly kind: "разобран";
  readonly positions: number;
  /** Длина извлечённого текста. Ноль у PDF означает скан (§14). */
  readonly textLength?: number;
  readonly payload?: unknown;
}

export interface ParserAdapter {
  readonly format: DocumentFormat;
  parse(input: { readonly fileName: string; readonly bytes: Buffer }):
    | AdapterOutcome
    | Promise<AdapterOutcome>;
}

export interface ParseResult {
  readonly status: "разобран" | "отказ";
  readonly format: DocumentFormat;
  readonly positions?: number;
  readonly payload?: unknown;
  /** Заполнена всегда при отказе: отказ без причины неотличим от пропуска. */
  readonly reason?: string;
  readonly note: string;
}

export class ParserRegistry {
  readonly #byFormat: ReadonlyMap<DocumentFormat, ParserAdapter>;

  constructor(adapters: readonly ParserAdapter[]) {
    const byFormat = new Map<DocumentFormat, ParserAdapter>();

    for (const adapter of adapters) {
      if (byFormat.has(adapter.format)) {
        // Два адаптера на формат означают, что выбор между ними где-то неявный.
        throw new Error(`Адаптер для формата ${adapter.format} объявлен дважды`);
      }
      byFormat.set(adapter.format, adapter);
    }

    this.#byFormat = byFormat;
  }

  /** Список поддержанных форматов: он должен быть виден, а не выводиться из кода. */
  supportedFormats(): readonly DocumentFormat[] {
    return [...this.#byFormat.keys()];
  }

  async parse(input: { readonly fileName: string; readonly bytes: Buffer }): Promise<ParseResult> {
    const detection = detectFormat(input);

    if (!detection.supported) {
      return {
        status: "отказ",
        format: detection.format,
        reason: detection.reason ?? `формат ${detection.format} не поддержан`,
        note: detection.note,
      };
    }

    const adapter = this.#byFormat.get(detection.format);

    if (adapter === undefined) {
      return {
        status: "отказ",
        format: detection.format,
        reason:
          `формат ${detection.format} опознан, но адаптер разбора не зарегистрирован: ` +
          "файл не разобран и требует внимания",
        note: detection.note,
      };
    }

    let outcome: AdapterOutcome;
    try {
      outcome = await adapter.parse(input);
    } catch (cause) {
      return {
        status: "отказ",
        format: detection.format,
        reason: `разбор не удался: ${(cause as Error).message}`,
        note: detection.note,
      };
    }

    // §14: скан «разбирается» успешно и даёт ноль позиций — исход, неотличимый
    // от пустой сметы. Отказ обязан быть явным.
    if (detection.format === "pdf" && (outcome.textLength ?? 0) === 0) {
      return {
        status: "отказ",
        format: detection.format,
        reason:
          "PDF без текстового слоя (скан): распознавание исключено из объёма §14. " +
          "Разбор дал бы ноль позиций, неотличимый от пустой сметы",
        note: detection.note,
      };
    }

    const base = {
      status: "разобран" as const,
      format: detection.format,
      positions: outcome.positions,
      note: detection.note,
    };

    return outcome.payload === undefined ? base : { ...base, payload: outcome.payload };
  }
}
