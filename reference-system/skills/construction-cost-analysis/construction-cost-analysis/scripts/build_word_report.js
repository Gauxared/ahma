/**
 * Шаблон генератора аналитической справки в формате Word (.docx).
 * 
 * Это РЕФЕРЕНСНЫЙ ШАБЛОН — копируй и адаптируй под конкретный проект.
 * 
 * ИСПОЛЬЗОВАНИЕ:
 *   1. Установи docx: npm install -g docx
 *   2. Заполни константы PROJECT_DATA реальными данными проекта
 *   3. node build_word_report.js
 * 
 * ВЫХОД:
 *   Аналитическая_справка_[Объект].docx
 * 
 * См. references/word-report.md для полной структуры отчёта.
 */

const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, PageOrientation, LevelFormat,
  HeadingLevel, BorderStyle, WidthType, ShadingType, VerticalAlign,
  PageNumber, PageBreak
} = require('docx');

// ════════════════════════════════════════════════════
// ДАННЫЕ ПРОЕКТА — ЗАПОЛНИ ПОД СВОЙ ПРОЕКТ
// ════════════════════════════════════════════════════
const PROJECT_DATA = {
  // Реквизиты
  fullName: "Капитальный ремонт автодороги [Название] на участке км X-Y",
  shortName: "[Название проекта]",
  customer: "[Наименование заказчика]",
  region: "[Регион реализации]",
  projectCode: "[Шифр проекта]",
  designer: "[Проектная организация]",
  
  // Финансовые итоги (на целевую дату)
  smetnaya_pod_kluch: 0,           // Сметная стоимость «под ключ»
  nmck_with_vat: 0,                // НМЦК подрядчика с НДС
  profit_materials: 0,             // Прибыль на материалах
  profit_works: 0,                 // Прибыль на работах
  total_profit: 0,                 // Общая дополнительная прибыль
  margin_percent: 0,               // Маржинальность от НМЦК (%)
  
  // Главные акценты для резюме
  biggest_risk: {
    name: "[Название позиции]",
    smeta_price: 0,
    market_price: 0,
    impact_rub: 0,
  },
  biggest_gain: {
    name: "[Название позиции]",
    impact_rub: 0,
    margin: 0,
  },
  
  // Дата документа
  prepared_date: "май 2026 г.",
  excel_filename: "smeta_aksonomia.xlsx",
};

// ════════════════════════════════════════════════════
// СТИЛИ
// ════════════════════════════════════════════════════
const FONT = "Arial";

const C_DARK = "1F4E78";
const C_ACCENT = "C00000";
const C_GREEN = "548235";
const C_RED = "9C0006";
const C_GREY = "595959";
const C_LIGHT_BLUE = "D9E1F2";
const C_LIGHT_GREEN = "C6EFCE";
const C_LIGHT_RED = "FFC7CE";
const C_LIGHT_YELLOW = "FFE699";

const border = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };

const hrBorder = {
  bottom: { style: BorderStyle.SINGLE, size: 12, color: C_DARK, space: 4 }
};

// ════════════════════════════════════════════════════
// ХЕЛПЕРЫ
// ════════════════════════════════════════════════════
function p(text, opts = {}) {
  const runs = Array.isArray(text) ? text : [new TextRun({
    text: text,
    font: FONT,
    size: opts.size || 22,
    bold: opts.bold || false,
    italics: opts.italic || false,
    color: opts.color || "000000",
  })];
  return new Paragraph({
    children: runs,
    alignment: opts.align || AlignmentType.JUSTIFIED,
    spacing: { before: opts.before || 60, after: opts.after || 60, line: 300 },
    border: opts.border,
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, font: FONT, size: 32, bold: true, color: C_DARK })],
    spacing: { before: 360, after: 180 },
    border: hrBorder,
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, font: FONT, size: 26, bold: true, color: C_DARK })],
    spacing: { before: 280, after: 120 },
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text, font: FONT, size: 22, bold: true, color: C_DARK })],
    spacing: { before: 200, after: 80 },
  });
}

