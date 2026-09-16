import { EVIDENCE_STATUS, THEME, makeShadow } from "./theme.mjs";

const C = THEME.colors;
const G = THEME.grid;

function cloneLine(color = C.divider, width = THEME.line.thin, extra = {}) {
  return { color, width, ...extra };
}

function cloneFill(color = C.white, extra = {}) {
  return { color, ...extra };
}

function textOptions(options = {}) {
  return {
    margin: 0,
    fontFace: THEME.font.family,
    lang: THEME.font.language,
    color: C.text,
    fontSize: THEME.type.body.size,
    breakLine: false,
    fit: "shrink",
    valign: "mid",
    ...options,
  };
}

function addText(slide, text, options = {}) {
  slide.addText(text, textOptions(options));
}

function addRect(slide, options = {}) {
  slide.addShape("rect", {
    line: cloneLine(C.divider, 0.6),
    fill: cloneFill(C.white),
    ...options,
  });
}

function addLine(slide, options = {}) {
  slide.addShape("line", { line: cloneLine(), ...options });
}

function labelWidth(label, fontSize = 8.5, minimum = 0.62, maximum = 2.3) {
  return Math.min(maximum, Math.max(minimum, 0.25 + label.length * fontSize * 0.0062));
}

export function normalizeCyrillicText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t\u00a0 ]+/g, " ").trim())
    .join("\n")
    .trim();
}

export function guardText(value, options = {}) {
  const text = normalizeCyrillicText(value);
  const width = Math.max(0.1, options.width ?? options.w ?? 1);
  const height = Math.max(0.1, options.height ?? options.h ?? 0.4);
  const requested = options.fontSize ?? THEME.type.body.size;
  const minimum = Math.min(requested, options.minFontSize ?? 8);
  const lineHeight = options.lineHeight ?? 1.15;
  const explicitLines = text.split("\n");
  let selected = requested;
  let estimatedLines = 0;
  let maxLines = 0;

  for (let size = requested; size >= minimum; size -= 0.5) {
    const charactersPerLine = Math.max(1, Math.floor((width * 72) / (size * 0.53)));
    estimatedLines = explicitLines.reduce(
      (sum, line) => sum + Math.max(1, Math.ceil(line.length / charactersPerLine)),
      0,
    );
    maxLines = Math.max(1, Math.floor((height * 72) / (size * lineHeight)));
    selected = size;
    if (estimatedLines <= maxLines) break;
  }

  return Object.freeze({
    text,
    charCount: text.length,
    fontSize: selected,
    estimatedLines,
    maxLines,
    overflow: estimatedLines > maxLines,
  });
}

export function assertTextFits(value, options = {}) {
  const result = guardText(value, options);
  if (result.overflow) {
    throw new RangeError(
      `Переполнение текста: ${result.charCount} знаков, ${result.estimatedLines} строк при лимите ${result.maxLines}`,
    );
  }
  return result;
}

export function fitText(value, options = {}) {
  const result = guardText(value, options);
  return { text: result.text, fontSize: result.fontSize, overflow: result.overflow };
}

export function addSlideBase(slide, { title, deckLabel = "СТРОЙИНТЕЛЛЕКТ", page, footer = true, rail = true } = {}) {
  slide.background = { color: C.white };
  if (rail) addContentRail(slide);
  if (title) addDecisionRoomTitle(slide, title);
  if (footer) addFooter(slide, { page, deckLabel });
  return slide;
}

export function addContentRail(slide, { color = C.red } = {}) {
  addRect(slide, {
    x: 0,
    y: 0,
    w: G.railWidth,
    h: THEME.slide.height,
    line: cloneLine(color, 0, { transparency: 100 }),
    fill: cloneFill(color),
  });
}

export function addWordmark(slide, { x = 0.5, y = 0.35, w = 2.6, h = 0.34, size = 12, onRed = false, align = "left" } = {}) {
  const baseColor = onRed ? C.white : C.black;
  const redColor = onRed ? C.white : C.red;
  addText(
    slide,
    [
      { text: "7 ", options: { color: baseColor, bold: true } },
      { text: "КРАСНЫХ", options: { color: redColor, bold: true } },
      { text: " ЛИНИЙ", options: { color: baseColor, bold: true } },
    ],
    { x, y, w, h, fontSize: size, bold: true, align, breakLine: false, fit: "shrink" },
  );
}

export function addFooter(slide, { page, deckLabel = "СТРОЙИНТЕЛЛЕКТ" } = {}) {
  const y = THEME.slide.height - G.footerHeight;
  addRect(slide, {
    x: 0,
    y,
    w: THEME.slide.width,
    h: G.footerHeight,
    line: cloneLine(C.panel, 0, { transparency: 100 }),
    fill: cloneFill(C.panel),
  });
  if (deckLabel) addText(slide, deckLabel.toUpperCase(), { x: 0.5, y: y + 0.08, w: 2.4, h: 0.1, ...THEME.type.footer });
  if (page !== undefined) addText(slide, String(page).padStart(2, "0"), { x: 8.78, y: y + 0.08, w: 0.3, h: 0.1, align: "right", ...THEME.type.footer });
  addWordmark(slide, { x: 9.12, y: y + 0.055, w: 0.66, h: 0.14, size: 6, align: "right" });
}

export function addEditorialStatement(slide, {
  eyebrow,
  statement,
  support,
  metric,
  metricLabel,
  page,
  rail = true,
  footer = true,
  accentX = 6.9,
} = {}) {
  addSlideBase(slide, { page, footer, rail });
  addWordmark(slide, { x: 0.5, y: 0.35, w: 2.45, h: 0.3, size: 11 });
  if (eyebrow) addText(slide, eyebrow.toUpperCase(), { x: 0.5, y: 1.08, w: 3.2, h: 0.25, ...THEME.type.label, color: C.red, charSpacing: 1.2 });
  addText(slide, normalizeCyrillicText(statement), {
    x: 0.5,
    y: eyebrow ? 1.46 : 1.15,
    w: 6.05,
    h: support ? 2.35 : 3.1,
    ...THEME.type.statement,
    fontSize: statement?.length > 105 ? 24 : 28,
    valign: "top",
    breakLine: false,
  });
  if (support) addText(slide, normalizeCyrillicText(support), { x: 0.52, y: 4.02, w: 5.7, h: 0.72, ...THEME.type.body, valign: "top" });
  addLine(slide, { x: 6.62, y: 1.12, w: 0, h: 3.74, line: cloneLine(C.divider, 1) });
  if (metric) addText(slide, metric, { x: accentX, y: 1.58, w: 2.55, h: 1.15, ...THEME.type.hero, color: C.red, align: "right" });
  if (metricLabel) addText(slide, metricLabel, { x: accentX, y: 2.85, w: 2.55, h: 0.65, ...THEME.type.label, align: "right", valign: "top" });
}

