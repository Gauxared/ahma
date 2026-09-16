import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { writeSmokePresentation } from "../src/smoke.mjs";

test("uses the approved canonical 7KL colors", async () => {
  const { BRAND_COLORS } = await import("../src/smoke.mjs");

  assert.deepEqual(BRAND_COLORS, {
    black: "000000",
    red: "FF0000",
    white: "FFFFFF",
  });
});

test("writes a non-empty PowerPoint smoke presentation", async () => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "7kl-pptx-smoke-"));
  const outputPath = path.join(temporaryDirectory, "smoke.pptx");

  try {
    const writtenPath = await writeSmokePresentation(outputPath);
    const presentation = await readFile(writtenPath);

    assert.equal(writtenPath, outputPath);
    assert.ok(presentation.length > 10_000);
    assert.equal(presentation.subarray(0, 2).toString("ascii"), "PK");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
