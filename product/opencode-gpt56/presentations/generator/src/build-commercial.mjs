import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  COMMERCIAL_OUTPUT_PATH,
  COMMERCIAL_SLIDES,
  createCommercialDeck,
} from "./decks/commercial.mjs";

const MODULE_PATH = fileURLToPath(import.meta.url);

export async function writeCommercialDeck(outputPath = COMMERCIAL_OUTPUT_PATH) {
  const resolvedOutputPath = path.resolve(outputPath);
  await mkdir(path.dirname(resolvedOutputPath), { recursive: true });

  const pptx = createCommercialDeck();
  if (pptx._slides.length !== COMMERCIAL_SLIDES.length) {
    throw new Error(`Ожидалось ${COMMERCIAL_SLIDES.length} слайда, создано ${pptx._slides.length}`);
  }
  await pptx.writeFile({ fileName: resolvedOutputPath, compression: true });
  return resolvedOutputPath;
}

writeCommercialDeck.defaultOutputPath = COMMERCIAL_OUTPUT_PATH;

const isDirectRun = process.argv[1] ? MODULE_PATH === path.resolve(process.argv[1]) : false;
if (isDirectRun) {
  const writtenPath = await writeCommercialDeck(process.argv[2] ?? COMMERCIAL_OUTPUT_PATH);
  console.log(writtenPath);
}