export function addDecisionRoomTitle(slide, title, { label, x = 0.5, y = G.titleY, w = 9, h = G.titleH } = {}) {
  addText(slide, normalizeCyrillicText(title), { x, y, w: label ? w - 1.8 : w, h, ...THEME.type.title, valign: "top" });
  if (label) {
    const badgeW = labelWidth(label);
    addText(slide, label.toUpperCase(), { x: x + w - badgeW, y: y + 0.03, w: badgeW, h: 0.22, ...THEME.type.caption, bold: true, color: C.red, align: "right" });
  }
}

export function addDecisionRoomBody(slide, { x = G.content.x, y = G.content.y, w = G.content.w, h = G.content.h, fill = C.white } = {}) {
  addRect(slide, { x, y, w, h, line: cloneLine(fill === C.white ? C.divider : fill, 0.6), fill: cloneFill(fill) });
}

export function addMetric(slide, { x, y, w = 1.6, h = 0.9, value, label, prefix, color = C.red, align = "left", fill } = {}) {
  if (fill) addRect(slide, { x, y, w, h, line: cloneLine(fill, 0, { transparency: 100 }), fill: cloneFill(fill) });
  if (prefix) addText(slide, prefix.toUpperCase(), { x: x + 0.12, y: y + 0.08, w: w - 0.24, h: 0.18, ...THEME.type.caption, bold: true, color: C.secondary, align });
  addText(slide, value, { x: x + 0.12, y: y + (prefix ? 0.25 : 0.1), w: w - 0.24, h: 0.38, ...THEME.type.metric, color, align });
  addText(slide, label, { x: x + 0.12, y: y + h - 0.28, w: w - 0.24, h: 0.18, ...THEME.type.caption, align });
}

export function addLineIcon(slide, { x, y, type = "document", color = C.red, box = true } = {}) {
  if (box) addRect(slide, { x, y, w: THEME.icon.box, h: THEME.icon.box, line: cloneLine(color, 0, { transparency: 100 }), fill: cloneFill(color) });
  const iconColor = box ? C.white : color;
  const ox = x + 0.055;
  const oy = y + 0.055;
  const iw = 0.19;
  const ih = 0.19;
  if (type === "document") {
    addRect(slide, { x: ox + 0.025, y: oy, w: 0.13, h: 0.19, line: cloneLine(iconColor, 1), fill: cloneFill(iconColor, { transparency: 100 }) });
    addLine(slide, { x: ox + 0.048, y: oy + 0.07, w: 0.084, h: 0, line: cloneLine(iconColor, 0.8) });
    addLine(slide, { x: ox + 0.048, y: oy + 0.115, w: 0.084, h: 0, line: cloneLine(iconColor, 0.8) });
  } else if (type === "building") {
    addRect(slide, { x: ox + 0.018, y: oy + 0.035, w: 0.15, h: 0.155, line: cloneLine(iconColor, 1), fill: cloneFill(iconColor, { transparency: 100 }) });
    for (const dx of [0.05, 0.105]) for (const dy of [0.072, 0.12]) addRect(slide, { x: ox + dx, y: oy + dy, w: 0.025, h: 0.025, line: cloneLine(iconColor, 0.7), fill: cloneFill(iconColor, { transparency: 100 }) });
  } else if (type === "check") {
    addLine(slide, { x: ox + 0.015, y: oy + 0.1, w: 0.055, h: 0.055, line: cloneLine(iconColor, 1.4) });
    addLine(slide, { x: ox + 0.068, y: oy + 0.155, w: 0.105, h: -0.12, line: cloneLine(iconColor, 1.4) });
  } else if (type === "people") {
    slide.addShape("ellipse", { x: ox + 0.065, y: oy, w: 0.06, h: 0.06, line: cloneLine(iconColor, 1), fill: cloneFill(iconColor, { transparency: 100 }) });
    addLine(slide, { x: ox + 0.095, y: oy + 0.06, w: 0, h: 0.11, line: cloneLine(iconColor, 1.2) });
    addLine(slide, { x: ox + 0.03, y: oy + 0.105, w: 0.13, h: 0, line: cloneLine(iconColor, 1.2) });
  } else {
    addLine(slide, { x: ox, y: oy + ih, w: iw, h: -ih, line: cloneLine(iconColor, 1.2) });
    addLine(slide, { x: ox, y: oy + ih * 0.55, w: iw * 0.5, h: 0, line: cloneLine(iconColor, 1.2) });
  }
}

export function addCard(slide, { x, y, w, h, title, body, accent = "top", icon = "document", fill = C.panel, number } = {}) {
  addRect(slide, { x, y, w, h, line: cloneLine(C.divider, 0.6), fill: cloneFill(fill), shadow: makeShadow() });
  let textY = y + 0.25;
  if (accent === "header") {
    addRect(slide, { x, y, w, h: 0.46, line: cloneLine(C.red, 0, { transparency: 100 }), fill: cloneFill(C.red) });
    addLineIcon(slide, { x: x + 0.12, y: y + 0.08, type: icon, color: C.red, box: true });
    addText(slide, title, { x: x + 0.52, y: y + 0.1, w: w - 0.64, h: 0.22, fontSize: 10, bold: true, color: C.white });
    textY = y + 0.64;
  } else if (accent === "icon") {
    addLineIcon(slide, { x: x + 0.16, y: y + 0.16, type: icon, color: C.red, box: true });
    addText(slide, title, { x: x + 0.58, y: y + 0.15, w: w - 0.74, h: 0.32, fontSize: 10, bold: true, color: C.black });
    textY = y + 0.62;
  } else {
    addRect(slide, { x, y, w, h: 0.04, line: cloneLine(C.red, 0, { transparency: 100 }), fill: cloneFill(C.red) });
    if (number) addText(slide, number, { x: x + w - 0.55, y: y + 0.16, w: 0.38, h: 0.25, ...THEME.type.label, color: C.red, align: "right" });
    addText(slide, title, { x: x + 0.16, y: y + 0.16, w: w - 0.32, h: 0.38, fontSize: 10, bold: true, color: C.black, valign: "top" });
    textY = y + 0.64;
  }
  if (body) addText(slide, normalizeCyrillicText(body), { x: x + 0.16, y: textY, w: w - 0.32, h: y + h - textY - 0.14, ...THEME.type.dense, valign: "top" });
}

