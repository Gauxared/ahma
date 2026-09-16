/**
 * Паспорт входа (ADR-R-012, ШАГ 1 протокола Дирижёра).
 *
 * Источник — легаси-промпт
 * `reference-system-new/Выход/СтройИнтеллект.Plus_ДИРИЖЁР_v9.8.txt`, ЧАСТЬ 3:
 *
 *   ШАГ 1 — ПАСПОРТ ВХОДА. Из присланного собери коротко (что не дано — помечай ❌):
 *     · Домен объекта · Сторона стола · Стадия · Состав и объём данных · Срок и цель
 *
 * ЧТО СДЕЛАНО ЛУЧШЕ ОРИГИНАЛА
 *
 * В легаси «помечай ❌» — инструкция модели. Модель может её нарушить: домен
 * правдоподобно выводится из названий файлов, сторона стола — из тона письма,
 * и паспорт получается полным там, где данных нет. Дальше на этом угаданном
 * паспорте строится маршрут, и ошибка приёма становится ошибкой всего прогона.
 *
 * Здесь невыведенное поле — это `undefined` в типе. Его нечем подставить:
 * функция не принимает источника, из которого можно было бы догадаться.
 *
 * ГРАНИЦА МЕЖДУ ВЫВОДИМЫМ И ОБЪЯВЛЯЕМЫМ
 *
 * Стадия и состав пакета — ФАКТЫ О ПАПКЕ: сколько томов, сколько смет, есть ли
 * сводный расчёт. Их спрашивать не надо, их надо посчитать.
 *
 * Домен, сторона стола и цель — НАМЕРЕНИЕ ЗАКАЗЧИКА. Из состава папки они не
 * следуют: одни и те же ЛСР приходят и от подрядчика, и от заказчика, а линзы
 * при этом зеркальны. Их объявляет человек, и пока он не объявил — их нет.
 */

/** Домены из таблицы маршрута легаси. */
export type Domain = "вода" | "монтаж" | "дороги-инфра" | "сети" | "девелопмент" | "иное";

/** Сторона стола. У заказчика линзы зеркальны — это меняет маршрут. */
export type Side = "подрядчик" | "заказчик";

/** Стадия объекта. Выводится из состава пакета. */
export type Stage = "предпроект" | "есть-рд" | "рд-и-сметы" | "сопровождение";

export type Volume = "малый" | "средний" | "большой";

export interface DocumentSummary {
  readonly name: string;
  readonly kind: string;
}

export interface Composition {
  /** Томов рабочей документации. */
  readonly volumes: number;
  readonly estimates: number;
  readonly hasSummary: boolean;
  readonly total: number;
}

export interface Passport {
  readonly domain: Domain | undefined;
  readonly side: Side | undefined;
  readonly stage: Stage;
  readonly composition: Composition;
  readonly volume: Volume;
  readonly goal: string | undefined;
  /** Поля, которые не выведены. Пустой список — паспорт полон. */
  readonly missing: readonly string[];
}

/** То, что может объявить только человек. */
export interface DeclaredIntake {
  readonly domain?: Domain;
  readonly side?: Side;
  readonly goal?: string;
}

export interface IntakeInput {
  readonly documents: readonly DocumentSummary[];
  readonly declared: DeclaredIntake;
}

/**
 * Порог многотомности взят из легаси: «большой многотомный пакет → Классик(C)».
 * Курганский комплект — 2 тома РД и 4 сметы — по этому порогу средний.
 */
const LARGE_VOLUMES = 3;
const LARGE_ESTIMATES = 10;

function stageOf(composition: Composition): Stage {
  if (composition.estimates > 0) return "рд-и-сметы";
  if (composition.volumes > 0) return "есть-рд";
  return "предпроект";
}

function volumeOf(composition: Composition): Volume {
  if (composition.volumes >= LARGE_VOLUMES || composition.estimates >= LARGE_ESTIMATES) {
    return "большой";
  }
  return composition.total <= 2 ? "малый" : "средний";
}

export function buildPassport(input: IntakeInput): Passport {
  const composition: Composition = {
    volumes: input.documents.filter((document) => document.kind === "рабочая-документация").length,
    estimates: input.documents.filter((document) => document.kind === "лср").length,
    hasSummary: input.documents.some((document) => document.kind === "ссрсс"),
    total: input.documents.length,
  };

  const missing: string[] = [];
  if (input.declared.domain === undefined) missing.push("domain");
  if (input.declared.side === undefined) missing.push("side");
  if (input.declared.goal === undefined) missing.push("goal");

  return {
    ...(input.declared.domain === undefined ? {} : { domain: input.declared.domain }),
    ...(input.declared.side === undefined ? {} : { side: input.declared.side }),
    stage: stageOf(composition),
    composition,
    volume: volumeOf(composition),
    ...(input.declared.goal === undefined ? {} : { goal: input.declared.goal }),
    missing,
  } as Passport;
}

const STAGE_LABEL: Readonly<Record<Stage, string>> = {
  предпроект: "предпроект без смет",
  "есть-рд": "есть РД",
  "рд-и-сметы": "есть РД и сметы",
  сопровождение: "сопровождение",
};

/** Печать в форме оригинала: невыведенное — знаком ❌, а не пропуском строки. */
export function renderPassport(passport: Passport): string {
  const { composition } = passport;

  return [
    `домен: ${passport.domain ?? "❌"}`,
    `сторона стола: ${passport.side ?? "❌"}`,
    `стадия: ${STAGE_LABEL[passport.stage]}`,
    `состав: томов РД ${composition.volumes} · смет ${composition.estimates} · ` +
      `сводный расчёт ${composition.hasSummary ? "есть" : "нет"} · объём ${passport.volume}`,
    `срок и цель: ${passport.goal ?? "❌"}`,
  ].join("\n");
}
