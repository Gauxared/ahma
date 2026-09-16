import assert from "node:assert/strict";
import test from "node:test";

import { DECK_META, EVIDENCE_STATUS, THEME } from "../src/theme.mjs";

test("theme locks the approved 10 by 5.625 inch grid", () => {
  assert.deepEqual(THEME.slide, { width: 10, height: 5.625, ratio: "16:9" });
  assert.deepEqual(THEME.grid.content, {
    x: 0.5,
    y: 1.1,
    w: 9,
    h: 4,
    right: 9.5,
    bottom: 5.1,
  });
  assert.equal(THEME.grid.titleY, 0.35);
  assert.equal(THEME.grid.railWidth, 0.06);
  assert.equal(THEME.grid.footerHeight, 0.3);
});

test("theme exposes the canonical 7KL palette and Montserrat typography", () => {
  assert.deepEqual(THEME.colors, {
    red: "FF0000",
    darkRed: "CC0000",
    white: "FFFFFF",
    black: "000000",
    text: "333333",
    secondary: "666666",
    caption: "999999",
    panel: "F5F5F5",
    divider: "E0E0E0",
  });
  assert.equal(THEME.font.family, "Montserrat");
  assert.equal(THEME.type.title.size, 20);
  assert.ok(THEME.type.dense.size >= 9);
  assert.deepEqual(DECK_META, {
    author: "7 КРАСНЫХ ЛИНИЙ",
    company: "7 КРАСНЫХ ЛИНИЙ",
    language: "ru-RU",
    subject: "СтройИнтеллект — система презентаций A+B",
    title: "7 КРАСНЫХ ЛИНИЙ — СтройИнтеллект",
  });
});

test("evidence statuses cover every approved proof state without extra colors", () => {
  assert.deepEqual(Object.keys(EVIDENCE_STATUS), [
    "demonstrated",
    "project",
    "prototype",
    "pilot",
    "roadmap",
  ]);
  for (const status of Object.values(EVIDENCE_STATUS)) {
    assert.ok([THEME.colors.red, THEME.colors.black, THEME.colors.secondary].includes(status.color));
    assert.ok(status.label.length > 4);
  }
});
