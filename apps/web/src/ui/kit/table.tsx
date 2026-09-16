import type { ComponentProps, ReactNode } from "react";

import { cn } from "../cn.js";

/**
 * Таблица. Тонкие обёртки над семантической разметкой: `<table>` остаётся
 * таблицей, а не превращается в набор `<div role="row">` — доступность и
 * копирование в буфер это единственное, что реально ценят пользователи смет.
 *
 * ЧИСЛОВАЯ КОЛОНКА ОБЪЯВЛЯЕТСЯ, А НЕ УГАДЫВАЕТСЯ
 *
 * `numeric: true` в описании колонки ставит выравнивание по правому краю и
 * табулярные цифры и в шапке, и в ячейках. На макетах заказчика суммы стояли по
 * левому краю пропорциональными цифрами — в смете это читается как неряшливость
 * и мешает сравнивать порядки величин глазом.
 *
 * Прокрутка живёт на обёртке, а не на странице: широкая таблица обязана
 * прокручиваться внутри себя, иначе она уводит горизонтальную прокрутку на всё
 * окно и ломает раскладку соседних блоков.
 */
export interface Column<Row> {
  readonly key: string;
  readonly title: ReactNode;
  /** Единица выносится в шапку, чтобы не повторять её в каждой ячейке. */
  readonly unit?: string;
  readonly numeric?: boolean;
  readonly width?: string;
  readonly render: (row: Row) => ReactNode;
}

/**
 * Страница таблицы.
 *
 * Адресом, а не состоянием в браузере: экраны серверные, и вторая страница
 * обязана открываться по ссылке — иначе её нельзя ни сохранить, ни прислать
 * коллеге, ни вернуться на неё кнопкой «назад».
 */
export interface Paging {
  /** Текущая страница, считая с единицы. */
  readonly page: number;
  readonly pageSize: number;
  readonly hrefFor: (page: number) => string;
}

/**
 * Срез страницы и её границы.
 *
 * Вынесено отдельной функцией, потому что проверять надо именно это: договор
 * требует, чтобы **2000 позиций оставались работоспособными** (§20), а
 * работоспособность здесь означает «в разметку уходит страница, а не всё».
 * Границы считаются от единицы и включительно — так их читает человек в строке
 * «показано 51–100 из 2000».
 */
export function paginate<Row>(
  rows: readonly Row[],
  paging: Paging | undefined,
): { readonly shown: readonly Row[]; readonly from: number; readonly to: number; readonly pages: number } {
  if (paging === undefined || rows.length <= paging.pageSize) {
    return { shown: rows, from: rows.length === 0 ? 0 : 1, to: rows.length, pages: 1 };
  }

  const pages = Math.ceil(rows.length / paging.pageSize);
  // Страница за пределами набора — не ошибка ввода, а устаревшая ссылка:
  // данные могли сократиться. Показывается ближайшая существующая.
  const page = Math.min(Math.max(1, Math.trunc(paging.page)), pages);
  const start = (page - 1) * paging.pageSize;

  return {
    shown: rows.slice(start, start + paging.pageSize),
    from: start + 1,
    to: Math.min(start + paging.pageSize, rows.length),
    pages,
  };
}