export function addAnnotatedQuote(slide, { x, y, w, h, quote, author, annotation } = {}) {
  addRect(slide, { x, y, w, h, line: cloneLine(C.divider, 0.7), fill: cloneFill(C.white) });
  addRect(slide, { x, y, w: 0.06, h, line: cloneLine(C.red, 0, { transparency: 100 }), fill: cloneFill(C.red) });
  addText(slide, "«", { x: x + 0.2, y: y + 0.08, w: 0.4, h: 0.45, fontSize: 34, bold: true, color: C.red });
  addText(slide, quote, { x: x + 0.66, y: y + 0.2, w: w - 0.9, h: h - 0.68, fontSize: 15, bold: true, color: C.black, italic: true, valign: "top" });
  if (author) addText(slide, author, { x: x + 0.66, y: y + h - 0.36, w: w - 0.9, h: 0.17, ...THEME.type.caption, bold: true });
  if (annotation) addText(slide, annotation, { x: x + w - 2.1, y: y - 0.28, w: 2.1, h: 0.18, ...THEME.type.caption, color: C.red, align: "right" });
}

export function addInsightBar(slide, { x = G.content.x, y, w = G.content.w, h = 0.52, label = "ВЫВОД", text } = {}) {
  addRect(slide, { x, y, w, h, line: cloneLine(C.black, 0, { transparency: 100 }), fill: cloneFill(C.black) });
  addRect(slide, { x, y, w: 1.05, h, line: cloneLine(C.red, 0, { transparency: 100 }), fill: cloneFill(C.red) });
  addText(slide, label, { x: x + 0.15, y: y + 0.16, w: 0.75, h: 0.18, ...THEME.type.caption, bold: true, color: C.white });
  addText(slide, text, { x: x + 1.25, y: y + 0.12, w: w - 1.45, h: h - 0.2, fontSize: 9.5, bold: true, color: C.white });
}

export function addEvidenceBadge(slide, { x, y, status = "pilot", label } = {}) {
  const token = EVIDENCE_STATUS[status] ?? EVIDENCE_STATUS.pilot;
  const text = label ?? token.label;
  const w = labelWidth(text, 8, 1.05, 2.25);
  addRect(slide, { x, y, w, h: 0.28, line: cloneLine(token.color, 0.8), fill: cloneFill(token.fill) });
  addRect(slide, { x: x + 0.08, y: y + 0.09, w: 0.08, h: 0.08, line: cloneLine(token.color, 0, { transparency: 100 }), fill: cloneFill(token.color) });
  addText(slide, text, { x: x + 0.23, y: y + 0.065, w: w - 0.31, h: 0.13, fontSize: 7.5, bold: true, color: token.color });
  return w;
}

export function addSourceNote(slide, { x = G.content.x, y = 4.93, w = G.content.w, text, status } = {}) {
  const source = status ? `${text} · ${status}` : text;
  addText(slide, source, { x, y, w, h: 0.12, ...THEME.type.caption, fontSize: 7.2, color: C.caption, valign: "bottom" });
}

export function addChevronFlow(slide, { x = G.content.x, y = 1.45, w = G.content.w, h = 1.05, items = [] } = {}) {
  const gap = 0.08;
  const itemW = (w - gap * (items.length - 1)) / Math.max(1, items.length);
  items.forEach((item, index) => {
    const color = index === items.length - 1 ? C.red : C.panel;
    const textColor = index === items.length - 1 ? C.white : C.black;
    slide.addShape("chevron", { x: x + index * (itemW + gap), y, w: itemW, h, line: cloneLine(color, 0.6), fill: cloneFill(color) });
    addText(slide, String(index + 1).padStart(2, "0"), { x: x + index * (itemW + gap) + 0.15, y: y + 0.12, w: 0.35, h: 0.18, ...THEME.type.caption, bold: true, color: index === items.length - 1 ? C.white : C.red });
    addText(slide, item.title ?? item, { x: x + index * (itemW + gap) + 0.15, y: y + 0.39, w: itemW - 0.35, h: 0.35, fontSize: 9.5, bold: true, color: textColor, valign: "top" });
  });
}

export function addInputAnalysisOutput(slide, { x = G.content.x, y = 1.35, w = G.content.w, h = 2.75, input = [], analysis = [], output = [] } = {}) {
  const groups = [
    { label: "ВХОД", items: input, fill: C.panel, accent: C.secondary },
    { label: "АНАЛИЗ", items: analysis, fill: C.white, accent: C.red },
    { label: "ВЫХОД", items: output, fill: C.black, accent: C.red },
  ];
  const gap = 0.34;
  const colW = (w - gap * 2) / 3;
  groups.forEach((group, index) => {
    const gx = x + index * (colW + gap);
    addRect(slide, { x: gx, y, w: colW, h, line: cloneLine(index === 1 ? C.red : C.divider, index === 1 ? 1.2 : 0.7), fill: cloneFill(group.fill) });
    addText(slide, group.label, { x: gx + 0.18, y: y + 0.18, w: colW - 0.36, h: 0.2, ...THEME.type.label, color: index === 2 ? C.white : group.accent });
    group.items.forEach((item, itemIndex) => {
      const iy = y + 0.62 + itemIndex * 0.56;
      addRect(slide, { x: gx + 0.18, y: iy + 0.04, w: 0.08, h: 0.08, line: cloneLine(group.accent, 0, { transparency: 100 }), fill: cloneFill(group.accent) });
      addText(slide, item, { x: gx + 0.37, y: iy, w: colW - 0.55, h: 0.28, fontSize: 9, bold: itemIndex === 0, color: index === 2 ? C.white : C.text, valign: "top" });
    });
    if (index < 2) addLine(slide, { x: gx + colW + 0.05, y: y + h / 2, w: gap - 0.1, h: 0, line: cloneLine(C.red, 1.5, { beginArrowType: "none", endArrowType: "triangle" }) });
  });
}

