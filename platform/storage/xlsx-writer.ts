/**
 * Рендер книги в xlsx (ТЗ §10).
 *
 * Единственное место, знающее про библиотеку записи. Структуру книги описывает
 * `modules/exports`, а здесь она только раскладывается по ячейкам.
 *
 * Формульные ячейки записываются вместе с ожидаемым результатом: без него
 * табличный процессор покажет пустоту до первого пересчёта, а внешние читатели
 * (1С, BI) не увидят значения вовсе.
 *
 * ТЕКСТ ИЗ ИСТОЧНИКА ОБЕЗВРЕЖИВАЕТСЯ ЗДЕСЬ
 *
 * Наименования позиций приходят из документов заказчика и подрядчиков, а книгу
 * открывает заказчик. Текст, начинающийся с `=`, Excel вычислит при открытии.
 * Экранирование стоит именно в писателе, а не в модуле выгрузки: так его нельзя
 * обойти, добавив новую выгрузку и забыв про защиту.
 *
 * Формулы, которые строит САМА система, экранированию не подлежат — они и
 * должны вычисляться. Различие проходит по виду ячейки, а не по её содержимому.
 */
import ExcelJS from "exceljs";

import { escapeFormulaInjection } from "@contracts/index.js";
import type { Cell, WorkbookSpec } from "@modules/exports/calculation-workbook.js";

const HEADER_FILL = "FFE8E8E8";
/** Вводимые значения подсвечиваются — прямое требование §10. */
const INPUT_FILL = "FFFFF2CC";
const TOTAL_FILL = "FFD9E7D9";

function applyStyle(target: ExcelJS.Cell, cell: Cell): void {
  const style = "style" in cell ? cell.style : undefined;

  if (style === "header") {
    target.font = { bold: true };
    target.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  } else if (style === "input") {
    target.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT_FILL } };
  } else if (style === "total") {
    target.font = { bold: true };
    target.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };
  } else if (style === "note") {
    target.font = { italic: true, size: 9 };
  }
}

/**
 * Книга в байты, а не в файл.
 *
 * Понадобилось вебу: скачивание отдаёт тело ответа, и запись во временный файл
 * ради того, чтобы сразу его прочитать, — это второй источник правды и мусор,
 * который кто-то обязан убирать.
 *
 * `writeWorkbook` теперь тонкая обёртка над этой функцией: одна раскладка по
 * ячейкам на оба выхода. Разойдись они — файл из командной строки и файл из
 * браузера отличались бы содержимым, и разницу заметили бы у заказчика.
 */
export async function buildWorkbook(spec: WorkbookSpec): Promise<Uint8Array> {
  const workbook = renderWorkbook(spec);
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

export async function writeWorkbook(spec: WorkbookSpec, path: string): Promise<void> {
  await renderWorkbook(spec).xlsx.writeFile(path);
}

function renderWorkbook(spec: WorkbookSpec): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = `СтройИнтеллект ${spec.metadata.generatorVersion}`;
  workbook.description = `Шаблон ${spec.metadata.templateVersion}, артефакт ${spec.metadata.artifactId}`;

  for (const sheet of spec.sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    worksheet.columns = sheet.columnWidths.map((width) => ({ width }));

    for (const [rowIndex, row] of sheet.rows.entries()) {
      for (const [columnIndex, cell] of row.entries()) {
        if (cell.kind === "empty") continue;

        const target = worksheet.getCell(rowIndex + 1, columnIndex + 1);

        if (cell.kind === "text") {
          // Текст пришёл из чужого документа: он обезвреживается, но не режется.
          target.value = escapeFormulaInjection(cell.value);
        } else if (cell.kind === "number") {
          target.value = Number(cell.value);
          target.numFmt = "#,##0.00";
        } else {
          // Формула плюс закэшированный результат: иначе до первого пересчёта
          // ячейка пуста для всех, кто читает файл программно.
          target.value = { formula: cell.formula, result: Number(cell.expected) };
          target.numFmt = "#,##0.00";
        }

        applyStyle(target, cell);
      }
    }
  }

  return workbook;
}
