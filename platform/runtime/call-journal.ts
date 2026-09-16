/**
 * Журнал обращений к моделям (ADR-R-020, механизм 3).
 *
 * Это не накладные расходы: ТЗ §8.3 требует Регламент передачи данных как
 * результат этапа 1, а §12.1л проверяется ИМЕННО записями журнала — «обращение
 * к внешним моделям происходит только по процессам Регламента и только после
 * анонимизации, что подтверждается записями журнала».
 *
 * Поэтому журнал периода разработки прямо становится черновиком договорного
 * артефакта и доказательной базой приёмки, а не отладочным логом.
 */
import type { Contour, DataClass } from "../extensions/manifest.js";
import { isConfidential } from "../extensions/manifest.js";

export interface ModelCallRecord {
  readonly at: string;
  readonly process: string;
  readonly operationId: string;
  readonly tenantId: string;
  readonly contour: Contour;
  readonly provider: string;
  readonly model: string;
  readonly dataClasses: readonly DataClass[];
  /** Применена ли анонимизация до отправки (обязательна для внешнего контура). */
  readonly anonymized: boolean;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export type JournalRejection = {
  readonly kind: "confidential_without_anonymization";
  readonly dataClass: DataClass;
  readonly process: string;
};

/**
 * Запись, собранная в момент обращения.
 *
 * Арендатора здесь НЕТ намеренно: композиционный корень, где живёт вызов
 * модели, его не знает — он приходит с транзакцией на записи. Поле,
 * заполненное пустой строкой «чтобы тип сошёлся», было бы ложью в журнале,
 * который потом предъявляют по §12.1л.
 */
export type CollectedModelCall = Omit<ModelCallRecord, "tenantId">;

/**
 * Проверка перед обращением во внешний контур.
 *
 * ТЗ формулирует запрет без оговорок: «сведения, составляющие коммерческую тайну
 * Заказчика, в исходном виде за пределы его контура не передаются ни при каких
 * режимах работы Системы». Поэтому это отказ, а не предупреждение.
 */
export function checkExternalCall(entry: ModelCallRecord): JournalRejection | undefined {
  if (entry.contour !== "external" || entry.anonymized) {
    return undefined;
  }

  const leaking = entry.dataClasses.find(isConfidential);

  return leaking === undefined
    ? undefined
    : { kind: "confidential_without_anonymization", dataClass: leaking, process: entry.process };
}

/**
 * ЖУРНАЛ В ПАМЯТИ УДАЛЁН 02.09.2026.
 *
 * Здесь был `InMemoryCallJournal` со сводкой `externalProcesses()` —
 * «заготовка Регламента передачи данных». Его вытеснила таблица `model_call`
 * и `platform/db/model-call-repository.ts`.
 *
 * Причина не в стиле. Сводка для Регламента строится по ВСЕЙ истории
 * обращений, а журнал в памяти знал только текущий процесс: воркер, который
 * перезапустили, отчитывался бы за неполный период и выглядел бы при этом
 * исправным. Предъявлять такую сводку по §12.1л нельзя.
 *
 * `checkExternalCall` остался: он проверяет саму ЗАПИСЬ перед сохранением —
 * см. репозиторий.
 */
