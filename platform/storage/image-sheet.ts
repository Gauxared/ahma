/**
 * Изображение в партии — лист для зрения и для экипажа (spec-demo-stage-1 А11).
 *
 * PNG, JPG, TIFF, BMP в комплекте заказчика — фото актов, сканы писем, снимки
 * чертежей. Читать их можно тем же путём, что PDF без текстового слоя: зрением.
 * Рендерить нечего — файл и есть страница, поэтому лист собирается из самого
 * файла без PDF-рендера.
 */
import { readFile } from "node:fs/promises";

import type { DesignSheet } from "./design-sheets.js";

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  tif: "image/tiff",
  tiff: "image/tiff",
  bmp: "image/bmp",
  gif: "image/gif",
  webp: "image/webp",
};

/** MIME по расширению; `undefined` — не изображение. */
export function imageMime(path: string): string | undefined {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension];
}

export async function imageAsSheet(path: string): Promise<DesignSheet> {
  const bytes = await readFile(path);
  const mime = imageMime(path) ?? "image/png";

  return {
    document: path,
    page: 1,
    dataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
    bytes: bytes.byteLength,
  };
}
