/**
 * Тесты написаны до реализации. Чеклист старта Палыча — такт 1 легаси-протокола
 * (`reference-system/skills/stroiintellect-master/.../workflow.md`):
 *
 *   ПАЛЫЧ (чеклист старта):
 *   □ Приказ о начале производства работ подписан?
 *   □ Общий журнал производства работ оформлен?
 *   □ Лаборатория найдена? Аккредитация проверена (по виду работ)?
 *   □ ПОС утверждён?
 *   □ Список АОСР составлен и передан прорабу?
 *   □ Ответственный за ИД назначен?
 *   □ Журналы специальных работ (сварка, бетон, изоляция) готовы?
 *
 * И критическое правило протокола:
 *   «ИД без Палыча с первого дня → Предписание ГСН → штраф + останов работ»
 */
import { describe, expect, it } from "vitest";

import { buildStartChecklist, START_CHECKLIST } from "./start-checklist.js";

describe("чеклист старта (Палыч, такт 1)", () => {
  it("несёт все семь пунктов протокола, ни одного не потеряв", () => {
    expect(START_CHECKLIST).toHaveLength(7);
    expect(START_CHECKLIST.map((item) => item.id)).toContain("приказ-о-начале");
    expect(START_CHECKLIST.map((item) => item.id)).toContain("журналы-спецработ");
  });

  it("у каждого пункта есть последствие невыполнения, а не только вопрос", () => {
    // Пункт без цены пропуска человек откладывает: непонятно, чем рискует.
    for (const item of START_CHECKLIST) {
      expect(item.consequence).not.toBe("");
      expect(item.question).toMatch(/\?$/);
    }
  });

  it("без ответов чеклист НЕ считается пройденным", () => {
    // Ни один пункт не отвечен — это не «всё в порядке», это «не начинали».
    const чеклист = buildStartChecklist({});

    expect(чеклист.status).toBe("returned");
    expect(чеклист.unanswered).toHaveLength(7);
  });

  it("частично отвеченный чеклист тоже не пройден", () => {
    const чеклист = buildStartChecklist({ "приказ-о-начале": true, "общий-журнал": true });

    expect(чеклист.status).toBe("returned");
    expect(чеклист.unanswered).toHaveLength(5);
  });

  it("отрицательный ответ — не пропуск, а найденный риск", () => {
    // «Лаборатории нет» — это ответ, и он хуже отсутствия ответа:
    // известно, что пункт не закрыт.
    const чеклист = buildStartChecklist({
      "приказ-о-начале": true,
      "общий-журнал": true,
      лаборатория: false,
      пос: true,
      "список-аоср": true,
      "ответственный-за-ид": true,
      "журналы-спецработ": true,
    });

    expect(чеклист.status).toBe("returned");
    expect(чеклист.unanswered).toHaveLength(0);
    expect(чеклист.failed.map((item) => item.id)).toEqual(["лаборатория"]);
  });

  it("полностью закрытый чеклист подтверждается", () => {
    const все = Object.fromEntries(START_CHECKLIST.map((item) => [item.id, true]));
    const чеклист = buildStartChecklist(все);

    expect(чеклист.status).toBe("approved");
    expect(чеклист.failed).toEqual([]);
  });

  it("готовит передачу с тем, что именно закрыть", () => {
    const чеклист = buildStartChecklist({ "приказ-о-начале": false });

    expect(чеклист.handoff.to).toBe("артемий");
    expect(чеклист.handoff.payload).toContain("приказ");
    expect(чеклист.handoff.priority).toBe("critical");
  });
});
