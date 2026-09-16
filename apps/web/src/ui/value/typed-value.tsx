import type { Money, Quantity } from "@contracts/primitives.js";
import type { Locator, Provenance, Valued } from "@contracts/provenance.js";
import { Fragment } from "react";

import { cn } from "../cn.js";
import { Pill, type PillTone } from "../kit/pill.js";
import type { Absence } from "./absence.js";
import { describeAbsence } from "./absence.js";
import {
  describeStatedAs,
  formatAmount,
  formatDate,
  formatMoneyCompact,
  formatMoneyExact,
  formatQuantity,
  formatQuantityValue,
} from "./format.js";

/**
 * Показ значения: число · единица · происхождение · раскрытие.
 *
 * ЭТО ЦЕНТРАЛЬНЫЙ КОМПОНЕНТ ВСЕГО ИНТЕРФЕЙСА
 *
 * §12.1д принимает «числа без маркера статуса источника в выгрузках» за ноль, а
 * спека требует: факт открывает точный `SourceRef`, расчёт — `FormulaTrace`, и
 * пользователь не должен искать происхождение в отдельном скачанном файле. На
 * макетах заказчика ни одно число не было кликабельным, а приблизительность
 * обозначалась тильдой — то есть главное требование договора не было выражено
 * вовсе. Здесь оно выражено типом: показать число можно только через `Shown`, а
 * собрать `Shown` без происхождения или без причины отсутствия нельзя.
 *
 * РАСКРЫТИЕ НА `<details>`, А НЕ НА ПОПОВЕРЕ
 *
 * Страницы просмотра — серверные компоненты, и раскрытие происхождения не стоит
 * того, чтобы тащить на клиент состояние. `<details>` доступен с клавиатуры без
 * нашего кода, работает при выключенном JS и — что важно для штабных экранов —
 * печатается раскрытым, если раскрыт.
 */

export type Shown<T> =
  | { readonly kind: "valued"; readonly valued: Valued<T> }
  | { readonly kind: "absent"; readonly absence: Absence };

export function valued<T>(value: Valued<T>): Shown<T> {
  return { kind: "valued", valued: value };
}

export function absent<T>(absence: Absence): Shown<T> {
  return { kind: "absent", absence };
}

interface Mark {
  readonly tone: PillTone;
  readonly label: string;
  /**
   * Буквенный маркер для плотных таблиц.
   *
   * Не цветная точка. Точка со скрытым для читалки текстом выглядит решением, но
   * зрячему пользователю оставляет ровно цвет — то есть воспроизводит ту самую
   * ошибку макетов, где «разрыв» жил кружком. Буква работает и в чёрно-белой
   * печати, и при дальтонизме; расшифровка — в `ProvenanceLegend` под таблицей.
   */
  readonly short: string;
  readonly title: string;
}

export function markOf(provenance: Provenance): Mark {
  if (provenance.kind === "formula") {
    const { formulaId, formulaVersion } = provenance.trace;
    return {
      tone: "info",
      label: "Расчёт",
      short: "р",
      title: `Расчёт: формула ${formulaId} версии ${formulaVersion}`,
    };
  }

  const { ref } = provenance;

  // `ocr_unconfirmed` перебивает статус источника намеренно: §14 исключает
  // распознавание сканов из объёма, поэтому такое значение обязано быть видимо
  // помечено везде, где используется, даже если источник назвал его фактом.
  if (ref.acquisition === "ocr_unconfirmed") {
    return {
      tone: "warn",
      label: "Распознано",
      short: "рсп",
      title: "Получено распознаванием и не подтверждено: в зачёт §12.1а не идёт (ADR-R-019)",
    };
  }

  switch (ref.status) {
    case "fact":
      return {
        tone: "ok",
        label: "Факт",
        short: "ф",
        title: `Подтверждено источником, проверено ${formatDate(ref.checkedAt)}`,
      };
    case "benchmark":
      return { tone: "info", label: "Ориентир", short: "о", title: "Ориентир из опорной базы, не норматив" };
    case "no_data":
      return { tone: "plain", label: "Нет данных", short: "н/д", title: "Источник числа не содержит" };
  }
}

function locatorText(locator: Locator): string {
  switch (locator.kind) {
    case "cell":
      return `${locator.sheet}!${locator.ref}`;
    case "row":
      return `${locator.sheet}, строка ${locator.row}`;
    case "page":
      return `стр. ${locator.page}`;
    case "range":
      return `${locator.sheet}!${locator.from}:${locator.to}`;
    case "record":
      return locator.recordId;
  }
}

