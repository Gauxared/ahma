import { decimal, isoDate, money, sha256, unitCode, type Money, type Quantity } from "@contracts/primitives.js";
import { fromFormula, fromSource, type Acquisition, type Locator, type SourceRef, type SourceStatus } from "@contracts/provenance.js";

import type { ChainLink, Decision, Freshness, Reliability } from "../ui/command/blocks.js";
import { absent, valued, type Shown } from "../ui/value/typed-value.js";

/**
 * ФИКСТУРА, А НЕ ДАННЫЕ.
 *
 * Содержимое перенесено с макетов заказчика (Волковский ГОК, очистные
 * сооружения) и служит одной цели: показать облик штабного экрана на
 * содержательном наборе. В базе этого объекта нет — клиент новый, его
 * `CustomerPack` ещё не заведён.
 *
 * ПОЧЕМУ ЭТО ЛЕЖИТ ЗДЕСЬ, А НЕ ПОДАЁТСЯ ЗА ЖИВОЕ
 *
 * Ровно потому, что уже было решено про веб один раз: опасен не отсутствующий
 * интерфейс, а интерфейс, ВЫГЛЯДЯЩИЙ рабочим и молча ничего не делающий.
 * Страница-образец несёт видимую пометку и живёт в `/preview`, отдельно от
 * шести договорных экранов, чтобы её нельзя было принять за готовую поверхность.
 *
 * ЧТО ЗДЕСЬ ЧЕСТНО ПО ПОСТРОЕНИЮ
 *
 * Каждое число собрано через `Valued` — то есть с происхождением, — а каждая
 * пустота через `Absence` с названной причиной. Собрать иначе нельзя: тип не
 * даёт. Поэтому даже фикстура не может изобразить то, чего система не умеет
 * объяснить: где в макете стоит «≈», здесь стоит либо расчёт с формулой, либо
 * причина отсутствия.
 *
 * Идентификатор клиента в рабочем коде живёт только в `config/customers/**`
 * (ADR-R-010). Здесь он допустим как содержимое образца, но при заведении пака
 * шапка обязана читаться из конфигурации, а не из этого файла.
 */

const TODAY = isoDate("2026-09-01");

/** Заглушки хэшей: в живом прогоне это хэш содержимого записи (ADR-R-027). */
function hash(seed: string): ReturnType<typeof sha256> {
  const base = seed.replace(/[^a-z0-9]/gi, "").toLowerCase() || "0";
  return sha256(base.repeat(Math.ceil(64 / base.length)).slice(0, 64).replace(/[^0-9a-f]/g, "0"));
}

function ref(
  sourceId: string,
  locator: Locator,
  status: SourceStatus,
  checkedAt: string,
  acquisition: Acquisition = "parsed",
): SourceRef {
  return {
    sourceId,
    contentHash: hash(sourceId),
    locator,
    status,
    acquisition,
    checkedAt: isoDate(checkedAt),
    staleAfterDays: 90,
  };
}

/* ========================================================================= */
/* Шапка                                                                     */
/* ========================================================================= */

export const OBJECT = {
  name: "Волковский ГОК",
  subtitle: "Очистные сооружения",
  code: "2137.19.8",
  contract: "2905/СВ",
  customer: "ООО «УралСпецАвтоматика»",
  /** Отпечаток входов прогона — то, что в макете было надписью «v5.2 FIX». */
  snapshotDigest: "2216fa3c",
} as const;

export const FRESHNESS: readonly Freshness[] = [
  { label: "ЦИМ", date: "22.08.2026", note: "итоговая" },
  { label: "Полевой факт", date: "20.08.2026", note: "ОЖР" },
  { label: "Сборка экрана", date: "01.09.2026" },
];

export const CHAIN = ["Деньги", "Срок", "Заморожено", "Решение сегодня"] as const;

/* ========================================================================= */
/* Показатели                                                                */
/* ========================================================================= */

