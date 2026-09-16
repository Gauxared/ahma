// @vitest-environment jsdom
/**
 * ПРОКРУЧИВАЕМАЯ ОБЛАСТЬ ОБЯЗАНА БЫТЬ ДОСТУПНА С КЛАВИАТУРЫ (WCAG 2.1.1).
 *
 * ПОЧЕМУ ЭТО ПРОВЕРЯЕТСЯ ЗДЕСЬ, А НЕ ТОЛЬКО AXE
 *
 * `scrollable-region-focusable` срабатывает, только когда область
 * ДЕЙСТВИТЕЛЬНО прокручивается. На демонстрационном контуре замечаний было
 * мало, список помещался целиком, и axe молчал на четырёх экранах сразу.
 * Нарушение стало видно с первого прогона, давшего сотню замечаний.
 *
 * То есть автоматическая проверка доступности здесь ЗАВИСИТ ОТ ДАННЫХ — ровно
 * те «грабли №5» из передачи контекста. Набор ниже от данных не зависит: он
 * спрашивает разметку.
 *
 * ВТОРАЯ ПРОВЕРКА ВАЖНЕЕ ПЕРВОЙ. Правило легко обойти, написав
 * `<div className="dash-scroll">` руками — именно так оно и было нарушено в
 * четырёх местах. Поэтому отдельно сторожится, что класс не встречается в
 * разметке приложения нигде, кроме самого компонента.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ScrollBox } from "./scroll-box.js";

/** Все `.tsx` разметки, кроме самого компонента и наборов. */
function разметка(root: string): readonly string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);

    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === ".next" ? [] : разметка(path);
    if (!entry.name.endsWith(".tsx")) return [];
    if (entry.name === "scroll-box.tsx" || entry.name.endsWith(".test.tsx")) return [];

    return [path];
  });
}

/**
 * Узкое объявление вместо DOM-типов.
 *
 * У проекта `lib: ["ES2023"]` — типов браузера нет НАМЕРЕННО: почти весь код
 * серверный, и `document` в нём означал бы ошибку. Набору нужны ровно два
 * свойства узла, и объявить их здесь честнее, чем открывать DOM всему проекту
 * ради одного файла.
 */
interface Узел {
  getAttribute(name: string): string | null;
  readonly className: string;
}

const узел = (element: unknown): Узел => element as Узел;

afterEach(cleanup);

describe("область прокрутки", () => {
  it("получает остановку табуляции", () => {
    render(<ScrollBox label="Замечания сметчика">строка</ScrollBox>);

    // Без `tabIndex` до нижних строк списка клавиатурой не добраться вовсе:
    // часть данных недостижима, а это грубое нарушение, а не неудобство.
    expect(узел(screen.getByRole("group")).getAttribute("tabindex")).toBe("0");
  });

  it("объявляется читалке ПО ИМЕНИ, а не «группой»", () => {
    render(<ScrollBox label="Договорные гейты">строка</ScrollBox>);

    // Область без названия: попасть в неё можно, понять, куда попал, нельзя.
    expect(screen.getByRole("group", { name: "Договорные гейты" })).toBeDefined();
  });

  it("свои классы не вытесняют собственный", () => {
    render(
      <ScrollBox className="m-0 p-0" label="Состав партии">
        строка
      </ScrollBox>,
    );

    const box = узел(screen.getByRole("group"));
    expect(box.className).toContain("dash-scroll");
    expect(box.className).toContain("m-0");
  });
});

describe("класс прокрутки не ставится руками", () => {
  it("`dash-scroll` встречается только в самом компоненте", () => {
    // Разметка мимо компонента — это возврат нарушения: класс даёт прокрутку,
    // а остановку табуляции даёт компонент, и порознь они не работают.
    const files = [...разметка("apps/web/app"), ...разметка("apps/web/src")];

    expect(files.length, "файлов разметки не нашлось — проверка ничего не сторожит").toBeGreaterThan(20);

    const виновные = files.filter((file) => readFileSync(file, "utf8").includes("dash-scroll"));

    expect(
      виновные,
      "класс `dash-scroll` поставлен в разметке напрямую: используйте <ScrollBox>, иначе область прокрутки останется недостижимой с клавиатуры",
    ).toEqual([]);
  });
});
