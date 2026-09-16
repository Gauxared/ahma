/**
 * НАСТРОЙКИ ЭКИПАЖА И СЛЕД ХОДА — без запуска Codex.
 *
 * Настройки собираются из тех же переменных, что у конвейера: вторая
 * переменная для того же ключа разошлась бы с первой на первом же переезде.
 * Без ключа настроек нет вовсе — режим не предлагается, а не падает посреди
 * хода. Изменение файлов ролью — ошибка режима, и она видна словом.
 */
import { describe, expect, it } from "vitest";

import { codexSettingsFrom, itemsToTrace, providerLabel } from "./codex-client.js";

const ПОЛНАЯ = {
  STROYINTELLECT_MODEL_BASE_URL: "https://llm.example.test/v1/",
  STROYINTELLECT_MODEL_ID: "cx/модель",
  STROYINTELLECT_MODEL_API_KEY: "ключ",
};

describe("настройки", () => {
  it("без адреса, модели или ключа настроек нет", () => {
    expect(codexSettingsFrom({}, "/c")).toBeUndefined();
    expect(codexSettingsFrom({ ...ПОЛНАЯ, STROYINTELLECT_MODEL_API_KEY: "" }, "/c")).toBeUndefined();
    expect(codexSettingsFrom({ ...ПОЛНАЯ, STROYINTELLECT_MODEL_ID: undefined }, "/c")).toBeUndefined();
  });

  it("собираются из переменных конвейера; глубина переводится в слова Codex", () => {
    const s = codexSettingsFrom({ ...ПОЛНАЯ, STROYINTELLECT_MODEL_REASONING_EFFORT: "max", STROYINTELLECT_CODEX_TURN_MINUTES: "7" }, "/c")!;
    expect(s.baseUrl, "хвостовой слэш ломает склейку адреса у провайдера").toBe("https://llm.example.test/v1");
    expect(s.model).toBe("cx/модель");
    expect(s.reasoningEffort, "у Codex нет `max`").toBe("xhigh");
    expect(s.turnMinutes).toBe(7);
    expect(s.webSearch).toBe(false);
    expect(s.configRoot).toBe("/c");
    expect(providerLabel(s)).toBe("codex-sdk@llm.example.test");
  });

  it("незнакомая глубина не отправляется; кривой потолок минут — умолчание", () => {
    const s = codexSettingsFrom({ ...ПОЛНАЯ, STROYINTELLECT_MODEL_REASONING_EFFORT: "опечатка", STROYINTELLECT_CODEX_TURN_MINUTES: "нет" }, "/c")!;
    expect(s.reasoningEffort).toBeUndefined();
    expect(s.turnMinutes).toBe(20);
  });

  it("песочница по умолчанию read-only; иной режим — только словом из перечня", () => {
    expect(codexSettingsFrom(ПОЛНАЯ, "/c")!.sandbox).toBe("read-only");
    expect(codexSettingsFrom({ ...ПОЛНАЯ, STROYINTELLECT_CODEX_SANDBOX: "danger-full-access" }, "/c")!.sandbox).toBe("danger-full-access");
    // Опечатка — отказ на старте: молчаливый read-only на площадке без
    // пространств имён дал бы прогон, в котором роли не прочли ни файла.
    expect(() => codexSettingsFrom({ ...ПОЛНАЯ, STROYINTELLECT_CODEX_SANDBOX: "readonly" }, "/c")).toThrow("не распознан");
  });

  it("дом Codex — не /tmp по умолчанию", () => {
    expect(codexSettingsFrom(ПОЛНАЯ, "/c")!.home.startsWith("/tmp")).toBe(false);
  });
});

describe("след хода", () => {
  it("команды, поиски и ошибки различаются; попытка правки файлов — ошибка режима", () => {
    const trace = itemsToTrace([
      { id: "1", type: "command_execution", command: "cat ОБЪЕКТ.md", aggregated_output: "…", exit_code: 0, status: "completed" },
      { id: "2", type: "web_search", query: "цена кабеля" },
      { id: "3", type: "error", message: "провайдер ответил 500" },
      { id: "4", type: "file_change", changes: [{ path: "сметы/ЛСР.tsv", kind: "update" }], status: "completed" },
      { id: "5", type: "agent_message", text: "{}" },
    ]);

    expect(trace.commands).toEqual([{ command: "cat ОБЪЕКТ.md", output: "…", exitCode: 0 }]);
    expect(trace.searches).toEqual(["цена кабеля"]);
    expect(trace.errors[0]).toBe("провайдер ответил 500");
    expect(trace.errors[1]).toContain("сметы/ЛСР.tsv");
    expect(trace.errors[1]).toContain("только для чтения");
  });
});
