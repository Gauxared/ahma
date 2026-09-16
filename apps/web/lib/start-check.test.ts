/**
 * СЛОВО ФОРМЫ → ВОРКФЛОУ И РЕЖИМ (spec-demo-stage-1 А1, А2).
 *
 * Четыре слова, один разбор для двух обработчиков. Прежде разбор жил внутри
 * `/api/checks` тернарием; с галочкой у загрузки Проверку ставят из двух мест,
 * и второй тернарий разошёлся бы с первым на первом же новом режиме.
 */
import { describe, expect, it } from "vitest";

import { режимПрогона } from "./start-check.js";

describe("режим прогона", () => {
  it("быстрый — второй воркфлоу; остальные — full-check с разным исполнителем", () => {
    expect(режимПрогона("быстрый")).toEqual({ workflowId: "estimate-only", mode: "express" });
    expect(режимПрогона("агентный")).toEqual({ workflowId: "full-check", mode: "agentic" });
    expect(режимПрогона("агенты")).toEqual({ workflowId: "full-check", mode: "codex" });
    expect(режимПрогона("")).toEqual({ workflowId: "full-check", mode: "standard" });
  });

  it("незнакомое слово — конвейер, а не отказ: кнопка «Проверить» поля не шлёт", () => {
    expect(режимПрогона(" что-то ")).toEqual({ workflowId: "full-check", mode: "standard" });
  });
});
