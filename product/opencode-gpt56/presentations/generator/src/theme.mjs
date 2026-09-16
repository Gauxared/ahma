export const DECK_META = Object.freeze({
  author: "7 КРАСНЫХ ЛИНИЙ",
  company: "7 КРАСНЫХ ЛИНИЙ",
  language: "ru-RU",
  subject: "СтройИнтеллект — система презентаций A+B",
  title: "7 КРАСНЫХ ЛИНИЙ — СтройИнтеллект",
});

const COLORS = Object.freeze({
  red: "FF0000",
  darkRed: "CC0000",
  white: "FFFFFF",
  black: "000000",
  text: "333333",
  secondary: "666666",
  caption: "999999",
  panel: "F5F5F5",
  divider: "E0E0E0",
});

export const THEME = Object.freeze({
  layoutName: "7KL_16_9",
  slide: Object.freeze({ width: 10, height: 5.625, ratio: "16:9" }),
  grid: Object.freeze({
    content: Object.freeze({ x: 0.5, y: 1.1, w: 9, h: 4, right: 9.5, bottom: 5.1 }),
    titleY: 0.35,
    titleH: 0.45,
    railWidth: 0.06,
    footerHeight: 0.3,
    gap: 0.24,
  }),
  colors: COLORS,
  font: Object.freeze({ family: "Montserrat", language: "ru-RU" }),
  spacing: Object.freeze({
    xxs: 0.06,
    xs: 0.1,
    sm: 0.16,
    md: 0.24,
    lg: 0.36,
    xl: 0.56,
    xxl: 0.82,
  }),
  type: Object.freeze({
    title: Object.freeze({ size: 20, bold: true, color: COLORS.black }),
    statement: Object.freeze({ size: 28, bold: true, color: COLORS.black }),
    hero: Object.freeze({ size: 44, bold: true, color: COLORS.black }),
    metric: Object.freeze({ size: 24, bold: true, color: COLORS.red }),
    body: Object.freeze({ size: 10.5, bold: false, color: COLORS.text, lineSpacingMultiple: 1.15 }),
    dense: Object.freeze({ size: 9.5, bold: false, color: COLORS.text, lineSpacingMultiple: 1.15 }),
    label: Object.freeze({ size: 8.5, bold: true, color: COLORS.secondary }),
    caption: Object.freeze({ size: 8, bold: false, color: COLORS.caption }),
    footer: Object.freeze({ size: 6, bold: true, color: COLORS.secondary }),
  }),
  line: Object.freeze({ thin: 0.75, regular: 1.1, emphasis: 2, chart: 1.6 }),
  icon: Object.freeze({ box: 0.3, size: 0.2, stroke: 1.25 }),
  chart: Object.freeze({
    axis: COLORS.divider,
    neutral: COLORS.caption,
    neutralDark: COLORS.secondary,
    accent: COLORS.red,
    labelSize: 8,
  }),
  shadow: Object.freeze({ type: "outer", blur: 3, offset: 1, angle: 135, color: COLORS.black, opacity: 0.06 }),
});

export const EVIDENCE_STATUS = Object.freeze({
  demonstrated: Object.freeze({ label: "Продемонстрировано", color: COLORS.black, fill: COLORS.panel }),
  project: Object.freeze({ label: "Зафиксировано проектом", color: COLORS.red, fill: COLORS.panel }),
  prototype: Object.freeze({ label: "Прототип", color: COLORS.secondary, fill: COLORS.panel }),
  pilot: Object.freeze({ label: "Требует пилота", color: COLORS.red, fill: COLORS.white }),
  roadmap: Object.freeze({ label: "План развития", color: COLORS.secondary, fill: COLORS.white }),
});

export function makeShadow() {
  return { ...THEME.shadow };
}

export function configureDeck(pptx, metadata = {}) {
  pptx.defineLayout({
    name: THEME.layoutName,
    width: THEME.slide.width,
    height: THEME.slide.height,
  });
  pptx.layout = THEME.layoutName;
  pptx.author = metadata.author ?? DECK_META.author;
  pptx.company = metadata.company ?? DECK_META.company;
  pptx.subject = metadata.subject ?? DECK_META.subject;
  pptx.title = metadata.title ?? DECK_META.title;
  pptx.lang = metadata.language ?? DECK_META.language;
  pptx.theme = {
    headFontFace: THEME.font.family,
    bodyFontFace: THEME.font.family,
    lang: THEME.font.language,
  };
  return pptx;
}
