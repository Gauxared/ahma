import { X } from "lucide-react";

import { cn } from "../cn.js";

/**
 * Отбор списка — ссылками, а не кнопками.
 *
 * ПОЧЕМУ ССЫЛКИ
 *
 * Отбор живёт в адресе по той же причине, по которой там живёт номер страницы:
 * отобранный список обязан открываться по ссылке — иначе его нельзя ни прислать
 * коллеге, ни вернуть кнопкой «назад». Кнопка с обработчиком добавила бы
 * клиентское состояние, которое `Ф-ADR-010` разрешает только свёрнутости
 * рельса.
 *
 * ПОЧЕМУ У КАЖДОГО ЗНАЧЕНИЯ ЕСТЬ ЧИСЛО
 *
 * Отбор без числа — это предложение вслепую: нажав, узнаёшь, что там пусто.
 * Числа берутся из `groupBy` по всему журналу, а не из показанной страницы,
 * поэтому они говорят, СКОЛЬКО ЕСТЬ, а не сколько видно. Разница названа в
 * подписи над таблицей — молча расходиться этим двум числам нельзя.
 *
 * Плотность и радиус — из Pulse (`.filters-pop__chips`): высота 28 px, радиус
 * скруглён до пилюли, кегль 12 px, подпись группы 10.5 px капсом с разрядкой
 * 0.08em.
 */
export interface FilterOption {
  readonly value: string;
  readonly label: string;
  readonly count: number;
}

export function FilterBar({
  children,
  reset,
}: {
  readonly children: React.ReactNode;
  /** Адрес «снять отбор». Даётся только когда отбор действительно стоит. */
  readonly reset?: string;
}) {
  return (
    <div className="filters">
      {children}
      {reset === undefined ? null : (
        <a className="filters__reset" href={reset}>
          <X aria-hidden="true" size={12} />
          снять отбор
        </a>
      )}
    </div>
  );
}

export function FilterGroup({
  label,
  options,
  active,
  hrefFor,
  allLabel,
  allCount,
}: {
  readonly label: string;
  readonly options: readonly FilterOption[];
  /** Выбранное значение; `undefined` — выбран «все». */
  readonly active: string | undefined;
  readonly hrefFor: (value: string | undefined) => string;
  readonly allLabel: string;
  readonly allCount: number;
}) {
  return (
    <div className="filters__group">
      <p className="filters__label">{label}</p>
      <div className="filters__chips">
        <Chip
          count={allCount}
          href={hrefFor(undefined)}
          label={allLabel}
          selected={active === undefined}
        />
        {options.map((option) => (
          <Chip
            count={option.count}
            href={hrefFor(option.value)}
            key={option.value}
            label={option.label}
            selected={active === option.value}
          />
        ))}
      </div>
    </div>
  );
}

function Chip({
  href,
  label,
  count,
  selected,
}: {
  readonly href: string;
  readonly label: string;
  readonly count: number;
  readonly selected: boolean;
}) {
  return (
    <a
      // `aria-current` — не украшение: выбранная пилюля отличается от прочих
      // цветом и весом, а читалке цвет недоступен.
      aria-current={selected ? "true" : undefined}
      className={cn("filters__chip", selected ? "filters__chip--on" : undefined)}
      href={href}
    >
      {label}
      <span className="filters__count num">{count}</span>
    </a>
  );
}