function bullet(text) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    children: Array.isArray(text) ? text : [new TextRun({ text, font: FONT, size: 22 })],
    spacing: { before: 30, after: 30, line: 280 },
  });
}

function spacer() {
  return new Paragraph({ children: [new TextRun({ text: " ", font: FONT, size: 12 })] });
}

function cell(text, opts = {}) {
  const runs = Array.isArray(text) ? text : [new TextRun({
    text: String(text),
    font: FONT,
    size: opts.size || 20,
    bold: opts.bold || false,
    color: opts.color || "000000",
  })];
  return new TableCell({
    borders,
    width: { size: opts.width || 1000, type: WidthType.DXA },
    shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      children: runs,
      alignment: opts.align || AlignmentType.LEFT,
      spacing: { before: 0, after: 0, line: 260 },
    })],
  });
}

function headerCell(text, width) {
  return cell(text, { bold: true, color: "FFFFFF", fill: C_DARK, align: AlignmentType.CENTER, width });
}

function buildTable(rows, columnWidths) {
  const totalWidth = columnWidths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths: columnWidths,
    rows: rows,
  });
}

function fmt(n) {
  if (typeof n !== 'number') return n;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n);
}

// ════════════════════════════════════════════════════
// СБОРКА ДОКУМЕНТА
// ════════════════════════════════════════════════════
const children = [];

// ─── ТИТУЛ ───
children.push(new Paragraph({
  children: [new TextRun({ text: "АНАЛИТИЧЕСКАЯ СПРАВКА", font: FONT, size: 36, bold: true, color: C_DARK })],
  alignment: AlignmentType.CENTER,
  spacing: { before: 600, after: 120 },
}));

children.push(new Paragraph({
  children: [new TextRun({ text: "по инвестиционно-строительному проекту", font: FONT, size: 24, italics: true, color: C_GREY })],
  alignment: AlignmentType.CENTER,
  spacing: { after: 360 },
}));

children.push(new Paragraph({
  children: [new TextRun({ text: PROJECT_DATA.fullName, font: FONT, size: 28, bold: true })],
  alignment: AlignmentType.CENTER,
  spacing: { after: 240 },
}));

children.push(new Paragraph({
  children: [
    new TextRun({ text: "Заказчик: ", font: FONT, size: 22, bold: true }),
    new TextRun({ text: PROJECT_DATA.customer, font: FONT, size: 22 }),
  ],
  alignment: AlignmentType.CENTER,
}));

children.push(new Paragraph({
  children: [
    new TextRun({ text: "Регион: ", font: FONT, size: 22, bold: true }),
    new TextRun({ text: PROJECT_DATA.region, font: FONT, size: 22 }),
  ],
  alignment: AlignmentType.CENTER,
}));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ─── 1. КРАТКОЕ РЕЗЮМЕ ───
children.push(h1("1. Краткое резюме"));

const isProfit = PROJECT_DATA.total_profit > 0;
children.push(p([
  new TextRun({
    text: isProfit ? "Объект — прибыльный для подрядчика. " : "Объект убыточен для подрядчика. ",
    font: FONT, size: 24, bold: true,
    color: isProfit ? C_GREEN : C_RED,
  }),
  new TextRun({
    text: `По итогам сопоставления сметной стоимости с актуальными рыночными ценами материалов и работ расчётная ${isProfit ? "дополнительная прибыль" : "потеря"} подрядчика составляет ≈ ${fmt(Math.abs(PROJECT_DATA.total_profit))} руб.`,
    font: FONT, size: 22,
  }),
]));

