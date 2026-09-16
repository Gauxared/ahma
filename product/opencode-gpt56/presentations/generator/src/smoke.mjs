import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import PptxGenJS from "pptxgenjs";
import sharp from "sharp";

export const BRAND_COLORS = Object.freeze({
  black: "000000",
  red: "FF0000",
  white: "FFFFFF",
});

const MODULE_PATH = fileURLToPath(import.meta.url);
const GENERATOR_DIRECTORY = path.dirname(path.dirname(MODULE_PATH));
const DEFAULT_OUTPUT_PATH = path.join(GENERATOR_DIRECTORY, "output/7kl-smoke.pptx");

async function createSevenLinesMark() {
  const lines = Array.from({ length: 7 }, (_, index) => {
    const y = 22 + index * 28;
    return `<line x1="18" y1="${y}" x2="206" y2="${y - 18}" />`;
  }).join("");

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="224" height="224" viewBox="0 0 224 224">
      <g fill="none" stroke="#${BRAND_COLORS.red}" stroke-width="14" stroke-linecap="square">
        ${lines}
      </g>
    </svg>
  `;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

function configurePresentation(pptx) {
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "7 Красных Линий";
  pptx.company = "7 Красных Линий";
  pptx.subject = "Проверка генератора презентаций";
  pptx.title = "7 КРАСНЫХ ЛИНИЙ";
  pptx.lang = "ru-RU";
  pptx.theme = {
    headFontFace: "Montserrat",
    bodyFontFace: "Montserrat",
  };
}

function addTitle(slide) {
  slide.addText(
    [
      { text: "7 ", options: { color: BRAND_COLORS.red } },
      { text: "КРАСНЫХ ЛИНИЙ", options: { color: BRAND_COLORS.white } },
    ],
    {
      x: 3.48,
      y: 2.79,
      w: 8.42,
      h: 1.08,
      margin: 0,
      fontFace: "Montserrat",
      fontSize: 38,
      bold: true,
      breakLine: false,
      fit: "shrink",
      lang: "ru-RU",
      valign: "middle",
    },
  );
}

async function composeSmokeSlide(pptx) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND_COLORS.white };

  slide.addShape(pptx.ShapeType.rect, {
    x: 2.82,
    y: 1.12,
    w: 9.72,
    h: 5.26,
    line: { color: BRAND_COLORS.black, transparency: 100 },
    fill: { color: BRAND_COLORS.black },
  });

  slide.addShape(pptx.ShapeType.rect, {
    x: 2.82,
    y: 0.72,
    w: 1.92,
    h: 0.16,
    line: { color: BRAND_COLORS.red, transparency: 100 },
    fill: { color: BRAND_COLORS.red },
  });

  const mark = await createSevenLinesMark();
  slide.addImage({
    data: `data:image/png;base64,${mark.toString("base64")}`,
    x: 0.62,
    y: 2.28,
    w: 1.74,
    h: 1.74,
    altText: "Семь красных линий",
  });
  addTitle(slide);
}

export async function writeSmokePresentation(outputPath = DEFAULT_OUTPUT_PATH) {
  const resolvedOutputPath = path.isAbsolute(outputPath)
    ? outputPath
    : path.resolve(GENERATOR_DIRECTORY, outputPath);
  await mkdir(path.dirname(resolvedOutputPath), { recursive: true });

  const pptx = new PptxGenJS();
  configurePresentation(pptx);
  await composeSmokeSlide(pptx);

  await pptx.writeFile({ fileName: resolvedOutputPath, compression: true });
  return resolvedOutputPath;
}

const isDirectRun = process.argv[1]
  ? MODULE_PATH === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  const writtenPath = await writeSmokePresentation();
  console.log(writtenPath);
}