export function addCapabilityLayers(slide, { x = G.content.x, y = 1.25, w = G.content.w, h = 3.35, layers = [], outcome = "Проверяемое управленческое решение" } = {}) {
  const leftW = 6.5;
  const layerH = (h - 0.16 * (layers.length - 1)) / Math.max(1, layers.length);
  layers.forEach((layer, index) => {
    const ly = y + index * (layerH + 0.16);
    addRect(slide, { x, y: ly, w: leftW, h: layerH, line: cloneLine(index === layers.length - 1 ? C.red : C.divider, index === layers.length - 1 ? 1.1 : 0.6), fill: cloneFill(index % 2 === 0 ? C.panel : C.white) });
    addText(slide, layer.label ?? `СЛОЙ ${index + 1}`, { x: x + 0.18, y: ly + 0.12, w: 1.05, h: 0.2, ...THEME.type.caption, bold: true, color: index === layers.length - 1 ? C.red : C.secondary });
    addText(slide, layer.title ?? layer, { x: x + 1.35, y: ly + 0.1, w: leftW - 1.55, h: layerH - 0.2, fontSize: 10, bold: true, color: C.black });
  });
  addLine(slide, { x: x + leftW + 0.18, y: y + h / 2, w: 0.5, h: 0, line: cloneLine(C.red, 1.5, { endArrowType: "triangle" }) });
  addRect(slide, { x: x + 7.15, y: y + 0.62, w: w - 7.15, h: h - 1.24, line: cloneLine(C.red, 1.2), fill: cloneFill(C.white) });
  addText(slide, "РЕЗУЛЬТАТ", { x: x + 7.35, y: y + 0.9, w: w - 7.55, h: 0.2, ...THEME.type.label, color: C.red });
  addText(slide, outcome, { x: x + 7.35, y: y + 1.35, w: w - 7.55, h: 1.15, fontSize: 15, bold: true, color: C.black, valign: "top" });
}

export function addMatrix(slide, { x = G.content.x, y = 1.3, w = G.content.w, h = 3.35, columns = [], rows = [], values = [] } = {}) {
  const rowLabelW = 2.3;
  const headerH = 0.48;
  const cellW = (w - rowLabelW) / Math.max(1, columns.length);
  const cellH = (h - headerH) / Math.max(1, rows.length);
  addRect(slide, { x, y, w, h, line: cloneLine(C.divider, 0.7), fill: cloneFill(C.white) });
  columns.forEach((column, index) => addText(slide, column, { x: x + rowLabelW + index * cellW, y: y + 0.12, w: cellW, h: 0.18, ...THEME.type.caption, bold: true, color: C.secondary, align: "center" }));
  rows.forEach((row, rowIndex) => {
    const cy = y + headerH + rowIndex * cellH;
    if (rowIndex % 2 === 0) addRect(slide, { x, y: cy, w, h: cellH, line: cloneLine(C.panel, 0, { transparency: 100 }), fill: cloneFill(C.panel) });
    addText(slide, row, { x: x + 0.18, y: cy + 0.12, w: rowLabelW - 0.3, h: cellH - 0.2, fontSize: 8.5, bold: true, color: C.black });
    columns.forEach((_, columnIndex) => {
      const value = values[rowIndex]?.[columnIndex] ?? "—";
      const critical = value === "!" || value === "×" || value === "нет";
      addText(slide, value, { x: x + rowLabelW + columnIndex * cellW, y: cy + 0.11, w: cellW, h: cellH - 0.2, fontSize: 9, bold: critical, color: critical ? C.red : C.secondary, align: "center" });
    });
  });
}

export function addComparison(slide, { x = G.content.x, y = 1.25, w = G.content.w, h = 3.45, left, right } = {}) {
  const gap = 0.28;
  const colW = (w - gap) / 2;
  [left, right].forEach((column, index) => {
    const cx = x + index * (colW + gap);
    const accent = index === 1 ? C.red : C.caption;
    addRect(slide, { x: cx, y, w: colW, h, line: cloneLine(C.divider, 0.7), fill: cloneFill(C.white) });
    addRect(slide, { x: cx, y, w: colW, h: 0.5, line: cloneLine(accent, 0, { transparency: 100 }), fill: cloneFill(accent) });
    addText(slide, column.title, { x: cx + 0.2, y: y + 0.15, w: colW - 0.4, h: 0.2, fontSize: 10, bold: true, color: C.white });
    column.items.forEach((item, itemIndex) => {
      const iy = y + 0.72 + itemIndex * ((h - 0.88) / column.items.length);
      addRect(slide, { x: cx + 0.2, y: iy + 0.02, w: 0.16, h: 0.16, line: cloneLine(accent, 0, { transparency: 100 }), fill: cloneFill(accent) });
      addText(slide, index === 1 ? "✓" : "—", { x: cx + 0.2, y: iy + 0.015, w: 0.16, h: 0.12, fontSize: 7.5, bold: true, color: C.white, align: "center" });
      addText(slide, item, { x: cx + 0.49, y: iy, w: colW - 0.69, h: 0.35, fontSize: 8.8, bold: itemIndex === 0, color: C.text, valign: "top" });
    });
  });
}

export function addTimeline(slide, { x = G.content.x, y = 1.42, w = G.content.w, h = 2.85, items = [] } = {}) {
  const gap = 0.18;
  const cardW = (w - gap * (items.length - 1)) / Math.max(1, items.length);
  const lineY = y + 0.28;
  addRect(slide, { x: x + cardW / 2, y: lineY, w: w - cardW, h: 0.06, line: cloneLine(C.red, 0, { transparency: 100 }), fill: cloneFill(C.red) });
  items.forEach((item, index) => {
    const cx = x + index * (cardW + gap);
    slide.addShape("ellipse", { x: cx + cardW / 2 - 0.18, y: lineY - 0.15, w: 0.36, h: 0.36, line: cloneLine(C.red, 0, { transparency: 100 }), fill: cloneFill(C.red) });
    addText(slide, String(index + 1), { x: cx + cardW / 2 - 0.12, y: lineY - 0.075, w: 0.24, h: 0.12, fontSize: 8, bold: true, color: C.white, align: "center" });
    addCard(slide, { x: cx, y: y + 0.72, w: cardW, h: h - 0.72, title: item.title, body: item.body, accent: "icon", icon: item.icon ?? "document" });
  });
}

