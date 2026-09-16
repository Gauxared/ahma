/**
 * Отсутствие значения как значение.
 *
 * ОТКУДА ЭТО ВЗЯТО
 *
 * Из макетов заказчика, где на первом экране собственника стоят «НЕ
 * РАССЧИТАНО», «НЕДОСТОВЕРЕН» и «₽ н/д» — не прочерки и не нули. Это самая
 * зрелая часть тех макетов: дашборды обычно ставят на такое место ноль, и он
 * читается как факт.
 *
 * КАЖДАЯ ПРИЧИНА СООТВЕТСТВУЕТ НАСТОЯЩЕМУ СОСТОЯНИЮ СИСТЕМЫ
 *
 * Список не выдуман под интерфейс — он перечисляет то, что уже умеет
 * производить ядро, и слова взяты оттуда же:
 *
 * | Причина                  | Кто её производит |
 * |---|---|
 * | `not_computed`           | операция не запускалась либо не имела входов |
 * | `missing_capability`     | реестр способностей: обязательная не разрешена (ADR-R-026) |
 * | `degraded`             | источник выключен областью знания (ADR-R-024, О-17) |
 * | `not_implemented`        | правило или агент не реализованы (О-14) |
 * | `unreliable`             | значение есть, но предъявлять его фактом нельзя |
 * | `awaiting_confirmation`  | шаг подтверждения останавливает расчёт (§5.2) |
 *
 * Завести здесь причину, которой не соответствует состояние ядра, значит
 * получить интерфейс, объясняющий пустоту, которой в системе нет.
 *
 * Почему не в `packages/contracts`: это словарь ПРЕДЪЯВЛЕНИЯ, а не стыка между
 * модулями. Узкая талия (ADR-R-025) описывает, что модули передают друг другу;
 * как показать отсутствие человеку — забота поверхности.
 */

export type Absence =
  | { readonly kind: "not_computed"; readonly what: string }
  | { readonly kind: "missing_capability"; readonly capability: string }
  | { readonly kind: "degraded"; readonly source: string }
  | { readonly kind: "not_implemented"; readonly rule: string }
  | { readonly kind: "unreliable"; readonly why: string }
  | { readonly kind: "awaiting_confirmation"; readonly subject: string };

export interface AbsenceView {
  /** Короткое слово на месте числа. Заглавными: это не значение, а его класс. */
  readonly label: string;
  /** Одна фраза «почему» — она и есть ответ на вопрос «что теперь делать». */
  readonly reason: string;
  readonly tone: "warn" | "danger" | "plain";
}

export function describeAbsence(absence: Absence): AbsenceView {
  switch (absence.kind) {
    case "not_computed":
      return {
        label: "НЕ РАССЧИТАНО",
        reason: `Расчёт не выполнялся: ${absence.what}.`,
        tone: "danger",
      };
    case "missing_capability":
      return {
        label: "НЕТ ВХОДА",
        reason: `Обязательная способность «${absence.capability}» не разрешена — операция не стартовала и назвала недостающее.`,
        tone: "danger",
      };
    case "degraded":
      return {
        label: "ИСТОЧНИК ВЫКЛЮЧЕН",
        reason: `Источник «${absence.source}» выключен областью знания этого прогона. Деградация объявлена и вошла в отпечаток входов.`,
        tone: "warn",
      };
    case "not_implemented":
      return {
        label: "НЕ РЕАЛИЗОВАНО",
        reason: `${absence.rule} — правило требует входов, которых нет; шаг объявлен невыполненным, а не изображён.`,
        tone: "plain",
      };
    case "unreliable":
      return {
        label: "НЕДОСТОВЕРНО",
        reason: `${absence.why}. Значение не выдаётся за факт.`,
        tone: "warn",
      };
    case "awaiting_confirmation":
      return {
        label: "ЖДЁТ ПОДТВЕРЖДЕНИЯ",
        reason: `Расчёт остановлен до подтверждения «${absence.subject}» человеком: результат по неподтверждённым входам был бы догадкой в виде факта.`,
        tone: "warn",
      };
  }
}
