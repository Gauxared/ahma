/**
 * Контракт задачи «Проверка»: тип и полезная нагрузка.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫМ ФАЙЛОМ, А НЕ РЯДОМ С ИСПОЛНИТЕЛЕМ
 *
 * Тип задачи — одна строка, и держать её возле исполнителя удобно ровно до
 * первого потребителя, которому нужна только строка. Маршрут `/api/checks`
 * ставит задачу в очередь и ничего не исполняет, но импорт `CHECK_JOB_TYPE` из
 * `check-executor` тянул весь граф: исполнитель → порты → читатель PDF, — а тот
 * в серверном бандле Next не инициализируется. Постановка Проверки из веба
 * падала пятисоткой:
 *
 *     TypeError: Object.defineProperty called on non-object
 *       at platform/storage/pdf-reader.ts
 *
 * Здесь нет ни одного импорта, и это свойство файла, а не совпадение: тот, кому
 * нужно ПОСТАВИТЬ задачу, не должен зависеть от того, чем она исполняется.
 */

export const CHECK_JOB_TYPE = "check";

export interface CheckPayload {
  readonly objectPath: string;
  readonly objectCode: string;
}

export function parseCheckPayload(payload: unknown): CheckPayload {
  const value = payload as Partial<CheckPayload> | null;

  if (value === null || typeof value !== "object") {
    throw new Error("полезная нагрузка задачи не является объектом");
  }

  if (typeof value.objectPath !== "string" || value.objectPath === "") {
    throw new Error("в задаче не указан путь объекта (objectPath)");
  }

  return {
    objectPath: value.objectPath,
    objectCode: typeof value.objectCode === "string" ? value.objectCode : value.objectPath,
  };
}
