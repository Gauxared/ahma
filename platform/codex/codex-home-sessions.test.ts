/**
 * ЖИВ ЛИ ТРЕД ПРЕЖНЕГО ПРОГОНА.
 *
 * ЦЕНА ОШИБКИ НЕСИММЕТРИЧНА. Не продолжили живой тред — роль работает по
 * выписке из прежней редакции: память слабее, результат есть. Отдали Codex
 * мёртвый идентификатор — `resumeThread` роняет ход, и вместо заключения
 * получается отказ. Поэтому проверка стоит ДО хода и отвечает «нет» на всё, в
 * чём не уверена.
 *
 * Раскладка `sessions/<год>/<месяц>/<день>/rollout-<время>-<тред>.jsonl` — это
 * деталь Codex, а идентификатор в имени файла — то, на что можно опереться.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { threadResumable } from "./codex-home.js";

function дом(threads: readonly string[]): string {
  const home = mkdtempSync(join(tmpdir(), "дом-codex-"));
  const day = join(home, "sessions", "2026", "09", "01");
  mkdirSync(day, { recursive: true });

  for (const id of threads) {
    writeFileSync(join(day, `rollout-2026-09-01T10-00-00-${id}.jsonl`), "{}\n", "utf8");
  }
  return home;
}

describe("продолжение треда прежнего прогона", () => {
  it("тред с сохранённым rollout продолжается", () => {
    const home = дом(["019a0000-1111-7000-8000-000000000001"]);

    expect(threadResumable(home, "019a0000-1111-7000-8000-000000000001")).toBe(true);
  });

  it("тред, не переживший переезд выпуска, не продолжается", () => {
    const home = дом(["019a0000-1111-7000-8000-000000000001"]);

    expect(threadResumable(home, "019a0000-2222-7000-8000-000000000002")).toBe(false);
  });

  it("дома без сессий достаточно, чтобы ответить «нет» — а не упасть", () => {
    expect(threadResumable(mkdtempSync(join(tmpdir(), "пустой-дом-")), "какой-нибудь")).toBe(false);
    expect(threadResumable(join(tmpdir(), "дома-нет-вовсе"), "какой-нибудь")).toBe(false);
  });

  it("пустой идентификатор не считается живым тредом", () => {
    // Иначе первый же файл сессий подошёл бы под «имя содержит пустую строку».
    expect(threadResumable(дом(["019a0000-1111-7000-8000-000000000001"]), "")).toBe(false);
  });
});
