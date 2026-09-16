import type { ReactNode } from "react";

import { cn } from "../cn.js";
import { Pill, type PillTone } from "../kit/pill.js";

/**
 * Счётчик — плитка для числа, у которого нет следа формулы и не может быть.
 *
 * ЧЕМ ОТЛИЧАЕТСЯ ОТ `Metric`
 *
 * `Metric` принимает `Shown<T>`: значение с происхождением либо объявленное
 * отсутствие. Это правильно для расчётов и фактов — но НЕ для счётчиков.
 *
 * «Позиций 101», «смет прочитано 4», «замечаний 96» — то, что посчитал обход.
 * Ни `SourceRef`, ни `FormulaTrace` за ними не стоит: источник у них один —
 * артефакт Проверки. Обернуть их в `Valued` с собранным на месте `SourceRef`
 * значило бы приделать провенанс к счётчику, то есть ровно то, что запрещает
 * `Ф-ADR-006`.
 *
 * Поэтому у счётчика происхождение выражено ИНАЧЕ И ЧЕСТНО: ссылкой на артефакт,
 * из которого он взят. Раскрытия здесь нет, потому что раскрывать нечего, и
 * притворяться, что есть, экран не будет.
 */
export function Counter({
  label,
  value,
  unit,
  note,
  badge,
  href,
  emphasis,
  tone,
}: {
  readonly label: string;
  readonly value: number | string;
  readonly unit?: string;
  readonly note?: ReactNode;
  readonly badge?: { readonly tone: PillTone; readonly text: string };
  /** Куда ведёт число: у счётчика это единственный способ показать источник. */
  readonly href?: string;
  /** Ровно один счётчик на экране может быть главным — у него больше кегль. */
  readonly emphasis?: boolean;
  /** Тон значения. По умолчанию обычный: цветное число — исключение, не правило. */
  readonly tone?: "ok" | "warn" | "danger";
}) {
  const face = (
    <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <span
        className={cn(
          "num font-bold tracking-[-0.03em]",
          emphasis === true ? "text-[var(--t-display)]" : "text-[var(--t-metric)]",
          tone === "ok"
            ? "text-[var(--ok)]"
            : tone === "warn"
              ? "text-[var(--warn)]"
              : tone === "danger"
                ? "text-[var(--danger)]"
                : "text-[var(--text)]",
        )}
      >
        {value}
      </span>
      {unit === undefined ? null : <span className="text-[var(--t-meta)] text-[var(--text-3)]">{unit}</span>}
      {badge === undefined ? null : <Pill dot label={badge.text} tone={badge.tone} />}
    </span>
  );

  return (
    <div className="card h-full">
      <div className="px-4 pt-3.5">
        <span className="eyebrow">{label}</span>
      </div>
      <div className={cn("px-4 pb-4", emphasis === true ? "pt-2.5" : "pt-2")}>
        {href === undefined ? (
          face
        ) : (
          <a className="no-underline" href={href}>
            {face}
          </a>
        )}
        {note === undefined ? null : <p className="meta mt-2 mb-0 max-w-[42ch]">{note}</p>}
      </div>
    </div>
  );
}

/**
 * Полоса доли — первый графический примитив продукта (веха Ф10).
 *
 * ПОЧЕМУ ИМЕННО ОН, А НЕ ПОНЧИК И НЕ ГРАФИК
 *
 * §7 трека: «графики там, где таблица точнее, — не строим». Доля целого —
 * исключение: она про ДЛИНУ, и глаз сравнивает длины быстрее, чем проценты в
 * колонке. Пончик из макетов заказчика не берём — четыре сектора читаются
 * хуже, чем четыре полосы одной шкалы.
 *
 * Нарисовано `div`-ами, как в прототипах (в их коде дословно `inline SVG-free
 * chart builders (pure divs)`). Внешних запросов из интерфейса быть не должно
 * (`Ф-ADR-008`), а полоса библиотеки и не требует.
 *
 * ЧИСЛО РЯДОМ ОБЯЗАТЕЛЬНО. Полоса — добавка к числу, а не замена: цвет и длина
 * не читаются читалкой экрана, а число читается.
 */
export function Share({
  rows,
  total,
  className,
}: {
  readonly rows: readonly { readonly label: string; readonly value: number; readonly href?: string }[];
  /** Целое, к которому берётся доля. Ноль означает «делить не на что». */
  readonly total: number;
  readonly className?: string;
}) {
  return (
    <ul className={cn("m-0 list-none p-0", className)}>
      {rows.map((row) => {
        const percent = total === 0 ? 0 : Math.round((row.value / total) * 100);

        return (
          <li className="flex items-center gap-3 py-1.5" key={row.label}>
            <span className="min-w-0 flex-1 truncate text-[var(--t-body)]" title={row.label}>
              {row.href === undefined ? row.label : <a href={row.href}>{row.label}</a>}
            </span>
            <span className="share" role="presentation">
              <span className="share__fill" style={{ width: `${percent}%` }} />
            </span>
            <span className="num w-[3.5rem] text-[var(--t-meta)] text-[var(--text-2)]">{row.value}</span>
            <span className="num w-[2.5rem] text-[var(--t-micro)] text-[var(--text-4)]">{`${percent}%`}</span>
          </li>
        );
      })}
    </ul>
  );
}
