import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const generatorDirectory = fileURLToPath(new URL("../", import.meta.url));
const rendererPath = path.join(generatorDirectory, "scripts/render-smoke.sh");
const generatorOutputDirectory = path.join(generatorDirectory, "output");
const pptxPath = path.join(generatorOutputDirectory, "7kl-smoke.pptx");
const pdfPath = path.join(generatorOutputDirectory, "7kl-smoke.pdf");

test("renderer succeeds from outside the generator only after all artifact gates pass", { timeout: 60_000 }, async () => {
  const externalDirectory = await mkdtemp(path.join(tmpdir(), "7kl-render-cwd-"));

  await rm(pptxPath, { force: true });
  await rm(pdfPath, { force: true });

  try {
    const { stdout } = await execFileAsync("/bin/bash", [rendererPath], {
      cwd: externalDirectory,
      env: process.env,
      timeout: 60_000,
    });

    assert.match(stdout, /fontconfig Montserrat: .*generator\/assets\/fonts\/Montserrat\[wght\]\.ttf/);
    assert.match(stdout, /pdfinfo pages: 1/);
    assert.match(stdout, /pdffonts embedded Montserrat: \S*Montserrat\S*/);
    await access(pptxPath);
    await access(pdfPath);
    await assert.rejects(access(path.join(externalDirectory, "output", "7kl-smoke.pptx")), {
      code: "ENOENT",
    });
  } finally {
    await rm(externalDirectory, { recursive: true, force: true });
  }
});
