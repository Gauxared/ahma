import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  COMMERCIAL_OUTPUT_PATH,
  COMMERCIAL_PDF_PATH,
  COMMERCIAL_SLIDES,
  createCommercialDeck,
} from "../src/decks/commercial.mjs";
import { writeCommercialDeck } from "../src/build-commercial.mjs";
import { THEME } from "../src/theme.mjs";

const generatorDirectory = fileURLToPath(new URL("../", import.meta.url));
const expectedGeneratedDirectory = path.resolve(generatorDirectory, "../generated");

test("commercial deck keeps canonical visual tokens", () => {
  assert.equal(THEME.slide.width, 10);
  assert.equal(THEME.slide.height, 5.625);
  assert.equal(THEME.grid.content.x, 0.5);
  assert.equal(THEME.grid.content.right, 9.5);
  assert.equal(THEME.grid.content.y, 1.1);
  assert.equal(THEME.grid.content.bottom, 5.1);
  assert.equal(THEME.colors.red, "FF0000");
  assert.equal(THEME.colors.white, "FFFFFF");
  assert.equal(THEME.font.family, "Montserrat");
});

test("commercial narrative contains exactly 32 ordered scenes with notes", () => {
  assert.equal(COMMERCIAL_SLIDES.length, 32);
  assert.deepEqual(COMMERCIAL_SLIDES.map((slide) => slide.number), Array.from({ length: 32 }, (_, index) => index + 1));
  assert.equal(new Set(COMMERCIAL_SLIDES.map((slide) => slide.key)).size, 32);
  for (const slide of COMMERCIAL_SLIDES) {
    assert.ok(slide.title.length >= 12, `slide ${slide.number} needs a conclusion title`);
    assert.ok(slide.notes.includes("Источник:"), `slide ${slide.number} needs source notes`);
    assert.ok(slide.notes.includes("Уровень доказательности:"), `slide ${slide.number} needs evidence notes`);
    assert.ok(slide.notes.includes("Ограничение:"), `slide ${slide.number} needs claim limits`);
  }
});

test("commercial outputs are anchored to the approved generated directory", () => {
  assert.equal(COMMERCIAL_OUTPUT_PATH, path.join(expectedGeneratedDirectory, "01-stroyintellekt-commercial-universal.pptx"));
  assert.equal(COMMERCIAL_PDF_PATH, path.join(expectedGeneratedDirectory, "01-stroyintellekt-commercial-universal.pdf"));
});

test("commercial copy contains the required truthful sales claims", () => {
  const copy = COMMERCIAL_SLIDES.map((slide) => JSON.stringify(slide)).join("\n");
  const requiredClaims = [
    "от 20 млн ₽",
    "Диагностика",
    "отдельное платное предложение",
    "Доказательный пилот",
    "не входят в базовое внедрение",
    "Продемонстрировано",
    "Требует пилота и приёмки",
    "согласованной методике",
    "иерархии источников",
    "протоколу точности",
    "минимизированные и маскированные данные",
    "права использования",
    "гарантия",
    "сопровождение",
    "индивидуально",
    "не заменяет",
  ];
  for (const claim of requiredClaims) assert.match(copy, new RegExp(claim, "i"), `missing claim: ${claim}`);

  for (const forbidden of ["гарантирует экономию", "заменяет девять специалистов", "готовая промышленная мультиагентная платформа", "неограниченная производительность"]) {
    assert.doesNotMatch(copy, new RegExp(forbidden, "i"));
  }
});

test("commercial deck factory creates exactly 32 PPTX slides", () => {
  const pptx = createCommercialDeck();
  assert.equal(pptx._slides.length, 32);
});

test("commercial writer exposes the anchored default output", () => {
  assert.equal(writeCommercialDeck.defaultOutputPath, COMMERCIAL_OUTPUT_PATH);
});