export function addLadder(slide, { x = 0.75, y = 1.35, w = 8.5, h = 3.2, steps = [] } = {}) {
  const stepW = w / Math.max(1, steps.length);
  const rise = h / Math.max(1, steps.length);
  steps.forEach((step, index) => {
    const sx = x + index * stepW;
    const sy = y + h - (index + 1) * rise;
    const sh = (index + 1) * rise;
    const fill = index === steps.length - 1 ? C.red : index % 2 ? C.divider : C.panel;
    addRect(slide, { x: sx, y: sy, w: stepW - 0.04, h: sh, line: cloneLine(fill, 0, { transparency: 100 }), fill: cloneFill(fill) });
    addText(slide, String(index + 1).padStart(2, "0"), { x: sx + 0.12, y: sy + 0.12, w: 0.35, h: 0.16, ...THEME.type.caption, bold: true, color: index === steps.length - 1 ? C.white : C.red });
    addText(slide, step.title ?? step, { x: sx + 0.12, y: sy + 0.38, w: stepW - 0.28, h: Math.max(0.35, sh - 0.52), fontSize: 9, bold: true, color: index === steps.length - 1 ? C.white : C.black, valign: "top" });
  });
}

export function addFunnel(slide, { x = 0.7, y = 1.25, w = 5.8, h = 3.55, stages = [], criteria = [] } = {}) {
  const stageH = h / Math.max(1, stages.length);
  stages.forEach((stage, index) => {
    const inset = index * 0.35;
    const sw = w - inset * 2;
    const sx = x + inset;
    const fill = index === stages.length - 1 ? C.red : index % 2 === 0 ? C.panel : C.divider;
    const sy = y + index * stageH;
    addRect(slide, { x: sx, y: sy, w: sw, h: stageH - 0.12, line: cloneLine(fill, 0, { transparency: 100 }), fill: cloneFill(fill) });
    addText(slide, stage, { x: sx + 0.25, y: sy + 0.14, w: sw - 0.5, h: 0.25, fontSize: 9, bold: true, color: index === stages.length - 1 ? C.white : C.black, align: "center" });
    if (index < stages.length - 1) {
      addLine(slide, {
        x: x + w / 2,
        y: sy + stageH - 0.12,
        w: 0,
        h: 0.12,
        line: cloneLine(C.red, 1.2, { endArrowType: "triangle" }),
      });
    }
  });
  if (criteria.length) {
    const criteriaX = x + w + 0.42;
    const criteriaW = Math.max(1.1, G.content.right - criteriaX);
    addText(slide, "КРИТЕРИЙ ПЕРЕХОДА", { x: criteriaX, y, w: criteriaW, h: 0.2, ...THEME.type.label, color: C.red });
    criteria.forEach((criterion, index) => {
      const cy = y + 0.5 + index * 0.66;
      addText(slide, String(index + 1).padStart(2, "0"), { x: criteriaX, y: cy, w: 0.28, h: 0.18, ...THEME.type.caption, bold: true, color: C.red });
      addText(slide, criterion, { x: criteriaX + 0.43, y: cy - 0.03, w: criteriaW - 0.43, h: 0.42, fontSize: 8.5, bold: index === criteria.length - 1, color: C.text, valign: "top" });
    });
  }
}

export function addDecisionTree(slide, { x = G.content.x, y = 1.25, w = G.content.w, h = 3.55, root, branches = [] } = {}) {
  addRect(slide, { x, y: y + h / 2 - 0.38, w: 2.1, h: 0.76, line: cloneLine(C.black, 1), fill: cloneFill(C.white) });
  addText(slide, root, { x: x + 0.18, y: y + h / 2 - 0.23, w: 1.74, h: 0.4, fontSize: 10, bold: true, color: C.black });
  branches.forEach((branch, index) => {
    const by = y + index * (h / branches.length) + 0.1;
    const bx = x + 3.25;
    addLine(slide, { x: x + 2.1, y: y + h / 2, w: 0.65, h: by + 0.34 - (y + h / 2), line: cloneLine(index === branches.length - 1 ? C.red : C.divider, 1.2) });
    addRect(slide, { x: bx, y: by, w: 2.2, h: 0.68, line: cloneLine(index === branches.length - 1 ? C.red : C.divider, 0.9), fill: cloneFill(C.panel) });
    addText(slide, branch.condition, { x: bx + 0.15, y: by + 0.12, w: 1.9, h: 0.3, fontSize: 8.5, bold: true, color: C.black });
    addLine(slide, { x: bx + 2.2, y: by + 0.34, w: 0.65, h: 0, line: cloneLine(index === branches.length - 1 ? C.red : C.divider, 1.2, { endArrowType: "triangle" }) });
    addRect(slide, { x: x + 6.1, y: by, w: w - 6.1, h: 0.68, line: cloneLine(index === branches.length - 1 ? C.red : C.divider, 0.9), fill: cloneFill(index === branches.length - 1 ? C.red : C.white) });
    addText(slide, branch.result, { x: x + 6.28, y: by + 0.12, w: w - 6.46, h: 0.35, fontSize: 8.8, bold: true, color: index === branches.length - 1 ? C.white : C.text });
  });
}

export function addRoleMap(slide, { x = G.content.x, y = 1.2, w = G.content.w, h = 3.65, center, roles = [] } = {}) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const positions = [
    [x, y], [x + w - 2.15, y], [x, y + h - 0.82], [x + w - 2.15, y + h - 0.82], [cx - 1.08, y], [cx - 1.08, y + h - 0.82],
  ];
  roles.slice(0, positions.length).forEach((role, index) => {
    const [rx, ry] = positions[index];
    const accent = role.critical ? C.red : C.divider;
    addLine(slide, { x: cx, y: cy, w: rx + 1.08 - cx, h: ry + 0.41 - cy, line: cloneLine(accent, role.critical ? 1.4 : 0.8) });
    addRect(slide, { x: rx, y: ry, w: 2.15, h: 0.82, line: cloneLine(accent, role.critical ? 1.1 : 0.7), fill: cloneFill(C.panel) });
    addText(slide, role.title ?? role, { x: rx + 0.16, y: ry + 0.15, w: 1.83, h: 0.24, fontSize: 9, bold: true, color: role.critical ? C.red : C.black, align: "center" });
    if (role.note) addText(slide, role.note, { x: rx + 0.16, y: ry + 0.44, w: 1.83, h: 0.2, ...THEME.type.caption, align: "center" });
  });
  slide.addShape("ellipse", { x: cx - 0.95, y: cy - 0.52, w: 1.9, h: 1.04, line: cloneLine(C.red, 1.4), fill: cloneFill(C.white) });
  addText(slide, center, { x: cx - 0.72, y: cy - 0.25, w: 1.44, h: 0.42, fontSize: 10, bold: true, color: C.black, align: "center" });
}

