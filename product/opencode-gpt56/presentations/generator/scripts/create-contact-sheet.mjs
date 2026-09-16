import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const MODULE_PATH = fileURLToPath(import.meta.url);

export function layoutContactSheet(pageCount, options = {}) {
  const columns = options.columns ?? 4;
  const pageWidth = options.pageWidth ?? 600;
  const pageHeight = options.pageHeight ?? 338;
  const gap = options.gap ?? 24;
  const labelHeight = options.labelHeight ?? 30;
  const rows = Math.ceil(pageCount / columns);
  return {
    columns,
    rows,
    pageWidth,
    pageHeight,
    labelHeight,
    gap,
    canvasWidth: columns * pageWidth + (columns + 1) * gap,
    canvasHeight: rows * (pageHeight + labelHeight) + (rows + 1) * gap,
  };
}

function labelSvg(width, height, label) {
  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#000000"/>
      <text x="${width / 2}" y="${height * 0.67}" text-anchor="middle"
        font-family="Montserrat" font-size="15" font-weight="700" fill="#FFFFFF">${label}</text>
    </svg>
  `);
}

export async function createContactSheet(inputDirectory, outputPath, options = {}) {
  const files = (await readdir(inputDirectory))
    .filter((name) => name.toLowerCase().endsWith(".png"))
    .sort((left, right) => left.localeCompare(right, "ru", { numeric: true }));
  if (!files.length) throw new Error(`PNG-страницы не найдены: ${inputDirectory}`);

  const layout = layoutContactSheet(files.length, options);
  const composites = [];
  for (const [index, fileName] of files.entries()) {
    const column = index % layout.columns;
    const row = Math.floor(index / layout.columns);
    const left = layout.gap + column * (layout.pageWidth + layout.gap);
    const top = layout.gap + row * (layout.pageHeight + layout.labelHeight + layout.gap);
    const page = await sharp(path.join(inputDirectory, fileName))
      .resize(layout.pageWidth, layout.pageHeight, { fit: "contain", background: "#FFFFFF" })
      .png()
      .toBuffer();
    composites.push({ input: page, left, top });
    composites.push({ input: labelSvg(layout.pageWidth, layout.labelHeight, `СЛАЙД ${String(index + 1).padStart(2, "0")}`), left, top: top + layout.pageHeight });
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await sharp({
    create: {
      width: layout.canvasWidth,
      height: layout.canvasHeight,
      channels: 3,
      background: "#E8E8E8",
    },
  }).composite(composites).png({ compressionLevel: 9 }).toFile(outputPath);
  return { outputPath, pageCount: files.length, ...layout };
}

const isDirectRun = process.argv[1] ? MODULE_PATH === path.resolve(process.argv[1]) : false;
if (isDirectRun) {
  const [inputDirectory, outputPath] = process.argv.slice(2);
  if (!inputDirectory || !outputPath) throw new Error("usage: create-contact-sheet.mjs <pages-directory> <output.png>");
  const result = await createContactSheet(path.resolve(inputDirectory), path.resolve(outputPath));
  console.log(JSON.stringify(result));
}
