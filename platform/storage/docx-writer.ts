/**
 * Рендер записки в docx (ТЗ §10).
 *
 * Единственное место, знающее про библиотеку записи Word. Структуру записки
 * описывает `modules/exports/memo.ts`, а здесь она только раскладывается по
 * абзацам — по той же причине, что и книга Excel: логика выгрузки не должна
 * знать про библиотеку, а проверять структуру документа на его же рендере
 * значит проверять библиотеку, а не себя.
 *
 * ЭКРАНИРОВАНИЕ ЗДЕСЬ НЕ НУЖНО
 *
 * Word не вычисляет содержимое абзаца: текста, который «исполнится при
 * открытии», в docx нет. Это стоит сказать явно — иначе при следующем чтении
 * отсутствие защиты выглядит как забытая защита, а не как её ненужность.
 */
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { writeFile } from "node:fs/promises";

import type { Memo, MemoBlock } from "@modules/exports/memo.js";

const HEADING_BY_LEVEL = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
} as const;

function paragraphOf(block: MemoBlock): Paragraph {
  if (block.kind === "heading") {
    return new Paragraph({ text: block.text, heading: HEADING_BY_LEVEL[block.level] });
  }

  if (block.kind === "bullet") {
    return new Paragraph({ text: block.text, bullet: { level: 0 } });
  }

  if (block.kind === "field") {
    // Метка жирная, значение обычное: паспорт читают глазами по левому краю.
    return new Paragraph({
      children: [new TextRun({ text: `${block.label}: `, bold: true }), new TextRun(block.value)],
    });
  }

  return new Paragraph({
    children: [new TextRun({ text: block.text, bold: block.emphasis === true })],
  });
}

/**
 * Записка в байты, а не в файл.
 *
 * Понадобилось вебу по той же причине, что и книге: скачивание отдаёт тело
 * ответа, и временный файл ради немедленного чтения — лишний источник правды.
 * `writeMemo` стал обёрткой, чтобы файл из командной строки и файл из браузера
 * не могли разойтись содержимым.
 */
export async function buildMemoDocx(memo: Memo): Promise<Uint8Array> {
  const document = new Document({
    creator: "СтройИнтеллект",
    description: `Записка, шаблон ${memo.templateVersion}`,
    sections: [{ children: memo.blocks.map(paragraphOf) }],
  });

  return new Uint8Array(await Packer.toBuffer(document));
}

export async function writeMemo(memo: Memo, path: string): Promise<void> {
  await writeFile(path, await buildMemoDocx(memo));
}
