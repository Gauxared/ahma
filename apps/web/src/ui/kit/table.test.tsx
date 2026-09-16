// @vitest-environment jsdom
/**
 * Работоспособность таблицы на 2000 позиций — §20 договора.
 *
 * ПОЧЕМУ ИМЕННО РАЗМЕТКА, А НЕ «СТРАНИЦА ОТКРЫЛАСЬ»
 *
 * Требование звучит как «≥2000 позиций остаются работоспособными через
 * виртуализацию или пагинацию». Работоспособность здесь измеряется одним: сколько
 * строк уходит в разметку. Две тысячи узлов `<tr>` — это и есть та неработающая
 * таблица, о которой говорит §20, и никакой прогон «страница ответила 200» этого
 * не покажет.
 *
 * Границы проверяются отдельно, потому что «показано 51–100 из 2000» человек
 * читает как утверждение и заметит ошибку на единицу быстрее, чем любую другую.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DataTable, paginate, type Column } from "./table.js";

interface Row {
  readonly id: string;
  readonly amount: number;
}

const rows: readonly Row[] = Array.from({ length: 2000 }, (_, index) => ({
  id: `поз-${index + 1}`,
  amount: (index + 1) * 100,
}));

const columns: readonly Column<Row>[] = [
  { key: "id", title: "Позиция", render: (row) => row.id },
  { key: "amount", title: "Сумма", numeric: true, render: (row) => String(row.amount) },
];

afterEach(cleanup);

describe("страницы таблицы", () => {
  it("в разметку уходит страница, а не все две тысячи строк", () => {
    render(
      <DataTable
        caption="Позиции"
        columns={columns}
        empty={<p>пусто</p>}
        paging={{ page: 1, pageSize: 50, hrefFor: (page) => `?страница=${page}` }}
        rowKey={(row) => row.id}
        rows={rows}
      />,
    );

    // Через роли, а не через `querySelector`: в проекте нет типов DOM, и обход
    // разметки руками потребовал бы их завозить ради одного теста. Заодно это
    // проверяет, что таблица осталась таблицей для читалки: у `thead` и `tbody`
    // роль `rowgroup`, и вторая — это тело.
    const body = within(screen.getAllByRole("rowgroup")[1] as HTMLElement).getAllByRole("row");
    expect(body).toHaveLength(50);

    // Панелей страниц две — над таблицей и под ней, — поэтому счёт спрашивается
    // у названной, а не «где-нибудь на странице»: иначе тест перестал бы
    // отличать две панели от одной, случайно продублированной.
    const низ = within(screen.getByRole("navigation", { name: "Страницы таблицы, внизу" }));
    expect(низ.getByText(/показано 1–50 из 2000/)).toBeDefined();
    expect(низ.getByText(/страница 1 из 40/)).toBeDefined();
    expect(screen.getByRole("navigation", { name: "Страницы таблицы, вверху" })).toBeDefined();
  });

  it("на первой странице нет приглашения назад, на последней — вперёд", () => {
    const { unmount } = render(
      <DataTable
        caption="Позиции"
        columns={columns}
        empty={<p>пусто</p>}
        paging={{ page: 1, pageSize: 50, hrefFor: (page) => `?страница=${page}` }}
        rowKey={(row) => row.id}
        rows={rows}
      />,
    );

    // Отключённая ссылка приглашает нажать и ничего не делает — её здесь нет.
    const первая = within(screen.getByRole("navigation", { name: "Страницы таблицы, внизу" }));
    expect(первая.queryByRole("link", { name: /предыдущая/ })).toBeNull();
    expect(первая.getByRole("link", { name: /следующая/ })).toBeDefined();
    unmount();

    render(
      <DataTable
        caption="Позиции"
        columns={columns}
        empty={<p>пусто</p>}
        paging={{ page: 40, pageSize: 50, hrefFor: (page) => `?страница=${page}` }}
        rowKey={(row) => row.id}
        rows={rows}
      />,
    );

    const последняя = within(screen.getByRole("navigation", { name: "Страницы таблицы, внизу" }));
    expect(последняя.getByRole("link", { name: /предыдущая/ })).toBeDefined();
    expect(последняя.queryByRole("link", { name: /следующая/ })).toBeNull();
  });

  it("без разбивки таблица рисует всё, что получила", () => {
    render(
      <DataTable caption="Позиции" columns={columns} empty={<p>пусто</p>} rowKey={(row) => row.id} rows={rows.slice(0, 7)} />,
    );

    const body = within(screen.getAllByRole("rowgroup")[1] as HTMLElement).getAllByRole("row");
    expect(body).toHaveLength(7);
    expect(screen.queryByRole("navigation", { name: /Страницы таблицы/ })).toBeNull();
  });
});

describe("границы страницы", () => {
  it("считаются от единицы и включительно", () => {
    const second = paginate(rows, { page: 2, pageSize: 50, hrefFor: () => "" });

    expect(second.from).toBe(51);
    expect(second.to).toBe(100);
    expect(second.shown[0]?.id).toBe("поз-51");
    expect(second.shown.at(-1)?.id).toBe("поз-100");
  });

  it("последняя страница не выходит за набор", () => {
    const last = paginate(rows.slice(0, 1990), { page: 40, pageSize: 50, hrefFor: () => "" });

    expect(last.to).toBe(1990);
    expect(last.shown).toHaveLength(40);
  });

  it("устаревшая ссылка на страницу за пределами набора показывает ближайшую существующую", () => {
    // Данные могли сократиться: это не ошибка ввода, и отдавать пустой экран
    // человеку, пришедшему по своей же закладке, незачем.
    const beyond = paginate(rows, { page: 999, pageSize: 50, hrefFor: () => "" });

    expect(beyond.from).toBe(1951);
    expect(beyond.to).toBe(2000);
  });

  it("страница меньше первой не уводит в отрицательные границы", () => {
    const before = paginate(rows, { page: 0, pageSize: 50, hrefFor: () => "" });

    expect(before.from).toBe(1);
    expect(before.to).toBe(50);
  });
});