export function addRiskRegister(slide, { x = G.content.x, y = 1.25, w = G.content.w, h = 3.45, risks = [] } = {}) {
  const columns = [0, w * 0.3, w * 0.48, w * 0.63, w * 0.76, w];
  const headers = ["РИСК", "ПРИЧИНА", "ВЕРОЯТНОСТЬ", "ВЛИЯНИЕ", "ДЕЙСТВИЕ"];
  addRect(slide, { x, y, w, h: 0.46, line: cloneLine(C.black, 0, { transparency: 100 }), fill: cloneFill(C.black) });
  headers.forEach((header, index) => addText(slide, header, { x: x + columns[index] + 0.12, y: y + 0.14, w: columns[index + 1] - columns[index] - 0.2, h: 0.16, fontSize: 7.5, bold: true, color: C.white }));
  const rowH = (h - 0.46) / Math.max(1, risks.length);
  risks.forEach((risk, rowIndex) => {
    const ry = y + 0.46 + rowIndex * rowH;
    if (rowIndex % 2 === 0) addRect(slide, { x, y: ry, w, h: rowH, line: cloneLine(C.panel, 0, { transparency: 100 }), fill: cloneFill(C.panel) });
    const values = [risk.risk, risk.cause, risk.probability, risk.impact, risk.action];
    values.forEach((value, index) => addText(slide, value, { x: x + columns[index] + 0.12, y: ry + 0.12, w: columns[index + 1] - columns[index] - 0.2, h: rowH - 0.2, fontSize: 8, bold: index === 0 || (index > 1 && value === "Высокое"), color: index > 1 && value === "Высокое" ? C.red : C.text, valign: "top" }));
  });
}

export function addHorizontalBars(slide, { x = G.content.x, y = 1.35, w = 5.8, h = 2.9, data = [], max, unit = "" } = {}) {
  const maximum = max ?? Math.max(...data.map((item) => item.value), 1);
  const labelW = 1.75;
  const valueW = 0.72;
  const barW = w - labelW - valueW;
  const rowH = h / Math.max(1, data.length);
  data.forEach((item, index) => {
    const ry = y + index * rowH;
    const length = Math.max(0.04, (item.value / maximum) * barW);
    addText(slide, item.label, { x, y: ry + 0.08, w: labelW - 0.15, h: 0.22, fontSize: 8.5, bold: item.accent, color: item.accent ? C.black : C.secondary });
    addRect(slide, { x: x + labelW, y: ry + 0.08, w: barW, h: 0.24, line: cloneLine(C.panel, 0, { transparency: 100 }), fill: cloneFill(C.panel) });
    addRect(slide, { x: x + labelW, y: ry + 0.08, w: length, h: 0.24, line: cloneLine(item.accent ? C.red : C.caption, 0, { transparency: 100 }), fill: cloneFill(item.accent ? C.red : C.caption) });
    addText(slide, `${item.value}${unit}`, { x: x + labelW + barW + 0.08, y: ry + 0.07, w: valueW - 0.08, h: 0.22, fontSize: 8.5, bold: true, color: item.accent ? C.red : C.secondary, align: "right" });
  });
}

export function addSlopeChart(slide, { x = G.content.x, y = 1.35, w = 5.8, h = 2.9, data = [], leftLabel = "ДО", rightLabel = "ПОСЛЕ", unit = "" } = {}) {
  const values = data.flatMap((item) => [item.from, item.to]);
  const minimum = Math.min(...values, 0);
  const maximum = Math.max(...values, 1);
  const range = maximum - minimum || 1;
  const x1 = x + 1.15;
  const x2 = x + w - 1.15;
  const scaleY = (value) => y + h - ((value - minimum) / range) * (h - 0.65) - 0.3;
  addText(slide, leftLabel, { x, y: y + h - 0.08, w: 1.3, h: 0.18, ...THEME.type.caption, bold: true, align: "center" });
  addText(slide, rightLabel, { x: x + w - 1.3, y: y + h - 0.08, w: 1.3, h: 0.18, ...THEME.type.caption, bold: true, align: "center" });
  data.forEach((item, index) => {
    const y1 = scaleY(item.from);
    const y2 = scaleY(item.to);
    const color = item.accent ? C.red : index === 0 ? C.black : C.caption;
    addLine(slide, { x: x1, y: y1, w: x2 - x1, h: y2 - y1, line: cloneLine(color, item.accent ? 2 : 1.2) });
    for (const [px, py, value, align] of [[x1, y1, item.from, "right"], [x2, y2, item.to, "left"]]) {
      slide.addShape("ellipse", { x: px - 0.06, y: py - 0.06, w: 0.12, h: 0.12, line: cloneLine(color, 0, { transparency: 100 }), fill: cloneFill(color) });
      addText(slide, `${value}${unit}`, { x: align === "right" ? px - 0.78 : px + 0.12, y: py - 0.13, w: 0.65, h: 0.18, fontSize: 8, bold: true, color, align });
    }
  });
}

export function addWaterfall(slide, { x = G.content.x, y = 1.4, w = G.content.w, h = 2.9, data = [], unit = "" } = {}) {
  const totals = [];
  let running = 0;
  data.forEach((item) => {
    const start = item.total ? 0 : running;
    running = item.total ? item.value : running + item.value;
    totals.push({ ...item, start, end: running });
  });
  const values = totals.flatMap((item) => [item.start, item.end]);
  const minimum = Math.min(...values, 0);
  const maximum = Math.max(...values, 1);
  const range = maximum - minimum || 1;
  const baseline = y + h - 0.48;
  const plotH = h - 0.78;
  const gap = 0.16;
  const barW = (w - gap * (data.length - 1)) / Math.max(1, data.length);
  const sy = (value) => baseline - ((value - minimum) / range) * plotH;
  totals.forEach((item, index) => {
    const bx = x + index * (barW + gap);
    const top = Math.min(sy(item.start), sy(item.end));
    const bh = Math.max(0.05, Math.abs(sy(item.end) - sy(item.start)));
    const color = item.accent || item.value < 0 ? C.red : item.total ? C.black : C.caption;
    addRect(slide, { x: bx, y: top, w: barW, h: bh, line: cloneLine(color, 0, { transparency: 100 }), fill: cloneFill(color) });
    addText(slide, `${item.value > 0 && !item.total ? "+" : ""}${item.value}${unit}`, { x: bx - 0.08, y: top - 0.27, w: barW + 0.16, h: 0.18, fontSize: 8, bold: true, color, align: "center" });
    addText(slide, item.label, { x: bx - 0.08, y: baseline + 0.12, w: barW + 0.16, h: 0.32, fontSize: 7.3, color: C.secondary, align: "center", valign: "top" });
    if (index < totals.length - 1) addLine(slide, { x: bx + barW, y: sy(item.end), w: gap, h: 0, line: cloneLine(C.divider, 0.7, { dash: "dash" }) });
  });
}

