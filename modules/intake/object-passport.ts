/**
 * Такт 0: паспорт объекта и реестр поручений (Настенька).
 *
 * Источник — легаси-протокол
 * `reference-system/skills/stroiintellect-master/.../references/workflow.md`,
 * ТАКТ 0 (≤ 2 часов от получения задания).
 *
 * ЧЕМ ЭТО ЛУЧШЕ ОРИГИНАЛА
 *
 * В легаси реестр поручений — таблица, которую Настенька заполняет и ведёт
 * руками. У неё два способа разойтись с реальностью, и оба срабатывают:
 *
 *  · состав поручений расходится с протоколом при первой же правке тактов —
 *    в таблице остаётся агент, которого из воркфлоу убрали, и наоборот;
 *  · статус 🔴/🟡/🟢 проставляет человек и забывает обновить, поэтому реестр
 *    показывает вчерашнее состояние как сегодняшнее.
 *
 * Здесь реестр ВЫВОДИТСЯ из того же воркфлоу, который исполняется, а статус
 * ВЫЧИСЛЯЕТСЯ по состоянию предметов. Разойтись с протоколом он не может,
 * потому что не является отдельной записью о нём.
 *
 * ТРИ ЦВЕТА, А НЕ ДВА. В шаблоне легаси стартовый статус 🔴 у всех строк, а
 * промежуточного нет. Но шаг производит несколько предметов, и «выдал один из
 * двух» — это не «не начал» и не «сделал». Жёлтый статус для частичной
 * готовности добавлен: без него половина работы Денчика молча считалась бы
 * либо отсутствующей, либо законченной.
 *
 * ВОЗВРАЩЁННЫЙ ПРЕДМЕТ — ВСЕГДА КРАСНЫЙ, даже если остальные готовы. «Сделано
 * и отвергнуто» — не то же самое, что «в работе»: в первом случае нужен
 * пересчёт, во втором надо просто ждать. Легаси помечает возвращённый ВОР
 * именно 🔴, и жёлтый цвет здесь спрятал бы необходимость переделки за видом
 * нормального хода работ.
 */

/** Что человек объявил об объекте. Ничего из этого не выводится из папки. */
export interface DeclaredObject {
  readonly name?: string;
  readonly address?: string;
  readonly customer?: string;
  readonly contractNumber?: string;
  readonly contractPrice?: string;
  readonly startsOn?: string;
  readonly dueOn?: string;
}

export interface PackageComposition {
  readonly volumes: number;
  readonly estimates: number;
  readonly hasSummary: boolean;
  readonly total: number;
}

export interface ObjectPassportInput {
  readonly objectPath: string;
  readonly declared: DeclaredObject;
  readonly composition: PackageComposition;
}

export interface ObjectPassport {
  readonly objectPath: string;
  readonly name: string | undefined;
  readonly address: string | undefined;
  readonly customer: string | undefined;
  readonly contractNumber: string | undefined;
  readonly contractPrice: string | undefined;
  readonly startsOn: string | undefined;
  readonly dueOn: string | undefined;
  readonly composition: PackageComposition;
}

export function buildObjectPassport(input: ObjectPassportInput): ObjectPassport {
  return {
    objectPath: input.objectPath,
    name: input.declared.name,
    address: input.declared.address,
    customer: input.declared.customer,
    contractNumber: input.declared.contractNumber,
    contractPrice: input.declared.contractPrice,
    startsOn: input.declared.startsOn,
    dueOn: input.declared.dueOn,
    composition: input.composition,
  };
}

/**
 * Печать по шаблону легаси.
 *
 * Различаются два вида пустоты, и это различие из оригинала:
 *  · `❌` — не дано, спрашивать у того, кто передал объект;
 *  · `ждём — такт-N` — работа НАЗНАЧЕНА другому агенту и идёт по протоколу.
 *
 * Смешать их значит либо дёргать человека за тем, что и так придёт, либо
 * ждать того, чего никто не делает.
 */
export function renderObjectPassport(passport: ObjectPassport): string {
  const { composition } = passport;

  return [
    `ОБЪЕКТ: ${passport.name ?? "❌"}${passport.address === undefined ? "" : `, ${passport.address}`}`,
    `ЗАКАЗЧИК: ${passport.customer ?? "❌"}` +
      (passport.contractNumber === undefined ? "" : `, договор № ${passport.contractNumber}`),
    `НМЦК / Цена договора: ${passport.contractPrice ?? "❌"}`,
    `СРОКИ: начало ${passport.startsOn ?? "❌"} → сдача ${passport.dueOn ?? "❌"}`,
    `СОСТАВ ПАКЕТА: томов РД ${composition.volumes} · смет ${composition.estimates} · ` +
      `сводный расчёт ${composition.hasSummary ? "есть" : "нет"}`,
    "ИНЖЕНЕРНЫЙ ПРОФИЛЬ (Денчик): ждём — такт-1",
    "СТАТУС ИД (Палыч): ждём — такт-1",
    "ТОП-5 РИСКОВ (Артемий): ждём — такт-4",
  ].join("\n");
}

export interface StepForAssignments {
  readonly agent: string;
  readonly produces: readonly string[];
}

export interface StageForAssignments {
  readonly id: string;
  readonly name: string;
  readonly steps: readonly StepForAssignments[];
}

/** 🔴 не начато · 🟡 частично · 🟢 готово. */
export type AssignmentStatus = "🔴" | "🟡" | "🟢";

export interface Assignment {
  readonly number: number;
  readonly agent: string;
  /** Что поручено: продукты шага. */
  readonly task: string;
  readonly stage: string;
  /** Срок в терминах протокола: такт и его название. */
  readonly due: string;
  readonly status: AssignmentStatus;
  readonly produced: readonly string[];
  readonly pending: readonly string[];
}

/**
 * Строит реестр поручений из воркфлоу и текущего состояния предметов.
 *
 * Предмет засчитывается только со статусом `approved`: возвращённый на
 * пересчёт ВОР — это не сделанная работа, и в легаси он ровно так и помечен
 * (🔴 возвращён). Более того, один возвращённый предмет красит всё поручение:
 * см. шапку модуля.
 */
export function buildAssignments(
  stages: readonly StageForAssignments[],
  subjects: ReadonlyMap<string, string>,
): readonly Assignment[] {
  const assignments: Assignment[] = [];
  let number = 0;

  for (const stage of stages) {
    for (const step of stage.steps) {
      number += 1;

      const produced = step.produces.filter((subject) => subjects.get(subject) === "approved");
      const pending = step.produces.filter((subject) => subjects.get(subject) !== "approved");
      const returned = step.produces.some((subject) => subjects.get(subject) === "returned");

      const status: AssignmentStatus = returned
        ? "🔴"
        : produced.length === 0
          ? "🔴"
          : pending.length === 0
            ? "🟢"
            : "🟡";

      assignments.push({
        number,
        agent: step.agent,
        task: step.produces.join(", "),
        stage: stage.id,
        due: `${stage.id} — ${stage.name}`,
        status,
        produced,
        pending,
      });
    }
  }

  return assignments;
}