function inputText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null && "amount" in value) {
    return formatMoneyExact(value as Money);
  }
  if (typeof value === "object" && value !== null && "unit" in value) {
    return formatQuantity(value as Quantity);
  }
  return String(value);
}

function Disclosure({ provenance }: { readonly provenance: Provenance }) {
  return (
    <details className="disclosure mt-2">
      <summary>{provenance.kind === "formula" ? "как посчитано" : "откуда взято"}</summary>
      <dl className="disclosure__body">
        {provenance.kind === "formula" ? (
          <>
            <dt>формула</dt>
            <dd className="mono">{`${provenance.trace.formulaId} · версия ${provenance.trace.formulaVersion}`}</dd>
            {Object.entries(provenance.trace.inputs).map(([name, input]) => (
              <Fragment key={name}>
                <dt>{name}</dt>
                <dd className="mono">{inputText(input)}</dd>
              </Fragment>
            ))}
            <dt>выход</dt>
            <dd className="mono">{provenance.trace.output}</dd>
            <dt>округление</dt>
            <dd>{provenance.trace.rounding}</dd>
          </>
        ) : (
          <>
            <dt>источник</dt>
            <dd>{provenance.ref.sourceId}</dd>
            <dt>где</dt>
            <dd className="mono">{locatorText(provenance.ref.locator)}</dd>
            {/* Хэш обрезан до восьми знаков: он служит опознанию версии записи,
                а не сверке руками — полный лежит в снапшоте прогона. */}
            <dt>хэш записи</dt>
            <dd className="mono">{provenance.ref.contentHash.slice(0, 8)}</dd>
            <dt>проверено</dt>
            <dd>{formatDate(provenance.ref.checkedAt)}</dd>
          </>
        )}
      </dl>
    </details>
  );
}

/**
 * Крупный показатель штабной панели.
 *
 * Отсутствие занимает МЕСТО ЧИСЛА, а не прячется в подпись. «НЕ РАССЧИТАНО» на
 * позиции значения — то, что заказчик сделал правильно, и это сохранено
 * дословно: дашборды обычно ставят там ноль, и он читается как факт.
 */
export function Metric({
  label,
  badge,
  shown,
  note,
  emphasis,
}: {
  readonly label: string;
  readonly badge?: { readonly tone: PillTone; readonly text: string };
  readonly shown: Shown<Money> | Shown<Quantity> | Shown<string>;
  readonly note?: string;
  /** Ровно один показатель на экране может быть главным — у него больше кегль. */
  readonly emphasis?: boolean;
}) {
  return (
    <div className="card h-full">
      {/* Заголовок занимает строку целиком, бейдж съехал к значению.
          Раньше они делили одну строку, и при заголовке в два слова бейдж
          вклинивался между ними: «ОБОРОТКА · КРИТИЧНО · ДО ПЛАТЕЖА». Рядом со
          значением статус и по смыслу уместнее — он квалифицирует число, а не
          подпись к нему. */}
      <div className="px-4 pt-3.5">
        <span className="eyebrow">{label}</span>
      </div>
      <div className={cn("px-4 pb-4", emphasis ? "pt-2.5" : "pt-2")}>
        <MetricFace emphasis={emphasis === true} shown={shown} {...(badge === undefined ? {} : { badge })} />
        {note === undefined ? null : <p className="meta mt-2.5 mb-0 max-w-[42ch]">{note}</p>}
      </div>
    </div>
  );
}