export interface DataTableProps<Row> {
  readonly columns: readonly Column<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row) => string;
  /**
   * Класс строки — крючок для пометки одной строки среди прочих (Д3).
   *
   * Появился вместе с переходом от замечания к строке исходного листа: ссылка
   * из замечания открывает нужную страницу, и строку надо назвать, иначе
   * читатель ищет её глазами среди пятидесяти.
   */
  readonly rowClass?: (row: Row) => string | undefined;
  /** Идентификатор строки в разметке: по нему браузер доводит до неё сам. */
  readonly rowId?: (row: Row) => string | undefined;
  /** Показывается вместо тела, когда строк нет: пустая таблица — это сообщение. */
  readonly empty: ReactNode;
  readonly footer?: ReactNode;
  /** Разбивка на страницы. Без неё таблица рисует всё, что получила. */
  readonly paging?: Paging;
  readonly maxHeight?: number;
  /**
   * Название таблицы для читалки экрана. Заголовок карточки рядом для этого не
   * годится: он не связан с `<table>` разметкой, и читалка объявляет таблицу
   * безымянной, тогда как зрячий видит заголовок над ней.
   */
  readonly caption: string;
  readonly className?: string;
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  rowClass,
  rowId,
  empty,
  footer,
  paging,
  maxHeight,
  caption,
  className,
}: DataTableProps<Row>) {
  if (rows.length === 0) {
    return <>{empty}</>;
  }

  const { shown, from, to, pages } = paginate(rows, paging);

  return (
    // ПРОКРУЧИВАЕМАЯ ОБЛАСТЬ ОБЯЗАНА БЫТЬ ДОСТУПНА С КЛАВИАТУРЫ
    //
    // `tabIndex={0}` и имя — не украшение: axe нашёл `scrollable-region-focusable`
    // на рабочем экране Проверки при узком окне. Широкая таблица прокручивается
    // внутри себя, и без фокуса добраться до правых колонок клавиатурой нельзя
    // вовсе — то есть часть данных недостижима, а это WCAG 2.1.1.
    //
    // Остановка табуляции появляется и там, где прокрутки нет: узнать это
    // заранее сервер не может. Лишняя остановка — цена меньшая, чем недостижимая
    // колонка, и она честная: читалка объявит область по названию таблицы.
    <div
      aria-label={caption}
      className={cn("table-scroll", className)}
      role="group"
      style={maxHeight === undefined ? undefined : { maxHeight: `${maxHeight}px` }}
      tabIndex={0}
    >
      {paging === undefined || pages === 1 ? null : (
        <Pages from={from} pages={pages} paging={paging} to={to} total={rows.length} placement="top" />
      )}
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                className={column.numeric === true ? "num" : undefined}
                key={column.key}
                scope="col"
                style={column.width === undefined ? undefined : { width: column.width }}
              >
                {column.title}
                {column.unit === undefined ? null : <span className="meta">{`, ${column.unit}`}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr className={rowClass?.(row)} id={rowId?.(row)} key={rowKey(row)}>
              {columns.map((column) => (
                <td className={column.numeric === true ? "num" : undefined} key={column.key}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer === undefined ? null : (
          <tfoot>
            <tr>
              <td colSpan={columns.length}>{footer}</td>
            </tr>
          </tfoot>
        )}
      </table>

      {paging === undefined || pages === 1 ? null : (
        <Pages from={from} pages={pages} paging={paging} to={to} total={rows.length} />
      )}
    </div>
  );
}

/**
 * Управление страницами.
 *
 * На краю ссылка НЕ рисуется отключённой ссылкой: отключённая ссылка приглашает
 * нажать и ничего не делает. Вместо неё остаётся текст — приглашения нет.
 */
function Pages({
  paging,
  pages,
  from,
  to,
  total,
  placement = "bottom",
}: {
  readonly paging: Paging;
  readonly pages: number;
  readonly from: number;
  readonly to: number;
  readonly total: number;
  readonly placement?: "top" | "bottom";
}) {
  const page = Math.min(Math.max(1, Math.trunc(paging.page)), pages);

  return (
    <nav
      // Панелей страниц теперь ДВЕ — над таблицей и под ней. Два ориентира с
      // одинаковым именем читалка объявляет одинаково, и человек не понимает,
      // на какой из них попал; поэтому имя называет место.
      aria-label={placement === "bottom" ? "Страницы таблицы, внизу" : "Страницы таблицы, вверху"}
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 bg-[var(--surface-sunken)] px-3 py-2.5",
        placement === "bottom" ? "border-t border-[var(--line)]" : "border-b border-[var(--line)]"
      )}
    >
      <span className="meta">{`показано ${from}\u2013${to} из ${total} · страница ${page} из ${pages}`}</span>
      <span className="flex items-center gap-3">
        {page > 1 ? (
          <a className="text-[var(--t-meta)] font-semibold" href={paging.hrefFor(page - 1)} rel="prev">
            ← предыдущая
          </a>
        ) : (
          <span className="meta">← предыдущая</span>
        )}
        {page < pages ? (
          <a className="text-[var(--t-meta)] font-semibold" href={paging.hrefFor(page + 1)} rel="next">
            следующая →
          </a>
        ) : (
          <span className="meta">следующая →</span>
        )}
      </span>
    </nav>
  );
}

export function TableNote({ className, ...rest }: ComponentProps<"p">) {
  return <p className={cn("meta m-0 px-3.5 py-2.5 border-t border-[var(--line-2)]", className)} {...rest} />;
}