export const CASH: Shown<Money> = valued(
  fromFormula(
    money("110480.00"),
    {
      // Формула — из реестра `config/formulas/registry.json`, а не придумана
      // под фикстуру: гейт архитектуры поймал первую версию, где стояли
      // несуществующие `finance.free-cash` и `finance.unlinked-payments`
      // (ADR-R-014: формула вне реестра запрещена). Даже образец облика не
      // имеет права ссылаться на расчёт, которого в системе нет.
      formulaId: "calculation.cash-flow",
      formulaVersion: 1,
      inputs: {
        "поступления подтверждённые": money("5800000.00"),
        "платежи по обязательствам": money("5689520.00"),
      },
      output: decimal("110480.00"),
      rounding: "half-up",
    },
  ),
);

export const OWNER_FUNDING: Shown<Money> = valued(
  fromSource(
    money("1800000.00"),
    ref("реестр довнесений собственника", { kind: "row", sheet: "Довнесения", row: 14 }, "fact", "2026-08-22"),
    TODAY,
  ),
);

/**
 * Оборотка. Главная пустота этого экрана — и в макете она подана правильно:
 * «НЕ РАССЧИТАНО» на месте числа, а не ноль и не прочерк.
 */
export const WORKING_CAPITAL: Shown<Money> = absent({
  kind: "not_computed",
  what: "дата и сумма ближайшего подтверждённого входящего не заданы, поэтому исходящие до неё не собраны",
});

export const PRODUCTION_CHAIN: readonly ChainLink[] = [
  { label: "Выполнено", done: true },
  { label: "Предъявлено", done: false },
  { label: "Подписано", done: false },
  { label: "Оплачено", done: false },
];

export const FINANCIAL_RESULT: Shown<Money> = absent({
  kind: "unreliable",
  why: "нет полной себестоимости и закрытий: маржа не моделируется",
});

/**
 * Отклонение срока.
 *
 * Входы — ДЛИТЕЛЬНОСТИ в сутках, а не даты: так это уже устроено в
 * `modules/calculations/deadline-reverse.ts`, где вход тоже `decimal(days)`.
 * Старт отсчёта — 26.08.2025.
 *
 * Отдельно замечено: `FormulaTrace.inputs` типом не принимает `IsoDate`, хотя
 * календарных расчётов в §6.4 несколько (крайний срок заказа, обратный расчёт
 * срока, пеня по дням). Пока это обходится длительностями; если понадобится
 * положить в след саму дату — это правка контракта, а не фикстуры.
 */
export const SCHEDULE_SLIP: Shown<Quantity> = valued(
  fromFormula(
    { value: decimal("154"), unit: unitCode("сут") },
    {
      formulaId: "calculation.deviation",
      formulaVersion: 1,
      inputs: {
        "база: договорный срок, сут от старта": decimal("365"),
        "факт: прогноз сдачи с биологией, сут от старта": decimal("519"),
      },
      output: decimal("154"),
      unit: unitCode("сут"),
      rounding: "half-up",
    },
  ),
);

/* ========================================================================= */
/* А · Где заморожены деньги                                                 */
/* ========================================================================= */

export interface FrozenRow {
  readonly id: string;
  readonly cause: string;
  readonly physical: string;
  readonly amount: Shown<Money>;
  readonly since: string;
  readonly owner: string;
  readonly unblockedBy: string;
}

export const FROZEN: readonly FrozenRow[] = [
  {
    id: "кж-кс2",
    cause: "КЖ выполнен, не закрыт КС-2",
    physical: "Физика КЖ выполнена, КС-2 не подписан",
    amount: absent({ kind: "not_computed", what: "объём не расценён: ВОР по КЖ не собран" }),
    since: "18.08.2026",
    owner: "Виктор · ПТО",
    unblockedBy: "Подписанные КС-2 и ВОР",
  },
  {
    id: "допработы",
    cause: "Допработы без основания",
    physical: "Допработы выполнены, основание не оформлено",
    amount: absent({ kind: "awaiting_confirmation", subject: "перечень допработ" }),
    since: "10.08.2026",
    owner: "Виктор · ПТО",
    unblockedBy: "Основание: акт, письмо или ТЗ",
  },
  {
    id: "давальческое",
    cause: "Давальческое не сведено",
    physical: "Давальческое поставлено, не синхронизировано с М-15",
    amount: absent({ kind: "not_computed", what: "баланс М-15 №4/5 не закрыт" }),
    since: "12.08.2026",
    owner: "Ваныч · Снабжение",
    unblockedBy: "Сверка давальческого и акт приёмки",
  },
  {
    id: "касса-мимо",
    cause: "Касса уходит мимо объекта",
    physical: "Платежи не связаны с физическим прогрессом",
    amount: valued(
      fromFormula(
        money("2490000.00"),
        {
          formulaId: "calculation.deviation",
          formulaVersion: 1,
          inputs: {
            "база: платежи, привязанные к этапам": money("5689520.00"),
            "факт: платежи периода": money("8179520.00"),
          },
          output: decimal("2490000.00"),
          rounding: "half-up",
        },
      ),
    ),
    since: "01.08.2026",
    owner: "Ваныч · Финансы",
    unblockedBy: "Жёсткая привязка платежей к этапам",
  },
];

