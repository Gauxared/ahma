/**
 * Маршрутизация приёма и гейт неполноты (ADR-R-012, ШАГИ 2–5 Дирижёра).
 *
 * Источник — легаси-промпт
 * `reference-system-new/Выход/СтройИнтеллект.Plus_ДИРИЖЁР_v9.8.txt`, ЧАСТЬ 3.
 * Таблица маршрута лежит в `config/routing.json` и перенесена построчно.
 *
 * ТРИ ВЕЩИ, СДЕЛАННЫЕ ЛУЧШЕ ОРИГИНАЛА
 *
 * 1. Маршрут на неполных данных НЕВОЗМОЖЕН, а не запрещён.
 *    Легаси: «Если данных не хватает для честного маршрута — НЕ угадывай».
 *    Инструкция, которую модель нарушает тем охотнее, чем правдоподобнее
 *    догадка. Здесь неполный паспорт даёт результат ДРУГОГО ТИПА: в нём нет
 *    поля с конфигурацией, и подставить его неоткуда.
 *
 * 2. Причина маршрута — факт, а не проза.
 *    Легаси просит модель написать «ПОЧЕМУ: [1–2 строки по критериям]».
 *    Написанное можно не сверить с решением. Здесь причина — это критерий
 *    правила, которое сработало: он не может разойтись с маршрутом, потому
 *    что взят из него.
 *
 * 3. «В работе» и «нужно уточнить» отвергаются механически.
 *    Легаси говорит «как итог — не результат», но принимает такую строку как
 *    заполненное поле. Здесь это те же незаполненные поля.
 *
 * ПОРЯДОК ПРАВИЛ ЗНАЧИМ. В оригинале строки таблицы читаются сверху вниз, и
 * «сторона ЗАКАЗЧИКА» стоит отдельной строкой: у заказчика линзы зеркальны, и
 * профильный домен этого не отменяет. Порядок сохранён, первое подошедшее
 * правило выигрывает.
 */
import type { Passport } from "./passport.js";

export interface RouteRule {
  readonly id: string;
  /** Условие: подмножество полей паспорта. Пустое условие подходит всегда. */
  readonly when: {
    // `| undefined` явно: конфиг после разбора схемой несёт необязательные поля
    // именно так, и сужать их здесь значило бы требовать лишнего копирования.
    readonly domain?: string | undefined;
    readonly side?: string | undefined;
    readonly stage?: string | undefined;
    readonly volume?: string | undefined;
    readonly goal?: string | undefined;
  };
  readonly note?: string | undefined;
  readonly configuration: string;
  readonly agent: string;
  /** Критерий легаси, по которому правило сработало. */
  readonly criterion: string;
}

export interface RoutingTable {
  readonly routes: readonly RouteRule[];
  /** Поля паспорта, без которых маршрут не выдаётся. */
  readonly requiredForRoute: readonly string[];
}

export interface MissingField {
  readonly field: string;
  readonly why: string;
  readonly who: string;
}

export type RoutingResult =
  | {
      readonly kind: "route";
      readonly routeId: string;
      readonly configuration: string;
      readonly agent: string;
      readonly criterion: string;
    }
  | { readonly kind: "gate"; readonly missing: readonly MissingField[] };

/**
 * Почему каждое поле нужно и у кого его спрашивать.
 *
 * Список «что дозагрузить» без ответа «зачем» человек откладывает: непонятно,
 * что сломается. Легаси требует «с датой/адресатом» — адресат здесь, дату
 * ставит тот, кто ведёт объект.
 */
const WHY: Readonly<Record<string, MissingField>> = {
  domain: {
    field: "domain",
    why: "без домена не выбрать профильного инженера: вода, монтаж, дороги и сети — разные линзы",
    who: "тот, кто передал объект",
  },
  side: {
    field: "side",
    why: "у заказчика линзы зеркальны подрядным: та же смета читается противоположно",
    who: "тот, кто передал объект",
  },
  goal: {
    field: "goal",
    why: "быстрый вердикт «брать/не брать» и полное сопровождение — разные конфигурации и разный срок",
    who: "тот, кто передал объект",
  },
  stage: {
    field: "stage",
    why: "стадия определяет, кто ведёт объект: до рабочки — ГАП, в рабочке — ГИП",
    who: "выводится из состава пакета",
  },
  volume: {
    field: "volume",
    why: "объём разводит Light и Оркестр",
    who: "выводится из состава пакета",
  },
};

/**
 * Значения, которые выглядят заполненными, но результатом не являются.
 * Прямая цитата протокола: «"В работе" и "нужно уточнить" как итог — не результат».
 */
const NOT_AN_ANSWER = /^\s*(в работе|нужно уточнить|уточняется|tbd|—|-)\s*$/i;

function valueOf(passport: Passport, field: string): string | undefined {
  const raw =
    field === "domain"
      ? passport.domain
      : field === "side"
        ? passport.side
        : field === "goal"
          ? passport.goal
          : field === "stage"
            ? passport.stage
            : field === "volume"
              ? passport.volume
              : undefined;

  if (raw === undefined || raw === "" || NOT_AN_ANSWER.test(raw)) return undefined;
  return raw;
}

function matches(rule: RouteRule, passport: Passport): boolean {
  for (const [field, expected] of Object.entries(rule.when)) {
    if (expected === undefined) continue;
    if (valueOf(passport, field) !== expected) return false;
  }
  return true;
}

export function route(passport: Passport, table: RoutingTable): RoutingResult {
  const missing = table.requiredForRoute
    .filter((field) => valueOf(passport, field) === undefined)
    .map((field) => WHY[field] ?? { field, why: "поле обязательно для маршрута", who: "тот, кто передал объект" });

  // Гейт неполноты: маршрута нет как значения, а не как запрета.
  if (missing.length > 0) return { kind: "gate", missing };

  const rule = table.routes.find((candidate) => matches(candidate, passport));

  if (rule === undefined) {
    // Таблица без замыкающего правила — ошибка конфигурации, а не повод
    // выдумать маршрут.
    return {
      kind: "gate",
      missing: [
        {
          field: "routing-table",
          why: "ни одно правило таблицы не подошло, а замыкающего правила в ней нет",
          who: "тот, кто ведёт config/routing.json",
        },
      ],
    };
  }

  return {
    kind: "route",
    routeId: rule.id,
    configuration: rule.configuration,
    agent: rule.agent,
    criterion: rule.criterion,
  };
}