children.push(buildTable([
  new TableRow({ children: [
    headerCell("Показатель", 5400),
    headerCell("Сумма, руб", 3600),
  ]}),
  new TableRow({ children: [
    cell("Сметная стоимость объекта «под ключ»", { width: 5400 }),
    cell(fmt(PROJECT_DATA.smetnaya_pod_kluch), { width: 3600, align: AlignmentType.RIGHT, bold: true }),
  ]}),
  new TableRow({ children: [
    cell("НМЦК подрядчика с НДС", { width: 5400 }),
    cell(fmt(PROJECT_DATA.nmck_with_vat), { width: 3600, align: AlignmentType.RIGHT }),
  ]}),
  new TableRow({ children: [
    cell("Прибыль на материалах (рыночная коррекция)", { width: 5400, fill: C_LIGHT_GREEN }),
    cell(`${PROJECT_DATA.profit_materials >= 0 ? '+' : ''}${fmt(PROJECT_DATA.profit_materials)}`, 
         { width: 3600, align: AlignmentType.RIGHT, fill: C_LIGHT_GREEN, color: C_GREEN, bold: true }),
  ]}),
  new TableRow({ children: [
    cell("Прибыль на работах (коэф. рыночности)", { width: 5400, fill: C_LIGHT_GREEN }),
    cell(`${PROJECT_DATA.profit_works >= 0 ? '+' : ''}${fmt(PROJECT_DATA.profit_works)}`,
         { width: 3600, align: AlignmentType.RIGHT, fill: C_LIGHT_GREEN, color: C_GREEN, bold: true }),
  ]}),
  new TableRow({ children: [
    cell("ОБЩАЯ ДОПОЛНИТЕЛЬНАЯ ПРИБЫЛЬ", { width: 5400, fill: C_LIGHT_YELLOW, bold: true }),
    cell(`${PROJECT_DATA.total_profit >= 0 ? '+' : ''}${fmt(PROJECT_DATA.total_profit)}`,
         { width: 3600, align: AlignmentType.RIGHT, fill: C_LIGHT_YELLOW, color: isProfit ? C_GREEN : C_RED, bold: true, size: 22 }),
  ]}),
  new TableRow({ children: [
    cell("Маржинальность от НМЦК", { width: 5400 }),
    cell(`${PROJECT_DATA.margin_percent.toFixed(1)} %`, { width: 3600, align: AlignmentType.RIGHT, bold: true }),
  ]}),
], [5400, 3600]));

// Здесь должны быть остальные разделы:
// 2. О ПРОЕКТЕ
// 3. КАК ЧИТАТЬ ФАЙЛ
// 4. ФИНАНСОВЫЙ РЕЗУЛЬТАТ
// 5. ИСТОЧНИКИ ДАННЫХ
// 6. МЕТОДОЛОГИЯ РАСЧЁТА
// 7. ПОГРЕШНОСТИ И ОГРАНИЧЕНИЯ
// 8. ВЫВОДЫ И РЕКОМЕНДАЦИИ
// См. references/word-report.md для полной структуры

// ════════════════════════════════════════════════════
// ФИНАЛЬНАЯ СБОРКА
// ════════════════════════════════════════════════════
const doc = new Document({
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: FONT, color: C_DARK },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: FONT, color: C_DARK },
        paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 22, bold: true, font: FONT, color: C_DARK },
        paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 } },
    ]
  },
  numbering: {
    config: [{
      reference: "bullets",
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: "•",
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } }
      }]
    }]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 }, // US Letter
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          children: [
            new TextRun({
              text: `Аналитическая справка по проекту «${PROJECT_DATA.shortName}»`,
              font: FONT, size: 18, color: C_GREY, italics: true
            }),
          ],
          alignment: AlignmentType.RIGHT,
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "BFBFBF", space: 2 } },
        })]
      })
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          children: [
            new TextRun({ text: "Стр. ", font: FONT, size: 18, color: C_GREY }),
            new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: C_GREY }),
            new TextRun({ text: " / ", font: FONT, size: 18, color: C_GREY }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 18, color: C_GREY }),
          ],
          alignment: AlignmentType.CENTER,
        })]
      })
    },
    children: children,
  }]
});

const outputFilename = `/mnt/user-data/outputs/Аналитическая_справка_${PROJECT_DATA.shortName}.docx`;

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(outputFilename, buffer);
  console.log(`✓ Документ сохранён: ${outputFilename}`);
  console.log(`  Размер: ${(buffer.length / 1024).toFixed(1)} KB`);
  console.log(`\n⚠️ Это РЕФЕРЕНСНЫЙ ШАБЛОН с одним разделом (резюме).`);
  console.log(`   Дополни разделами 2-8 согласно references/word-report.md`);
});