function MetricFace({
  shown,
  emphasis,
  badge,
}: {
  readonly shown: Shown<Money> | Shown<Quantity> | Shown<string>;
  readonly emphasis: boolean;
  readonly badge?: { readonly tone: PillTone; readonly text: string };
}) {
  // Статус показателя — громко: это исключение, а не свойство.
  const mark_badge = badge === undefined ? null : <Pill className="shrink-0" label={badge.text} loud tone={badge.tone} />;
  if (shown.kind === "absent") {
    const view = describeAbsence(shown.absence);
    const colour =
      view.tone === "danger"
        ? "text-[var(--danger)]"
        : view.tone === "warn"
          ? "text-[var(--warn)]"
          : "text-[var(--text-3)]";
    return (
      <>
        {/* Слово на месте числа переносится, а не обрезается: «НЕДОСТОВЕРН…»
            читается как сбой вёрстки, а это полноценное значение. */}
        <div className="flex items-start justify-between gap-3">
          <span className={cn("metric__absent", emphasis ? "metric__absent--hero" : undefined, colour)}>
            {view.label}
          </span>
          {mark_badge}
        </div>
        <p className="meta mt-2.5 mb-0 max-w-[42ch]">{view.reason}</p>
      </>
    );
  }

  const { value, provenance, reviewDue } = shown.valued;
  const face = faceOf(value);
  const mark = markOf(provenance);

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className={cn("metric__face num", emphasis ? "metric__face--hero" : undefined)}>{face.text}</span>
          {face.unit === undefined ? null : <span className="metric__unit">{face.unit}</span>}
        </span>
        {mark_badge}
      </div>
      {/* Происхождение — тихой строкой под числом, а не бейджем рядом с ним:
          оно есть у каждого числа, и громким быть не может по определению. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Pill dot label={mark.label} title={mark.title} tone={mark.tone} />
        {reviewDue === true ? (
          <Pill label="Проверить" title="Значение старше порога свежести опорной базы (ТЗ §7)" tone="warn" />
        ) : null}
        {face.exact === undefined ? null : <span className="meta num">{face.exact}</span>}
      </div>
      <Disclosure provenance={provenance} />
    </>
  );
}

interface Face {
  readonly text: string;
  readonly unit?: string;
  /** Точное значение под сокращённым — сокращение без него выдаёт округление за измерение. */
  readonly exact?: string;
}

function faceOf(value: Money | Quantity | string): Face {
  if (typeof value === "string") {
    return { text: value };
  }

  if ("amount" in value) {
    const compact = formatMoneyCompact(value);
    const stated = describeStatedAs(value);

    // Суммы меньше миллиона не сокращаются: «0,11 млн» читается хуже, чем
    // 110 480 ₽, и именно на этом макет заказчика терял точность в главной
    // карточке. Нулевые копейки в лицо числа не выносятся — при кегле 34px
    // «,00» отнимает место у значащих цифр, а точная сумма всё равно стоит
    // строкой ниже и в раскрытии.
    if (compact.unit === "₽") {
      const exact = formatAmount(value);
      const integral = exact.endsWith(",00");
      const text = integral ? exact.slice(0, -3) : exact;
      const tail = integral ? undefined : stated;
      return tail === undefined ? { text, unit: "₽" } : { text, unit: "₽", exact: tail };
    }

    const exact = formatMoneyExact(value);
    return { text: compact.text, unit: compact.unit, exact: stated === undefined ? exact : `${exact} · ${stated}` };
  }

  // Единица величины выносится отдельно, как у денег: иначе «154 сут» целиком
  // набирается кеглем числа, и сокращение единицы кричит наравне со значением.
  return { text: formatQuantityValue(value), unit: value.unit };
}

/** Значение в ячейке таблицы: та же дисциплина, только плотнее. */
export function Amount({ shown }: { readonly shown: Shown<Money> | Shown<Quantity> }) {
  if (shown.kind === "absent") {
    const view = describeAbsence(shown.absence);
    return <Pill label={view.label} title={view.reason} tone={view.tone} />;
  }

  const { value, provenance } = shown.valued;
  const mark = markOf(provenance);
  const text = "amount" in value ? formatMoneyExact(value) : formatQuantity(value);

  return (
    <span className="whitespace-nowrap" title={mark.title}>
      <span className="num">{text}</span>
      <sup className={cn("ml-1 text-[9.5px] font-bold", toneText(mark.tone))}>{mark.short}</sup>
    </span>
  );
}

/**
 * Расшифровка буквенных маркеров. Обязательна под каждой таблицей, где есть
 * `Amount`: маркер без легенды — это шифр, а не обозначение.
 */
export function ProvenanceLegend({ className }: { readonly className?: string }) {
  return (
    <p className={cn("meta m-0", className)}>
      <sup className={cn("text-[9.5px] font-bold", toneText("ok"))}>ф</sup> факт ·{" "}
      <sup className={cn("text-[9.5px] font-bold", toneText("info"))}>р</sup> расчёт по формуле ·{" "}
      <sup className={cn("text-[9.5px] font-bold", toneText("info"))}>о</sup> ориентир опорной базы ·{" "}
      <sup className={cn("text-[9.5px] font-bold", toneText("warn"))}>рсп</sup> распознано, не подтверждено
    </p>
  );
}

function toneText(tone: PillTone): string {
  switch (tone) {
    case "ok":
      return "text-[var(--ok)]";
    case "warn":
      return "text-[var(--warn)]";
    case "danger":
      return "text-[var(--danger)]";
    case "info":
      return "text-[var(--info)]";
    case "brand":
      return "text-[var(--brand)]";
    case "plain":
      return "text-[var(--text-3)]";
  }
}
