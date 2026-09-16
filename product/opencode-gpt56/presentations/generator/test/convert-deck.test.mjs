import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { writeDesignSystemDemo } from "../src/design-system-demo.mjs";

const execFileAsync = promisify(execFile);
const generatorDirectory = fileURLToPath(new URL("../", import.meta.url));
const converterPath = path.join(generatorDirectory, "scripts/convert-deck.sh");

test("generic converter validates matching page count and embedded Montserrat", { timeout: 90_000 }, async () => {
  const externalDirectory = await mkdtemp(path.join(tmpdir(), "7kl-convert-cwd-"));
  const pptxPath = path.join(externalDirectory, "design-system-demo.pptx");
  const outputDirectory = path.join(externalDirectory, "pdf");
  const pdfPath = path.join(outputDirectory, "design-system-demo.pdf");

  try {
    await writeDesignSystemDemo(pptxPath);
    const { stdout } = await execFileAsync("/bin/bash", [converterPath, pptxPath, outputDirectory], {
      cwd: externalDirectory,
      env: process.env,
      timeout: 90_000,
    });

    assert.match(stdout, /pptx slides: 12/);
    assert.match(stdout, /pdfinfo pages: 12/);
    assert.match(stdout, /pdffonts embedded Montserrat: \S*Montserrat\S*/);
    await access(pdfPath);
  } finally {
    await rm(externalDirectory, { recursive: true, force: true });
  }
});