export function addProgressRing(slide, { x, y, size = 1.5, value = 0.72, label, valueLabel } = {}) {
  const segments = 40;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const radius = size * 0.42;
  for (let index = 0; index < segments; index += 1) {
    const angle = (-90 + (360 / segments) * index) * Math.PI / 180;
    const inner = radius - 0.11;
    const x1 = cx + Math.cos(angle) * inner;
    const y1 = cy + Math.sin(angle) * inner;
    const x2 = cx + Math.cos(angle) * radius;
    const y2 = cy + Math.sin(angle) * radius;
    const color = index < Math.round(segments * value) ? C.red : C.divider;
    addLine(slide, { x: x1, y: y1, w: x2 - x1, h: y2 - y1, line: cloneLine(color, 2) });
  }
  addText(slide, valueLabel ?? `${Math.round(value * 100)}%`, { x: cx - size * 0.3, y: cy - 0.22, w: size * 0.6, h: 0.32, fontSize: 18, bold: true, color: C.black, align: "center" });
  if (label) addText(slide, label, { x: x, y: y + size - 0.05, w: size, h: 0.25, ...THEME.type.caption, align: "center" });
}

export function addLineChart(slide, { x = G.content.x, y = 1.35, w = 5.8, h = 2.9, series = [], labels = [], unit = "" } = {}) {
  const values = series.flatMap((item) => item.values);
  const minimum = Math.min(...values, 0);
  const maximum = Math.max(...values, 1);
  const range = maximum - minimum || 1;
  const plotX = x + 0.45;
  const plotY = y + 0.18;
  const plotW = w - 0.62;
  const plotH = h - 0.72;
  for (let index = 0; index <= 4; index += 1) addLine(slide, { x: plotX, y: plotY + (plotH / 4) * index, w: plotW, h: 0, line: cloneLine(C.divider, 0.5) });
  series.forEach((item, seriesIndex) => {
    const color = item.accent ? C.red : seriesIndex === 0 ? C.black : C.caption;
    item.values.forEach((value, index) => {
      if (index === item.values.length - 1) return;
      const next = item.values[index + 1];
      const px = plotX + (plotW / (item.values.length - 1)) * index;
      const nx = plotX + (plotW / (item.values.length - 1)) * (index + 1);
      const py = plotY + plotH - ((value - minimum) / range) * plotH;
      const ny = plotY + plotH - ((next - minimum) / range) * plotH;
      addLine(slide, { x: px, y: py, w: nx - px, h: ny - py, line: cloneLine(color, item.accent ? 2 : 1.3) });
    });
    const last = item.values.at(-1);
    const lastY = plotY + plotH - ((last - minimum) / range) * plotH;
    addText(slide, `${item.label} · ${last}${unit}`, { x: plotX + plotW - 1.25, y: lastY - 0.26, w: 1.3, h: 0.18, fontSize: 7.5, bold: true, color, align: "right" });
  });
  labels.forEach((label, index) => addText(slide, label, { x: plotX + (plotW / Math.max(1, labels.length - 1)) * index - 0.25, y: plotY + plotH + 0.13, w: 0.5, h: 0.16, fontSize: 7, color: C.caption, align: "center" }));
}

export function addRiskMatrix(slide, { x = G.content.x, y = 1.25, size = 3.45, points = [] } = {}) {
  const cell = size / 3;
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const severity = row + column;
      const fill = severity >= 4 ? "EEEEEE" : severity >= 2 ? C.panel : C.white;
      addRect(slide, { x: x + column * cell, y: y + (2 - row) * cell, w: cell, h: cell, line: cloneLine(C.divider, 0.7), fill: cloneFill(fill) });
    }
  }
  points.forEach((point) => {
    const px = x + ((point.probability - 0.5) / 3) * size;
    const py = y + size - ((point.impact - 0.5) / 3) * size;
    const color = point.critical ? C.red : C.black;
    slide.addShape("ellipse", { x: px - 0.1, y: py - 0.1, w: 0.2, h: 0.2, line: cloneLine(color, 0, { transparency: 100 }), fill: cloneFill(color) });
    addText(slide, point.label, { x: px + 0.14, y: py - 0.1, w: 1.25, h: 0.18, fontSize: 7.5, bold: true, color });
  });
  addText(slide, "ВЕРОЯТНОСТЬ →", { x, y: y + size + 0.14, w: size, h: 0.16, ...THEME.type.caption, bold: true, align: "center" });
  addText(slide, "ВЛИЯНИЕ →", { x: x - 0.62, y: y + size / 2 - 0.08, w: 1.3, h: 0.16, ...THEME.type.caption, bold: true, rotate: 270, align: "center" });
}

export function addStackedComposition(slide, { x = G.content.x, y = 1.55, w = G.content.w, h = 0.72, data = [], totalLabel } = {}) {
  const total = data.reduce((sum, item) => sum + item.value, 0) || 1;
  let cursor = x;
  data.forEach((item, index) => {
    const segmentW = (item.value / total) * w;
    const color = item.accent ? C.red : index === 0 ? C.black : index % 2 ? C.caption : C.divider;
    addRect(slide, { x: cursor, y, w: segmentW, h, line: cloneLine(C.white, 0.8), fill: cloneFill(color) });
    if (segmentW > 0.55) addText(slide, `${item.value}%`, { x: cursor + 0.08, y: y + 0.23, w: segmentW - 0.16, h: 0.2, fontSize: 8.5, bold: true, color: color === C.divider ? C.black : C.white, align: "center" });
    cursor += segmentW;
  });
  data.forEach((item, index) => {
    const ly = y + h + 0.35 + index * 0.36;
    const color = item.accent ? C.red : index === 0 ? C.black : index % 2 ? C.caption : C.divider;
    addRect(slide, { x, y: ly + 0.03, w: 0.12, h: 0.12, line: cloneLine(color, 0, { transparency: 100 }), fill: cloneFill(color) });
    addText(slide, `${item.label} — ${item.value}%`, { x: x + 0.24, y: ly, w: Math.max(0.5, w - 0.24), h: 0.18, fontSize: 8, bold: item.accent, color: item.accent ? C.red : C.text });
  });
  if (totalLabel) addText(slide, totalLabel, { x: x + w - 2.2, y: y - 0.35, w: 2.2, h: 0.2, ...THEME.type.label, color: C.secondary, align: "right" });
}

