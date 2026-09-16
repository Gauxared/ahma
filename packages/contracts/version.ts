/**
 * Версия контрактов узкой талии (ADR-R-025, ADR-R-028).
 *
 * Правило эволюции: внутри мажорной версии допускаются ТОЛЬКО добавляющие
 * изменения — новое необязательное поле, новый член объединения, новый тип.
 * Удаление, переименование или изменение смысла поля требует новой мажорной
 * версии. Это правило снимает большую часть боли совместимости при
 * подключении новых модулей, источников и адаптеров.
 */
export const CONTRACT_VERSION = "1.0.0" as const;
export const CONTRACT_MAJOR = 1 as const;

export type ContractVersion = typeof CONTRACT_VERSION;

/** Совместим ли контракт, объявленный расширением, с текущим ядром. */
export function isCompatibleContract(declared: string): boolean {
  const major = Number.parseInt(declared.split(".")[0] ?? "", 10);
  return Number.isInteger(major) && major === CONTRACT_MAJOR;
}
