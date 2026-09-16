import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { DEMO_SLIDE_COUNT, writeDesignSystemDemo } from "../src/design-system-demo.mjs";

const execFileAsync = promisify(execFile);
const generatorDirectory = fileURLToPath(new URL("../", import.meta.url));
const demoScript = path.join(generatorDirectory, "src/design-system-demo.mjs");
const defaultPptxPath = path.join(generatorDirectory, "output/design-system-demo.pptx");

async function readArchiveEntry(pptxPath, entry) {
  const { stdout } = await execFileAsync("unzip", ["-p", pptxPath, entry], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

test("demo contains twelve deliberately varied scenes", async () => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "7kl-demo-"));
  const outputPath = path.join(temporaryDirectory, "demo.pptx");

  try {
    await writeDesignSystemDemo(outputPath);
    const presentationXml = await readArchiveEntry(outputPath, "ppt/presentation.xml");
    const slideCount = (presentationXml.match(/<p:sldId\b/g) ?? []).length;

    assert.equal(DEMO_SLIDE_COUNT, 12);
    assert.equal(slideCount, DEMO_SLIDE_COUNT);
    assert.ok((await readFile(outputPath)).length > 100_000);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("demo output stays anchored to the generator when launched from an external cwd", { timeout: 60_000 }, async () => {
  const externalDirectory = await mkdtemp(path.join(tmpdir(), "7kl-demo-cwd-"));
  await rm(defaultPptxPath, { force: true });

  try {
    const { stdout } = await execFileAsync(process.execPath, [demoScript], {
      cwd: externalDirectory,
      timeout: 60_000,
    });
    assert.match(stdout, /generator\/output\/design-system-demo\.pptx/);
    await access(defaultPptxPath);
    await assert.rejects(access(path.join(externalDirectory, "output/design-system-demo.pptx")), {
      code: "ENOENT",
    });
  } finally {
    await rm(externalDirectory, { recursive: true, force: true });
  }
});

test("generated slides contain the canonical white black and red brand colors", async () => {
  await writeDesignSystemDemo(defaultPptxPath);
  const slideXml = await readArchiveEntry(defaultPptxPath, "ppt/slides/*.xml");

  assert.match(slideXml, /FFFFFF/);
  assert.match(slideXml, /000000/);
  assert.match(slideXml, /FF0000/);
});

test("every demo object stays inside the exact slide canvas", async () => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "7kl-demo-bounds-"));
  const outputPath = path.join(temporaryDirectory, "demo.pptx");

  try {
    await writeDesignSystemDemo(outputPath);
    const slideXml = await readArchiveEntry(outputPath, "ppt/slides/*.xml");
    const transformPattern = /<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/g;
    const slideWidth = 10 * 914_400;
    const slideHeight = 5.625 * 914_400;
    const violations = [];

    for (const match of slideXml.matchAll(transformPattern)) {
      const [x, y, width, height] = match.slice(1).map(Number);
      if (x < 0 || y < 0 || x + width > slideWidth + 1_000 || y + height > slideHeight + 1_000) {
        violations.push({ x, y, width, height });
      }
    }

    assert.deepEqual(violations, []);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("funnel scene uses stable centered layers without rotated chevrons", async () => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "7kl-demo-funnel-"));
  const outputPath = path.join(temporaryDirectory, "demo.pptx");

  try {
    await writeDesignSystemDemo(outputPath);
    const funnelSlideXml = await readArchiveEntry(outputPath, "ppt/slides/slide10.xml");
    assert.doesNotMatch(funnelSlideXml, /rot="5400000"/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