export function addPriceScene(slide, { price = "от 20 млн ₽", title = "Базовое внедрение начинается с управляемого состава", included = [], separate = [], note, page } = {}) {
  addSlideBase(slide, { page, footer: true, rail: true });
  addDecisionRoomTitle(slide, title, { label: "КОММЕРЧЕСКАЯ СЦЕНА" });
  addText(slide, price, { x: 0.5, y: 1.42, w: 4.15, h: 0.75, fontSize: 34, bold: true, color: C.red });
  addText(slide, "БАЗОВОЕ ВНЕДРЕНИЕ", { x: 0.53, y: 2.22, w: 2.3, h: 0.2, ...THEME.type.label, color: C.secondary });
  addLine(slide, { x: 4.75, y: 1.25, w: 0, h: 3.42, line: cloneLine(C.divider, 1) });
  const columns = [
    { x: 5.15, title: "МОЖЕТ ВХОДИТЬ", items: included, accent: C.black },
    { x: 7.4, title: "РАССЧИТЫВАЕТСЯ ОТДЕЛЬНО", items: separate, accent: C.red },
  ];
  columns.forEach((column) => {
    addText(slide, column.title, { x: column.x, y: 1.4, w: 2.0, h: 0.3, ...THEME.type.label, color: column.accent });
    column.items.forEach((item, index) => {
      const iy = 1.95 + index * 0.62;
      addRect(slide, { x: column.x, y: iy + 0.03, w: 0.11, h: 0.11, line: cloneLine(column.accent, 0, { transparency: 100 }), fill: cloneFill(column.accent) });
      addText(slide, item, { x: column.x + 0.23, y: iy, w: 1.78, h: 0.38, fontSize: 8.7, bold: index === 0, color: C.text, valign: "top" });
    });
  });
  if (note) addText(slide, note, { x: 0.52, y: 3.32, w: 3.85, h: 0.92, ...THEME.type.body, valign: "top" });
  addEvidenceBadge(slide, { x: 0.52, y: 4.46, status: "project", label: "Целевой состав внедрения" });
}

export function addContactScene(slide, { title = "Начнём с одного объекта и проверяемого результата", cta = "Согласовать диагностическую встречу", phone = "+7 (495) 198-14-77", email = "info@7rlines.com", site = "7rlines.ru", address = "119049, Москва, ул. Шаболовка, 23к3" } = {}) {
  addSlideBase(slide, { footer: false, rail: true });
  addLine(slide, { x: 5.25, y: 0.7, w: 0, h: 4.25, line: cloneLine(C.divider, 1) });
  addText(slide, title, { x: 0.72, y: 1.2, w: 3.95, h: 1.05, fontSize: 24, bold: true, color: C.black, valign: "top" });
  addText(slide, cta, { x: 0.72, y: 2.62, w: 3.85, h: 0.38, fontSize: 12, bold: true, color: C.red });
  const contacts = [phone, email, site, address];
  contacts.forEach((contact, index) => addText(slide, contact, { x: 0.72, y: 3.25 + index * 0.38, w: 3.9, h: 0.2, fontSize: index < 3 ? 9.5 : 8.5, bold: index < 3, color: index < 3 ? C.red : C.secondary, underline: index === 1 || index === 2 }));
  addWordmark(slide, { x: 5.75, y: 2.42, w: 3.65, h: 0.56, size: 22, align: "center" });
}

export function addConstructionDocumentVisual(slide, { x = 6.9, y = 1.35, w = 2.15, h = 2.8, annotations = [] } = {}) {
  addRect(slide, { x, y, w, h, line: cloneLine(C.black, 1), fill: cloneFill(C.white), shadow: makeShadow() });
  addRect(slide, { x: x + 0.18, y: y + 0.2, w: 0.3, h: 0.3, line: cloneLine(C.red, 0, { transparency: 100 }), fill: cloneFill(C.red) });
  addLineIcon(slide, { x: x + 0.18, y: y + 0.2, type: "building", color: C.red, box: true });
  addText(slide, "ВЕДОМОСТЬ РАБОТ", { x: x + 0.62, y: y + 0.26, w: w - 0.8, h: 0.18, fontSize: 7.5, bold: true, color: C.black });
  for (let index = 0; index < 7; index += 1) {
    const ly = y + 0.72 + index * 0.24;
    addLine(slide, { x: x + 0.2, y: ly, w: w - 0.4, h: 0, line: cloneLine(index === 3 ? C.red : C.divider, index === 3 ? 1.4 : 0.7) });
    addText(slide, String(index + 1).padStart(2, "0"), { x: x + 0.22, y: ly - 0.13, w: 0.22, h: 0.12, fontSize: 6.5, color: index === 3 ? C.red : C.caption });
  }
  addText(slide, "ИТОГО", { x: x + 0.2, y: y + h - 0.45, w: 0.55, h: 0.16, fontSize: 7, bold: true, color: C.secondary });
  addText(slide, "не равно составу", { x: x + 0.82, y: y + h - 0.48, w: w - 1.02, h: 0.2, fontSize: 8, bold: true, color: C.red, align: "right" });
  annotations.slice(0, 3).forEach((annotation, index) => {
    const ay = y + 0.9 + index * 0.66;
    addLine(slide, { x: x + w + 0.05, y: ay, w: 0.35, h: 0, line: cloneLine(C.red, 1) });
    addText(slide, annotation, { x: x + w + 0.48, y: ay - 0.14, w: 1.05, h: 0.35, fontSize: 7.5, bold: true, color: C.red, valign: "top" });
  });
}
