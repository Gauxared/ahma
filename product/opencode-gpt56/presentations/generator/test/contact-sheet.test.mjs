import assert from "node:assert/strict";
import test from "node:test";

import { layoutContactSheet } from "../scripts/create-contact-sheet.mjs";

test("contact sheet lays 32 widescreen pages into a legible 4 by 8 grid", () => {
  const layout = layoutContactSheet(32, { columns: 4, pageWidth: 600, pageHeight: 338, gap: 24, labelHeight: 30 });
  assert.equal(layout.columns, 4);
  assert.equal(layout.rows, 8);
  assert.equal(layout.canvasWidth, 4 * 600 + 5 * 24);
  assert.equal(layout.canvasHeight, 8 * (338 + 30) + 9 * 24);
});