/* ========================================================================= */
/* Б · Сроки и критические вехи                                              */
/* ========================================================================= */

export interface MilestoneRow {
  readonly id: string;
  readonly milestone: string;
  readonly plan: string;
  readonly forecast: string;
  readonly slip: number | undefined;
  readonly verdict: "slip" | "watch" | "control";
  readonly action: string;
}

export const MILESTONES: readonly MilestoneRow[] = [
  {
    id: "договор",
    milestone: "Договорный срок",
    plan: "26.08.2026",
    forecast: "27.01.2027",
    slip: 154,
    verdict: "slip",
    action: "новый договорный график",
  },
  {
    id: "котлован-осв",
    milestone: "Котлован осветлителя",
    plan: "раньше",
    forecast: "15.09.2026",
    slip: undefined,
    verdict: "watch",
    action: "акт передачи и дата",
  },
  {
    id: "котлован-лос",
    milestone: "Котлован ЛОС",
    plan: "раньше",
    forecast: "18.09.2026",
    slip: undefined,
    verdict: "watch",
    action: "акт передачи и геодезия",
  },
  {
    id: "стройготовность",
    milestone: "Стройготовность",
    plan: "—",
    forecast: "23.10.2026",
    slip: undefined,
    verdict: "control",
    action: "держать бетон и колодцы",
  },
  {
    id: "механика",
    milestone: "Механическая готовность",
    plan: "—",
    forecast: "03.11.2026",
    slip: undefined,
    verdict: "control",
    action: "монтаж и обкатка 72 ч",
  },
  {
    id: "биология",
    milestone: "Сдача с биологией",
    plan: "26.08.2026",
    forecast: "27.01.2027",
    slip: 154,
    verdict: "slip",
    action: "сценарий засева и ПНР",
  },
];

/* ========================================================================= */
/* В · Решения · Г · Надёжность                                              */
/* ========================================================================= */

export const DECISIONS: readonly Decision[] = [
  {
    text: "Утвердить позицию по переносу срока",
    consequence: "срок продолжает считаться от договорного, и каждая веха выглядит просроченной",
    owner: "Виктор",
    due: "до 26.08",
  },
  {
    text: "Сначала посчитать оборотку, потом выбирать источник",
    consequence: "источник выбирается под неизвестную потребность — довнесение вслепую",
    owner: "Ваныч · БДДС",
    due: "сейчас",
    urgent: true,
  },
  {
    text: "Новые допработы — только после письменного основания",
    consequence: "объём растёт без денег, и закрыть его будет нечем",
    owner: "Виктор · ПТО",
    due: "немедленно",
    urgent: true,
  },
];

export const RELIABILITY: readonly Reliability[] = [
  { what: "ЦИМ-ИТОГОВАЯ — истина штаба", value: "22.08", verdict: "ok" },
  { what: "Последний физфакт с объёмом (металл 1,022 т)", value: "18.08", verdict: "ok" },
  {
    what: "Приток ЗСМ: 5,80 против 2,40 млн ₽",
    value: "расхождение",
    verdict: "check",
    action: "сверить по банковской выписке",
  },
  { what: "Оборотка до платежа", value: "нет", verdict: "absent", action: "не рассчитана" },
  { what: "Маржа и финрезультат", value: "нет", verdict: "absent", action: "не моделируется" },
];

export const KEY_RISK =
  "Свободная касса 110 480 ₽, а точная потребность в оборотке до ближайшего подтверждённого поступления не рассчитана. Нужен график входящих и прогноз исходящих до этой даты.";
