// @vitest-environment jsdom
/**
 * Отказ по праву говорит причину ОДИН раз и называет право.
 *
 * ЧТО ЗДЕСЬ ЗАЩИЩАЕТСЯ
 *
 * Компонент формулировал причину сам, а вызывающий передавал рядом
 * `decision.reason` — ровно то же предложение. На экране журнала это читалось
 * так: «Право audit:read не предоставлено ни одной привязкой актора. Право
 * audit:read не предоставлено ни одной привязкой актора. По ТЗ §4…»
 *
 * Удвоение стояло на ДЕСЯТИ экранах — везде, где отказ показывается вообще, —
 * и не могло не появиться: две стороны отвечали на один вопрос, обе правильно.
 * Ни один гейт этого не видел: все они проверяли, что нужный текст ЕСТЬ, а не
 * что его не два.
 *
 * Второе свойство не менее важно: путь Г-16 требует «отказ С НАЗВАНИЕМ ПРАВА».
 * Право обязано быть на экране и тогда, когда причина о другом («вы не вошли»),
 * — иначе человек не знает, что просить у администратора.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StateDenied } from "./states.js";

afterEach(cleanup);

const ПРИЧИНА = "Право audit:read не предоставлено ни одной привязкой актора.";

describe("отказ по праву", () => {
  it("причина сказана ровно один раз", () => {
    render(<StateDenied permission="audit:read" reason={ПРИЧИНА} />);

    expect(screen.getAllByText(ПРИЧИНА, { exact: false })).toHaveLength(1);
  });

  it("не сочиняет причину поверх переданной", () => {
    // Компонент не должен добавлять СВОЮ формулировку: она и была вторым
    // экземпляром. Проверяется по обороту, который он произносил.
    render(<StateDenied permission="audit:read" reason="Вы не вошли в систему." />);

    expect(screen.queryByText(/не предоставлено ни одной привязкой/)).toBeNull();
  });

  it("называет право даже там, где причина о другом", () => {
    render(<StateDenied permission="user:manage" reason="Вы не вошли в систему." />);

    expect(screen.getByText(/user:manage/)).toBeDefined();
  });

  it("добавленное экраном стоит рядом с причиной, а не вместо неё", () => {
    render(
      <StateDenied permission="audit:read" reason={ПРИЧИНА}>
        По ТЗ §4 журнал доступен администратору.
      </StateDenied>,
    );

    expect(screen.getAllByText(ПРИЧИНА, { exact: false })).toHaveLength(1);
    expect(screen.getByText(/журнал доступен администратору/)).toBeDefined();
  });
});
