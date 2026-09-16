import path from "node:path";
import { fileURLToPath } from "node:url";

import PptxGenJS from "pptxgenjs";

import {
  addCapabilityLayers,
  addCard,
  addChevronFlow,
  addComparison,
  addContactScene,
  addConstructionDocumentVisual,
  addDecisionRoomTitle,
  addEditorialStatement,
  addEvidenceBadge,
  addFooter,
  addInsightBar,
  addLineChart,
  addMetric,
  addPriceScene,
  addProgressRing,
  addRiskMatrix,
  addRiskRegister,
  addRoleMap,
  addSlideBase,
  addSourceNote,
  addTimeline,
  addWordmark,
} from "../components.mjs";
import { THEME, configureDeck, makeShadow } from "../theme.mjs";

const MODULE_PATH = fileURLToPath(import.meta.url);
const GENERATOR_DIRECTORY = path.dirname(path.dirname(path.dirname(MODULE_PATH)));
const GENERATED_DIRECTORY = path.resolve(GENERATOR_DIRECTORY, "../generated");

export const COMMERCIAL_OUTPUT_PATH = path.join(GENERATED_DIRECTORY, "01-stroyintellekt-commercial-universal.pptx");
export const COMMERCIAL_PDF_PATH = path.join(GENERATED_DIRECTORY, "01-stroyintellekt-commercial-universal.pdf");

const C = THEME.colors;
const G = THEME.grid;

const note = (source, evidence, limitation, owner = "Владелец продукта / руководитель проекта") =>
  `Источник: ${source}\nУровень доказательности: ${evidence}\nОграничение: ${limitation}\nВладелец проверки: ${owner}`;

export const COMMERCIAL_SLIDES = Object.freeze([
  { number: 1, key: "cover", title: "Проверить объект до договора, бюджета или оплаты", notes: note("Универсальное КП, продуктовый паспорт", "Целевой состав + продемонстрированная методология", "Программный контур требует пилота и приёмки") },
  { number: 2, key: "promise", title: "Руководитель получает один проверяемый пакет решения вместо набора несвязанных мнений", notes: note("Универсальное КП, разделы 1–2", "Целевой состав внедрения", "Система поддерживает решение и не заменяет специалистов") },
  { number: 3, key: "conflict", title: "Один объект часто существует сразу в четырёх версиях", notes: note("Клиентская презентация, слайд 2", "Методологический конфликт", "Различия иллюстративны и проверяются на документах заказчика") },
  { number: 4, key: "cost", title: "Разрыв между документами становится ценой, сроком и стоимостью денег", notes: note("GTM, раздел 3; универсальное КП, раздел 4.3", "Причинно-следственная модель", "Не является заявлением о реализованной экономии") },
  { number: 5, key: "category", title: "СтройИнтеллект — система поддержки решения, а не цифровая замена службы", notes: note("Продуктовый паспорт, разделы 1 и 11", "Утверждённое позиционирование", "Не заменяет экспертизу, проектировщика, юриста, сметчика и технического заказчика") },
  { number: 6, key: "before-after", title: "Рабочая модель меняется: от ручной сверки версий — к единому расчётному следу", notes: note("Универсальное КП, разделы 2 и 6", "Целевая операционная модель", "Фактическая модель подтверждается приёмкой") },
  { number: 7, key: "roles", title: "Каждая роль видит своё влияние на одно управленческое решение", notes: note("Универсальное КП, раздел 7", "Целевой результат по ролям", "Состав ролей уточняется индивидуальным проектом") },
  { number: 8, key: "modules", title: "Полный контур связывает документы, расчёты, компетенции и корпоративную память", notes: note("Универсальное КП, раздел 3; продуктовый паспорт, раздел 8", "Целевой модульный состав", "Глубокие расширения включаются только договором") },
  { number: 9, key: "sources", title: "Решение начинается с первичных документов, а не с готового вывода", notes: note("Продуктовый паспорт, раздел 8.2", "Зафиксированные типы источников", "Распознавание сканов не входит в базовую поставку") },
  { number: 10, key: "normalization", title: "Сравнение становится допустимым только после нормализации и подтверждения пользователем", notes: note("Универсальное КП, разделы 4.2 и 6", "Целевой процесс", "Неполные строки и спорные соответствия подтверждает пользователь") },
  { number: 11, key: "offers", title: "Сравнивать нужно одинаковый предмет работ, а не нижнюю строку предложения", notes: note("Клиентская презентация, слайд 6", "Иллюстративный пример", "Значения не относятся к конкретному клиенту") },
  { number: 12, key: "estimate", title: "Независимая оценка даёт диапазон только по заранее согласованной методике", notes: note("Универсальное КП, раздел 4.2; product truth, раздел 6", "Целевой контрактный scope", "Результат следует согласованной методике, согласованной иерархии источников, калибровке и протоколу точности на данных заказчика") },
  { number: 13, key: "calculation", title: "Арифметика отделена от интерпретации и оставляет воспроизводимый расчётный след", notes: note("Продуктовый паспорт, раздел 8.4", "Целевой расчётный модуль", "Production-сервис требует реализации и приёмки") },
  { number: 14, key: "competencies", title: "Девять функциональных компетенций собираются вокруг одного результата", notes: note("Универсальное КП, раздел 5", "Продемонстрированная методология + целевой scope", "Компетенции не означают замену девяти сотрудников") },
  { number: 15, key: "engineering", title: "Инженерия и сметы сначала проверяют физику, объёмы и основания цены", notes: note("Универсальное КП, разделы 4.1 и 5", "Продемонстрированная методология", "Результаты требуют проверки специалистами заказчика") },
  { number: 16, key: "procurement", title: "Снабжение и подряд раскрывают состав цены до переговоров", notes: note("Универсальное КП, разделы 4.2 и 5", "Целевой сравнительный контур", "Поиск новых подрядчиков является отдельно регулируемым процессом") },
  { number: 17, key: "economics", title: "Экономика переводит отклонение в рубли на метр, маржу и график денег", notes: note("Универсальное КП, раздел 4.3", "Целевые финансовые расчёты", "Цена продажи и спрос задаются заказчиком и не прогнозируются системой") },
  { number: 18, key: "governance-roles", title: "ПТО, юристы, руководитель проекта и администратор превращают находку в действие", notes: note("Универсальное КП, раздел 5", "Целевые функциональные зоны", "Юридически значимое решение остаётся за специалистами") },
  { number: 19, key: "workflow", title: "Один объект проходит сквозной маршрут от загрузки до проверяемой выгрузки", notes: note("Продуктовый паспорт, раздел 7", "Целевой сквозной процесс", "Автоматизированная оркестрация требует промышленной реализации") },
  { number: 20, key: "modes", title: "Режимы глубины работают через очередь, статусы и повторный запуск", notes: note("Продуктовый паспорт, раздел 7; product truth, раздел 7", "Контрактная цель", "Время зависит от состава документов и инфраструктуры; программная квота не равна производительности") },
  { number: 21, key: "outputs", title: "Четыре рабочих документа продолжают жить после интерфейса", notes: note("Универсальное КП, раздел 8", "Продемонстрированные форматы + целевой scope", "Состав и шаблоны утверждаются в проекте") },
  { number: 22, key: "proof", title: "Обезличенный методологический прогон связал проектную коллизию с закупочным риском", notes: note("Клиентская презентация, слайд 8; product truth, раздел 9", "Продемонстрированная методология", "Не показатель промышленной точности и не обещание экономии") },
  { number: 23, key: "maturity", title: "Методология продемонстрирована; промышленный контур должен доказать качество на пилоте", notes: note("Product truth, разделы 5–6", "Продемонстрировано / Требует пилота и приёмки", "Нельзя выдавать прототипы и целевую архитектуру за production-runtime") },
  { number: 24, key: "interface", title: "Интерфейс должен вести от объекта к решению, а не к новому набору файлов", notes: note("Универсальное КП, раздел 3", "Прототип целевых экранов", "Макет не является работающим веб-приложением") },
  { number: 25, key: "knowledge", title: "Корпоративная база становится активом только при сохранённом происхождении каждого значения", notes: note("Универсальное КП, раздел 4.5; продуктовый паспорт, раздел 8.6", "Целевой контур знаний", "Структура, актуальность и процесс подтверждения согласуются отдельно") },
  { number: 26, key: "contours", title: "Исходные данные остаются внутри; наружу выходят только разрешённые минимизированные сведения", notes: note("Универсальное КП, раздел 14", "Целевое состояние данных", "Внешние процессы запускаются только после регламента; передаваться могут только минимизированные и маскированные данные после проверки безопасности") },
  { number: 27, key: "security", title: "Локальное размещение, журнал и блокировка передачи образуют целевой контур доверия", notes: note("Универсальное КП, раздел 14; product truth, раздел 11", "Целевая архитектура", "Фактическая безопасность и эксплуатационные регламенты подтверждаются приёмкой") },
  { number: 28, key: "integrations", title: "Интеграция начинается со структурированных файлов и согласованного программного интерфейса", notes: note("Универсальное КП, раздел 14", "Контрактный scope с fallback", "Индивидуальная корпоративная система подключается при наличии документации, тестового контура и доступов") },
  { number: 29, key: "implementation", title: "Внедрение управляется этапами, артефактами и ответственными сторонами", notes: note("Универсальное КП, раздел 10", "Референсная этапность", "135 дней — пример прошлого предложения, а не универсальное обещание срока") },
  { number: 30, key: "acceptance", title: "Приёмка измеряет качество результата и готовность заказчика одновременно", notes: note("Универсальное КП, раздел 11; GTM, раздел 8", "Референсные критерии", "Порог независимой оценки определяется до итоговой приёмки") },
  { number: 31, key: "commercial", title: "Базовое корпоративное внедрение начинается от 20 млн ₽", notes: note("Клиентская презентация, слайд 11; решение владельца продукта", "Утверждённая минимальная рамка", "Диагностика — отдельное платное предложение. Доказательный пилот — отдельное платное предложение. Они не входят в базовое внедрение. Права использования, гарантия и сопровождение определяются индивидуально") },
  { number: 32, key: "contact", title: "Следующий шаг — выбрать один объект и решение, которое нельзя принимать вслепую", notes: note("Универсальное КП, раздел 15", "Конкретный призыв к действию", "Переход к диагностике оформляется отдельным предложением") },
]);

function tx(slide, text, x, y, w, h, options = {}) {
  slide.addText(text, {
    x, y, w, h, margin: 0, fontFace: THEME.font.family, lang: THEME.font.language,
    fontSize: 9.5, color: C.text, fit: "shrink", valign: "mid", breakLine: false,
    ...options,
  });
}

function box(slide, x, y, w, h, options = {}) {
  slide.addShape(options.shape ?? "rect", {
    x, y, w, h,
    fill: { color: options.fill ?? C.white, transparency: options.transparency ?? 0 },
    line: { color: options.line ?? C.divider, width: options.lineWidth ?? 0.7, transparency: options.lineTransparency ?? 0 },
    radius: options.radius,
    shadow: options.shadow ? makeShadow() : undefined,
  });
}

function line(slide, x, y, w, h, color = C.divider, width = 1, extra = {}) {
  slide.addShape("line", { x, y, w, h, line: { color, width, ...extra } });
}

function dot(slide, x, y, color = C.red, size = 0.1) {
  box(slide, x, y, size, size, { shape: "ellipse", fill: color, line: color, lineWidth: 0 });
}

function visibleSource(slide, slideData, status = "целевой состав") {
  addSourceNote(slide, { text: `Источник: ${slideData.notes.split("\n")[0].replace("Источник: ", "")}`, status });
}

function addNotes(slide, slideData) {
  if (typeof slide.addNotes === "function") slide.addNotes(slideData.notes);
}

function addCover(slide) {
  slide.background = { color: C.white };
  addWordmark(slide, { x: 0.52, y: 2.57, w: 3.35, h: 0.34, size: 17, align: "center" });
  line(slide, 4.18, 0.72, 0, 4.15, C.divider, 1);
  tx(slide, "ЦИФРОВАЯ СЛУЖБА ТЕХНИЧЕСКОГО ЗАКАЗЧИКА", 4.62, 0.78, 4.6, 0.28, { fontSize: 8.2, bold: true, color: C.red, charSpacing: 1.25 });
  tx(slide, "Проверьте объект до того, как расхождение станет договором, оплатой или кассовым разрывом", 4.62, 1.28, 4.55, 1.65, { fontSize: 23.5, bold: true, color: C.black, valign: "top" });
  tx(slide, "Корпоративная система поддержки финансово-технических решений для девелопера и застройщика", 4.64, 3.15, 4.2, 0.52, { fontSize: 10.2, color: C.secondary, valign: "top" });
  const metrics = [["1 объект", "минимальный предмет"], ["9 компетенций", "единый вывод"], ["4 документа", "Excel и Word"], ["от 20 млн ₽", "базовое внедрение"]];
  metrics.forEach(([value, label], index) => {
    const x = 4.62 + index * 1.17;
    box(slide, x, 4.08, 1.03, 0.84, { fill: C.panel, line: C.panel });
    tx(slide, value, x + 0.08, 4.2, 0.87, 0.22, { fontSize: index === 3 ? 13 : 11.5, bold: true, color: index === 3 ? C.red : C.black, align: "center" });
    tx(slide, label, x + 0.06, 4.57, 0.91, 0.15, { fontSize: 6.7, color: C.secondary, align: "center" });
  });
  tx(slide, "Методология и рабочие Word/Excel-артефакты продемонстрированы. Программный контур подтверждается пилотом и приёмкой.", 4.64, 5.17, 4.45, 0.24, { fontSize: 7.1, color: C.caption });
}

function addPromise(slide) {
  addEditorialStatement(slide, { eyebrow: "Исполнительный вывод", statement: "Один пакет решения показывает, где расходятся документы, сколько может стоить отклонение и что закрыть до подписания", support: "Смета, ведомость объёмов, предложения подрядчиков, договор и модель финансирования соединяются через источники, формулы и явные статусы данных.", metric: "1", metricLabel: "объект → один проверяемый материал для руководителя, строительства и финансов", page: 2 });
  addEvidenceBadge(slide, { x: 7.18, y: 4.25, status: "project", label: "Целевой состав" });
}

function addConflict(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[2].title, page: 3 });
  const items = [
    ["ПРОЕКТ И ВЕДОМОСТИ", "объёмы · состав · комплектность"],
    ["СМЕТА", "коэффициенты · расценки · двойной учёт"],
    ["ПРЕДЛОЖЕНИЯ", "единицы · исключения · доставка"],
    ["ФИНАНСОВАЯ МОДЕЛЬ", "₽/м² · кредит · эскроу · срок"],
  ];
  items.forEach(([title, body], index) => {
    const y = 1.22 + index * 0.82;
    const w = 5.5 - index * 0.34;
    box(slide, 0.55 + index * 0.16, y, w, 0.58, { fill: index === 3 ? C.white : C.panel, line: index === 3 ? C.red : C.divider, lineWidth: index === 3 ? 1.1 : 0.6 });
    tx(slide, title, 0.75 + index * 0.16, y + 0.12, 1.75, 0.16, { fontSize: 8, bold: true, color: index === 3 ? C.red : C.black });
    tx(slide, body, 2.35 + index * 0.16, y + 0.1, w - 2.0, 0.2, { fontSize: 8.4, color: C.secondary });
    line(slide, 6.02, y + 0.29, 0.72, 1.62 - index * 0.54, index === 2 ? C.red : C.divider, index === 2 ? 1.6 : 0.9, { endArrowType: "triangle" });
  });
  box(slide, 7.08, 2.02, 2.0, 1.32, { fill: C.red, line: C.red });
  tx(slide, "УПРАВЛЕНЧЕСКОЕ\nРЕШЕНИЕ", 7.35, 2.32, 1.46, 0.54, { fontSize: 13.5, bold: true, color: C.white, align: "center" });
  tx(slide, "Итоговая сумма не доказывает, что сравнивается один предмет работ.", 6.63, 3.76, 2.82, 0.62, { fontSize: 12, bold: true, color: C.black, align: "right", valign: "top" });
  visibleSource(slide, COMMERCIAL_SLIDES[2], "методологический конфликт");
}

function addCost(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[3].title, page: 4 });
  const nodes = [
    ["Техническая дельта", "объём / состав"], ["Договорная цена", "условия и доплаты"], ["Себестоимость", "рубли на метр"],
    ["Финансирование", "график выборки"], ["Маржа и разрыв", "сценарии денег"], ["Решение", "подписать / изменить / запросить"],
  ];
  line(slide, 0.85, 2.28, 8.05, 0, C.red, 2.2);
  nodes.forEach(([title, body], index) => {
    const x = 0.52 + index * 1.5;
    box(slide, x + 0.5, 2.07, 0.42, 0.42, { shape: "ellipse", fill: index === 5 ? C.red : C.white, line: C.red, lineWidth: 1.4 });
    tx(slide, String(index + 1), x + 0.59, 2.17, 0.24, 0.1, { fontSize: 7.5, bold: true, color: index === 5 ? C.white : C.red, align: "center" });
    tx(slide, title, x, 1.22 + (index % 2) * 2.15, 1.42, 0.34, { fontSize: 9.2, bold: true, color: index === 5 ? C.red : C.black, align: "center" });
    tx(slide, body, x, 1.62 + (index % 2) * 2.15, 1.42, 0.36, { fontSize: 7.4, color: C.secondary, align: "center", valign: "top" });
    line(slide, x + 0.71, index % 2 ? 2.5 : 1.98, 0, index % 2 ? 0.75 : -0.28, C.divider, 0.8);
  });
  addInsightBar(slide, { y: 4.55, text: "Ценность проверки появляется только тогда, когда технический вывод доведён до управленческого действия." });
}

function addCategory(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[4].title, page: 5 });
  addComparison(slide, {
    y: 1.24, h: 3.35,
    left: { title: "НЕ ЯВЛЯЕТСЯ", items: ["автономным лицом, принимающим решения", "строительной или юридической экспертизой", "заменой проектировщика, сметчика или юриста", "системой визуального контроля площадки", "гарантией экономии или отсутствия ошибок"] },
    right: { title: "ЯВЛЯЕТСЯ", items: ["корпоративной системой поддержки решения", "контуром сопоставления документов и предложений", "расчётным следом для экономики объекта", "рабочей средой для девяти компетенций", "источником проверяемых Excel/Word-результатов"] },
  });
  tx(slide, "Система не заменяет специалистов: ответственность за техническое, юридическое и управленческое решение остаётся у людей.", 1.05, 4.72, 7.9, 0.2, { fontSize: 7.8, bold: true, color: C.black, align: "center" });
  visibleSource(slide, COMMERCIAL_SLIDES[4], "утверждённое позиционирование");
}

function addBeforeAfter(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[5].title, page: 6 });
  addComparison(slide, {
    y: 1.2, h: 3.2,
    left: { title: "ДО: РАЗРОЗНЕННЫЕ ВЕРСИИ", items: ["файлы и переписка по подразделениям", "сравнение итогов без единого состава", "формулы и допущения живут отдельно", "история объекта теряется между итерациями", "решение собирается вручную перед комитетом"] },
    right: { title: "ПОСЛЕ: ЕДИНЫЙ СЛЕД", items: ["карточка объекта и подтверждённые входы", "нормализация перед сравнением", "отдельный детерминированный расчёт", "источник и статус каждого числа", "единый свод по бюджету, рискам и действиям"] },
  });
  addChevronFlow(slide, { x: 1.25, y: 4.55, w: 7.5, h: 0.35, items: ["документ", "позиция", "формула", "вывод", "решение"] });
}

function addRoles(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[6].title, page: 7 });
  addRoleMap(slide, {
    x: 0.58, y: 1.18, w: 8.85, h: 3.5, center: "Единый пакет\nрешения",
    roles: [
      { title: "Собственник / директор", note: "риск и условия продолжения", critical: true },
      { title: "Финансовый директор", note: "маржа, БДДС, стоимость денег" },
      { title: "Директор по строительству", note: "объёмы, подрядчики, сроки" },
      { title: "Технический заказчик", note: "единый стандарт проверки" },
      { title: "Сметы и закупки", note: "строки, цены, сопоставимость" },
      { title: "ИТ и безопасность", note: "контур, журнал, регламент" },
    ],
  });
  visibleSource(slide, COMMERCIAL_SLIDES[6], "целевой результат по ролям");
}

function addModules(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[7].title, page: 8 });
  const groups = [
    ["01", "РАБОЧАЯ СРЕДА", ["объекты и документы", "очередь и журнал", "выгрузки"]],
    ["02", "ДАННЫЕ", ["разбор документов", "собственная база", "каналы получения"]],
    ["03", "РЕШЕНИЕ", ["сопоставление КП", "независимая оценка", "расчётный модуль"]],
    ["04", "КОНТРОЛЬ", ["9 компетенций", "опорная база", "маскирование"]],
  ];
  groups.forEach(([num, title, items], index) => {
    const x = 0.5 + index * 2.3;
    const y = 1.24 + (index % 2) * 0.38;
    box(slide, x, y, 2.08, 3.08 - (index % 2) * 0.38, { fill: index === 2 ? C.white : C.panel, line: index === 2 ? C.red : C.divider, lineWidth: index === 2 ? 1.2 : 0.6, shadow: true });
    tx(slide, num, x + 0.16, y + 0.16, 0.38, 0.2, { fontSize: 9, bold: true, color: C.red });
    tx(slide, title, x + 0.16, y + 0.56, 1.72, 0.28, { fontSize: 10.3, bold: true, color: C.black });
    items.forEach((item, itemIndex) => {
      dot(slide, x + 0.18, y + 1.18 + itemIndex * 0.55, itemIndex === 1 && index === 2 ? C.red : C.black, 0.08);
      tx(slide, item, x + 0.38, y + 1.1 + itemIndex * 0.55, 1.48, 0.28, { fontSize: 8.4, bold: itemIndex === 1 && index === 2 });
    });
  });
  addInsightBar(slide, { y: 4.65, h: 0.38, text: "Модули не продаются как набор экранов: они образуют проверяемый маршрут от источника до решения." });
}

function addSources(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[8].title, page: 9 });
  const docs = [
    ["СМЕТА", "Excel / XML", "позиции · коэффициенты · итоги"], ["ВЕДОМОСТЬ", "Excel / CSV", "объёмы · единицы · разделы"],
    ["ПРЕДЛОЖЕНИЯ", "Excel / Word / PDF", "состав · цены · исключения"], ["ДОГОВОР", "Word / PDF", "аванс · удержания · гарантии"],
    ["ФИНАНСИРОВАНИЕ", "структурированные параметры", "кредит · график · площадь"],
  ];
  docs.forEach(([title, type, body], index) => {
    const x = 0.62 + index * 1.54;
    const y = 1.28 + (index % 2) * 0.27;
    box(slide, x, y, 1.38, 2.42, { fill: C.white, line: index === 2 ? C.red : C.divider, lineWidth: index === 2 ? 1.2 : 0.7, shadow: true });
    box(slide, x + 0.12, y + 0.14, 0.28, 0.28, { fill: C.red, line: C.red });
    tx(slide, String(index + 1).padStart(2, "0"), x + 0.17, y + 0.22, 0.18, 0.1, { fontSize: 6.5, bold: true, color: C.white, align: "center" });
    tx(slide, title, x + 0.12, y + 0.62, 1.12, 0.42, { fontSize: 9.2, bold: true, color: C.black, valign: "top" });
    tx(slide, type, x + 0.12, y + 1.16, 1.12, 0.28, { fontSize: 7.3, bold: true, color: C.red });
    line(slide, x + 0.12, y + 1.56, 1.12, 0, C.divider, 0.7);
    tx(slide, body, x + 0.12, y + 1.74, 1.12, 0.42, { fontSize: 7.5, color: C.secondary, valign: "top" });
  });
  box(slide, 8.5, 1.55, 0.72, 2.42, { fill: C.black, line: C.black });
  tx(slide, "ПОДТВЕРЖДЁННЫЕ\nВХОДЫ", 8.62, 2.02, 0.48, 1.25, { fontSize: 8.2, bold: true, color: C.white, align: "center", rotate: 270 });
  tx(slide, "Сканы без текстового слоя требуют отдельного контура распознавания.", 0.62, 4.33, 4.4, 0.28, { fontSize: 8.2, color: C.caption });
  visibleSource(slide, COMMERCIAL_SLIDES[8], "зафиксированные источники");
}

function addNormalization(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[9].title, page: 10 });
  const stages = [
    ["ИСХОДНАЯ СТРОКА", "Насос. компл. 2 шт.", C.panel], ["ИЗВЛЕЧЕНИЕ", "наименование · ед. · объём", C.white],
    ["НОРМАЛИЗАЦИЯ", "насосный комплект / штука / 2", C.white], ["ПОДТВЕРЖДЕНИЕ", "пользователь принимает или исправляет", C.red],
  ];
  stages.forEach(([label, body, accent], index) => {
    const x = 0.56 + index * 2.22;
    box(slide, x, 1.5, 1.88, 1.42, { fill: accent === C.red ? C.red : accent, line: accent === C.red ? C.red : index === 2 ? C.red : C.divider, lineWidth: index === 2 ? 1.1 : 0.7 });
    tx(slide, label, x + 0.15, 1.68, 1.58, 0.22, { fontSize: 7.6, bold: true, color: accent === C.red ? C.white : index === 2 ? C.red : C.secondary });
    tx(slide, body, x + 0.15, 2.1, 1.58, 0.48, { fontSize: 9.2, bold: true, color: accent === C.red ? C.white : C.black, valign: "top" });
    if (index < 3) line(slide, x + 1.9, 2.2, 0.3, 0, C.red, 1.4, { endArrowType: "triangle" });
  });
  box(slide, 1.3, 3.48, 7.4, 0.92, { fill: C.panel, line: C.panel });
  const checks = ["спорная единица", "неполная строка", "несопоставимый состав", "нет источника"]; 
  checks.forEach((item, index) => {
    const x = 1.55 + index * 1.76;
    dot(slide, x, 3.87, index === 2 ? C.red : C.black, 0.09);
    tx(slide, item, x + 0.2, 3.75, 1.34, 0.32, { fontSize: 8.2, bold: index === 2 });
  });
  addInsightBar(slide, { y: 4.6, h: 0.38, text: "Неуверенность не скрывается: проблемная строка возвращается пользователю до расчёта." });
}

function addOffers(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[10].title, page: 11 });
  const columns = ["ПОЗИЦИЯ", "ПРЕДЛОЖЕНИЕ 1", "ПРЕДЛОЖЕНИЕ 2", "ПРЕДЛОЖЕНИЕ 3", "ВЫВОД"];
  const rows = [
    ["Основные работы", "включены", "включены", "частично", "нормализовать"],
    ["Материалы", "включены", "часть исключена", "включены", "состав различается"],
    ["Доставка", "включена", "отдельно", "не указана", "итог не сравнивать"],
    ["Пусконаладка", "включена", "включена", "отсутствует", "риск доплаты"],
  ];
  const widths = [1.75, 1.55, 1.55, 1.55, 2.55];
  let x = 0.5;
  columns.forEach((header, index) => {
    box(slide, x, 1.25, widths[index], 0.48, { fill: C.black, line: C.white, lineWidth: 0.6 });
    tx(slide, header, x + 0.08, 1.4, widths[index] - 0.16, 0.14, { fontSize: 7.2, bold: true, color: C.white, align: index ? "center" : "left" });
    x += widths[index];
  });
  rows.forEach((row, rowIndex) => {
    let cx = 0.5;
    row.forEach((cell, cellIndex) => {
      const critical = ["частично", "часть исключена", "отдельно", "не указана", "отсутствует"].includes(cell);
      box(slide, cx, 1.73 + rowIndex * 0.62, widths[cellIndex], 0.62, { fill: rowIndex % 2 ? C.white : C.panel, line: C.divider, lineWidth: 0.5 });
      tx(slide, cell, cx + 0.08, 1.91 + rowIndex * 0.62, widths[cellIndex] - 0.16, 0.2, { fontSize: 7.8, bold: cellIndex === 0 || critical || cellIndex === 4, color: critical ? C.red : cellIndex === 4 ? C.black : C.secondary, align: cellIndex > 0 && cellIndex < 4 ? "center" : "left" });
      cx += widths[cellIndex];
    });
  });
  addInsightBar(slide, { y: 4.42, text: "Сначала раскрывается комплектация; только затем считаются минимум, максимум, медиана и разброс." });
  tx(slide, "Иллюстративный пример — не данные конкретного клиента", 6.35, 4.98, 3.1, 0.12, { fontSize: 7, color: C.caption, align: "right" });
}

function addEstimate(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[11].title, page: 12 });
  tx(slide, "РАСЧЁТНЫЙ ДИАПАЗОН", 0.58, 1.32, 2.2, 0.2, { fontSize: 8, bold: true, color: C.red, charSpacing: 1 });
  line(slide, 0.85, 2.35, 5.75, 0, C.black, 1.2);
  const points = [[1.1, "НИЖНЯЯ ГРАНИЦА", "подтверждённые минимумы"], [3.45, "БАЗОВАЯ ОЦЕНКА", "согласованный сценарий"], [5.9, "ВЕРХНЯЯ ГРАНИЦА", "риски и неопределённость"]];
  points.forEach(([px, label, sub], index) => {
    const x = 0.58 + px;
    line(slide, x, 2.08, 0, 0.54, index === 1 ? C.red : C.black, index === 1 ? 2.2 : 1.2);
    tx(slide, label, x - 0.72, 2.75, 1.44, 0.22, { fontSize: 7.6, bold: true, color: index === 1 ? C.red : C.black, align: "center" });
    tx(slide, sub, x - 0.75, 3.1, 1.5, 0.36, { fontSize: 7.2, color: C.secondary, align: "center", valign: "top" });
  });
  const constraints = [
    ["1", "Методика", "правила нормализации и расчёта"], ["2", "Иерархия источников", "что важнее при конфликте данных"],
    ["3", "Калибровка", "исторические и контрольные объекты"], ["4", "Протокол точности", "порог, допуск и порядок приёмки"],
  ];
  constraints.forEach(([n, title, body], index) => {
    const y = 1.27 + index * 0.83;
    box(slide, 7.1, y, 2.32, 0.66, { fill: index === 3 ? C.white : C.panel, line: index === 3 ? C.red : C.panel, lineWidth: index === 3 ? 1.1 : 0 });
    tx(slide, n, 7.25, y + 0.2, 0.24, 0.15, { fontSize: 8, bold: true, color: C.red });
    tx(slide, title, 7.62, y + 0.1, 1.56, 0.18, { fontSize: 8.8, bold: true, color: C.black });
    tx(slide, body, 7.62, y + 0.34, 1.56, 0.2, { fontSize: 7.1, color: C.secondary });
  });
  addInsightBar(slide, { y: 4.57, h: 0.4, text: "Без этих четырёх соглашений диапазон не используется как критерий приёмки." });
}

function addCalculation(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[12].title, page: 13 });
  const trace = [
    ["ИСТОЧНИК", "ВОР · строка 184"], ["ВХОД", "125 м² × 3 840 ₽"], ["ФОРМУЛА", "объём × цена"], ["РЕЗУЛЬТАТ", "480 000 ₽"], ["ВЛИЯНИЕ", "+ 320 ₽/м²"],
  ];
  trace.forEach(([label, value], index) => {
    const x = 0.55 + index * 1.78;
    box(slide, x, 1.62 + (index % 2) * 0.3, 1.5, 1.32, { fill: index === 3 ? C.red : index % 2 ? C.white : C.panel, line: index === 3 ? C.red : index === 2 ? C.black : C.divider, lineWidth: index === 2 ? 1.1 : 0.7 });
    tx(slide, label, x + 0.15, 1.82 + (index % 2) * 0.3, 1.2, 0.18, { fontSize: 7.4, bold: true, color: index === 3 ? C.white : index === 2 ? C.red : C.secondary });
    tx(slide, value, x + 0.15, 2.24 + (index % 2) * 0.3, 1.2, 0.38, { fontSize: 10.2, bold: true, color: index === 3 ? C.white : C.black, align: "center" });
    if (index < 4) line(slide, x + 1.52, 2.44, 0.25, (index % 2 ? -0.3 : 0.3), C.red, 1.3, { endArrowType: "triangle" });
  });
  const formulas = ["сходимость разделов", "минимум / максимум / медиана", "себестоимость и ₽/м²", "БДДС и кассовые разрывы", "проценты и график кредита"];
  box(slide, 0.75, 3.65, 8.5, 0.68, { fill: C.black, line: C.black });
  formulas.forEach((formula, index) => {
    tx(slide, formula, 0.95 + index * 1.65, 3.88, 1.45, 0.18, { fontSize: 7.5, bold: true, color: index === 2 ? C.red : C.white, align: "center" });
  });
  visibleSource(slide, COMMERCIAL_SLIDES[12], "целевой расчётный модуль");
}

function addCompetencies(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[13].title, page: 14 });
  const groups = [
    ["ТЕХНИЧЕСКИЙ КОНТУР", ["ГИП", "Сметчик"], 0.62, 1.26],
    ["КОММЕРЧЕСКИЙ КОНТУР", ["Снабжение", "Подряд"], 6.88, 1.26],
    ["ФИНАНСОВЫЙ КОНТУР", ["Экономист"], 0.62, 3.38],
    ["УПРАВЛЕНЧЕСКИЙ КОНТУР", ["ПТО", "Юрист", "Руководитель проекта", "Администратор"], 6.88, 3.15],
  ];
  groups.forEach(([label, roles, x, y], groupIndex) => {
    const h = roles.length > 2 ? 1.48 : 1.12;
    box(slide, x, y, 2.45, h, { fill: groupIndex === 1 ? C.white : C.panel, line: groupIndex === 1 ? C.red : C.divider, lineWidth: groupIndex === 1 ? 1.1 : 0.6 });
    tx(slide, label, x + 0.16, y + 0.16, 2.13, 0.18, { fontSize: 7.5, bold: true, color: groupIndex === 1 ? C.red : C.secondary });
    roles.forEach((role, index) => tx(slide, role, x + 0.17 + (index % 2) * 1.08, y + 0.53 + Math.floor(index / 2) * 0.42, 0.98, 0.2, { fontSize: 8.5, bold: true, color: C.black }));
    line(slide, x < 3 ? x + 2.45 : 6.1, y + h / 2, x < 3 ? 1.4 : 0.78, 2.76 - (y + h / 2), groupIndex === 1 ? C.red : C.divider, groupIndex === 1 ? 1.3 : 0.8);
  });
  box(slide, 3.85, 2.05, 2.25, 1.42, { shape: "ellipse", fill: C.white, line: C.red, lineWidth: 1.5 });
  tx(slide, "БЮДЖЕТ · МАРЖА\nРИСКИ · ДЕЙСТВИЯ", 4.2, 2.44, 1.55, 0.48, { fontSize: 11, bold: true, color: C.black, align: "center" });
  tx(slide, "Функциональные зоны анализа — не обещание заменить соответствующих сотрудников.", 2.05, 4.76, 5.9, 0.18, { fontSize: 7.6, color: C.caption, align: "center" });
}

function addEngineering(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[14].title, page: 15 });
  addConstructionDocumentVisual(slide, { x: 0.72, y: 1.3, w: 2.1, h: 2.95, annotations: ["нет основания", "двойной учёт", "коэффициент"] });
  const stages = [
    ["ГИП", "параметры · комплектность · подтверждение работ"], ["СМЕТЧИК", "сходимость · объёмы · расценки · отклонения"], ["РЕЗУЛЬТАТ", "реестр вопросов и денежное влияние"],
  ];
  stages.forEach(([label, body], index) => {
    const y = 1.33 + index * 1.02;
    box(slide, 4.4, y, 4.65, 0.74, { fill: index === 2 ? C.red : index % 2 ? C.white : C.panel, line: index === 2 ? C.red : C.divider, lineWidth: index === 1 ? 1.0 : 0.6 });
    tx(slide, label, 4.62, y + 0.16, 1.02, 0.2, { fontSize: 8, bold: true, color: index === 2 ? C.white : C.red });
    tx(slide, body, 5.75, y + 0.12, 3.05, 0.36, { fontSize: 9.2, bold: index === 2, color: index === 2 ? C.white : C.black });
    if (index < 2) line(slide, 6.7, y + 0.74, 0, 0.28, C.red, 1.2, { endArrowType: "triangle" });
  });
  addInsightBar(slide, { y: 4.55, h: 0.4, text: "Сначала подтверждается физика объекта; только затем денежный вывод становится пригодным для переговоров." });
}

function addProcurement(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[15].title, page: 16 });
  const suppliers = [
    ["ПРЕДЛОЖЕНИЕ 1", ["материалы включены", "доставка включена", "пусконаладка включена"], "полный состав"],
    ["ПРЕДЛОЖЕНИЕ 2", ["материалы частично", "доставка отдельно", "пусконаладка включена"], "нужна корректировка"],
    ["ПРЕДЛОЖЕНИЕ 3", ["материалы включены", "доставка не указана", "пусконаладка отсутствует"], "риск доплаты"],
  ];
  suppliers.forEach(([title, items, result], index) => {
    const x = 0.55 + index * 2.35;
    box(slide, x, 1.28 + index * 0.15, 2.05, 2.86, { fill: index === 1 ? C.white : C.panel, line: index === 1 ? C.red : C.divider, lineWidth: index === 1 ? 1.1 : 0.6 });
    tx(slide, title, x + 0.16, 1.51 + index * 0.15, 1.73, 0.22, { fontSize: 8.2, bold: true, color: index === 1 ? C.red : C.black });
    items.forEach((item, itemIndex) => {
      const critical = /частично|отдельно|не указана|отсутствует/.test(item);
      dot(slide, x + 0.18, 2.11 + index * 0.15 + itemIndex * 0.48, critical ? C.red : C.black, 0.08);
      tx(slide, item, x + 0.38, 2.01 + index * 0.15 + itemIndex * 0.48, 1.4, 0.25, { fontSize: 8, bold: critical, color: critical ? C.red : C.secondary });
    });
    line(slide, x + 0.16, 3.5 + index * 0.15, 1.73, 0, C.divider, 0.7);
    tx(slide, result, x + 0.16, 3.72 + index * 0.15, 1.73, 0.22, { fontSize: 8.4, bold: true, color: index === 2 ? C.red : C.black, align: "center" });
  });
  line(slide, 7.7, 2.52, 0.45, 0, C.red, 1.5, { endArrowType: "triangle" });
  box(slide, 8.25, 1.57, 1.17, 1.95, { fill: C.red, line: C.red });
  tx(slide, "ЕДИНЫЙ\nПРЕДМЕТ\nПЕРЕГОВОРОВ", 8.42, 2.03, 0.83, 0.85, { fontSize: 10.3, bold: true, color: C.white, align: "center" });
  tx(slide, "Внешний поиск подрядчиков — отдельный регулируемый процесс, не автоматическая часть каждого проекта.", 7.74, 3.83, 1.65, 0.56, { fontSize: 7.3, color: C.caption, align: "right", valign: "top" });
  visibleSource(slide, COMMERCIAL_SLIDES[15], "целевой сравнительный контур");
}

function addEconomics(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[16].title, page: 17 });
  addLineChart(slide, {
    x: 0.58, y: 1.35, w: 5.55, h: 2.75, unit: " млн ₽", labels: ["М1", "М3", "М6", "М9", "М12"],
    series: [
      { label: "План", values: [12, 28, 51, 76, 92] },
      { label: "Сценарий отклонения", values: [12, 33, 60, 88, 109], accent: true },
    ],
  });
  const metrics = [["₽/м²", "полная себестоимость"], ["3 сценария", "модельной маржи"], ["БДДС", "помесячный график"], ["Кредит", "стоимость и выборка"]];
  metrics.forEach(([value, label], index) => addMetric(slide, { x: 6.45 + (index % 2) * 1.47, y: 1.3 + Math.floor(index / 2) * 1.42, w: 1.3, h: 1.16, value, label, fill: index === 0 ? C.white : C.panel, align: "center" }));
  addInsightBar(slide, { y: 4.48, text: "Иллюстративная линия показывает механику влияния, а не прогноз конкретного объекта." });
  tx(slide, "Цена продажи и прогноз спроса задаются заказчиком как входные параметры.", 5.98, 4.98, 3.45, 0.12, { fontSize: 7, color: C.caption, align: "right" });
}

function addGovernanceRoles(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[17].title, page: 18 });
  const lanes = [
    ["ПТО", "расхождения по исполнительным данным", "финансовое влияние"], ["ЮРИСТ", "аванс · удержания · штрафы · гарантии", "варианты урегулирования"],
    ["РУКОВОДИТЕЛЬ ПРОЕКТА", "свод компетенций и экономика", "приоритетные меры"], ["АДМИНИСТРАТОР", "вопросы · ответственные · даты", "контур исполнения"],
  ];
  lanes.forEach(([role, input, output], index) => {
    const y = 1.2 + index * 0.85;
    tx(slide, role, 0.6, y + 0.2, 1.65, 0.2, { fontSize: 8.2, bold: true, color: index === 2 ? C.red : C.black });
    box(slide, 2.32, y, 2.63, 0.62, { fill: index % 2 ? C.white : C.panel, line: C.divider });
    tx(slide, input, 2.52, y + 0.18, 2.23, 0.2, { fontSize: 8.1, color: C.secondary });
    line(slide, 5.08, y + 0.31, 0.62, 0, index === 2 ? C.red : C.divider, index === 2 ? 1.4 : 0.9, { endArrowType: "triangle" });
    box(slide, 5.83, y, 3.54, 0.62, { fill: index === 2 ? C.red : C.white, line: index === 2 ? C.red : C.divider });
    tx(slide, output, 6.05, y + 0.18, 3.1, 0.2, { fontSize: 8.7, bold: true, color: index === 2 ? C.white : C.black });
  });
  addInsightBar(slide, { y: 4.63, h: 0.37, text: "Находка становится управляемой, когда назначены действие, владелец и контрольная дата." });
}

function addWorkflow(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[18].title, page: 19 });
  const steps = ["Объект и документы", "Извлечение", "Подтверждение", "Расчёты", "Сопоставление", "9 компетенций", "Свод решения", "Excel / Word / журнал"];
  steps.forEach((step, index) => {
    const row = index < 4 ? 0 : 1;
    const col = row === 0 ? index : 7 - index;
    const x = 0.58 + col * 2.19;
    const y = 1.22 + row * 1.72;
    box(slide, x, y, 1.83, 1.02, { fill: index === 7 ? C.red : index % 2 ? C.white : C.panel, line: index === 7 ? C.red : index === 3 ? C.black : C.divider, lineWidth: index === 3 ? 1.0 : 0.6 });
    tx(slide, String(index + 1).padStart(2, "0"), x + 0.14, y + 0.13, 0.25, 0.16, { fontSize: 7, bold: true, color: index === 7 ? C.white : C.red });
    tx(slide, step, x + 0.14, y + 0.45, 1.55, 0.36, { fontSize: 8.8, bold: true, color: index === 7 ? C.white : C.black, align: "center" });
    if (index < 3) line(slide, x + 1.84, y + 0.51, 0.34, 0, C.red, 1.2, { endArrowType: "triangle" });
    if (index === 3) line(slide, x + 0.92, y + 1.03, 0, 0.66, C.red, 1.2, { endArrowType: "triangle" });
    if (index >= 4 && index < 7) line(slide, x - 0.35, y + 0.51, 0.34, 0, C.red, 1.2, { beginArrowType: "triangle" });
  });
  tx(slide, "Результат сохраняется в карточке объекта и может быть повторно запущен без повторной загрузки.", 1.42, 4.62, 7.2, 0.18, { fontSize: 8, color: C.caption, align: "center" });
}

function addModes(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[19].title, page: 20 });
  const modes = [["ЭКСПРЕСС", "до 15 минут*", "быстрая проверка ключевых рисков"], ["СТАНДАРТ", "до 1 часа*", "полный согласованный контур"], ["ЭКСПЕРТ", "до 5 часов*", "углублённая межфункциональная проверка"]];
  modes.forEach(([title, time, body], index) => {
    const x = 0.55 + index * 2.15;
    box(slide, x, 1.22, 1.9, 1.65, { fill: index === 1 ? C.white : C.panel, line: index === 1 ? C.red : C.divider, lineWidth: index === 1 ? 1.1 : 0.6 });
    tx(slide, title, x + 0.15, 1.43, 1.6, 0.2, { fontSize: 8.4, bold: true, color: index === 1 ? C.red : C.black, align: "center" });
    tx(slide, time, x + 0.15, 1.86, 1.6, 0.32, { fontSize: 15, bold: true, color: C.red, align: "center" });
    tx(slide, body, x + 0.16, 2.34, 1.58, 0.3, { fontSize: 7.4, color: C.secondary, align: "center", valign: "top" });
  });
  const statuses = ["в очереди", "выполняется", "завершена", "ошибка", "повторный запуск"];
  tx(slide, "ОЧЕРЕДЬ И СТАТУСЫ", 7.28, 1.2, 2.1, 0.2, { fontSize: 8, bold: true, color: C.red });
  statuses.forEach((status, index) => {
    const y = 1.58 + index * 0.55;
    box(slide, 7.25, y, 2.15, 0.38, { fill: index === 1 ? C.red : index % 2 ? C.white : C.panel, line: index === 1 ? C.red : C.divider, lineWidth: 0.6 });
    tx(slide, status, 7.45, y + 0.11, 1.72, 0.13, { fontSize: 7.8, bold: true, color: index === 1 ? C.white : C.black });
  });
  tx(slide, "* Референсная целевая глубина. Фактическое время зависит от документов, моделей и инфраструктуры.", 0.56, 4.37, 6.1, 0.25, { fontSize: 7.2, color: C.caption });
  addInsightBar(slide, { y: 4.65, h: 0.36, text: "Отсутствие программной квоты не означает неограниченную производительность оборудования." });
}

function addOutputs(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[20].title, page: 21 });
  const docs = [
    ["СРАВНЕНИЕ ПРЕДЛОЖЕНИЙ", "Excel", "переговоры", "состав · цены · аномалии"], ["РЕЕСТР ОТКЛОНЕНИЙ", "Excel", "урегулирование", "позиция · сумма · основание"],
    ["РАСЧЁТ", "Excel", "проверка", "входы · формулы · сценарии"], ["АНАЛИТИЧЕСКАЯ ЗАПИСКА", "Word", "решение", "выводы · риски · меры"],
  ];
  docs.forEach(([title, format, action, proof], index) => {
    const x = 0.72 + index * 2.06;
    const y = 1.24 + index * 0.13;
    box(slide, x, y, 1.78, 2.95, { fill: C.white, line: index === 3 ? C.red : C.divider, lineWidth: index === 3 ? 1.2 : 0.7, shadow: true });
    box(slide, x + 0.13, y + 0.15, 0.34, 0.34, { fill: C.red, line: C.red });
    tx(slide, format, x + 0.18, y + 0.26, 0.24, 0.09, { fontSize: 5.7, bold: true, color: C.white, align: "center" });
    tx(slide, title, x + 0.13, y + 0.72, 1.52, 0.58, { fontSize: 9.1, bold: true, color: C.black, valign: "top" });
    line(slide, x + 0.13, y + 1.5, 1.52, 0, C.divider, 0.7);
    tx(slide, proof, x + 0.13, y + 1.72, 1.52, 0.48, { fontSize: 7.5, color: C.secondary, valign: "top" });
    tx(slide, action.toUpperCase(), x + 0.13, y + 2.56, 1.52, 0.18, { fontSize: 7.6, bold: true, color: C.red, align: "center" });
  });
  addInsightBar(slide, { y: 4.62, h: 0.37, text: "Форматы привычны специалистам: результат можно проверить и использовать вне интерфейса." });
}

function addProof(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[21].title, page: 22 });
  const columns = [
    ["ВХОД", ["несколько разделов проекта", "ведомость договорной цены", "обезличенные параметры объекта"]],
    ["КОЛЛИЗИЯ", ["количество единиц различалось", "состав работ требовал уточнения", "возможен двойной учёт" ]],
    ["ДЕЙСТВИЯ", ["вопросы к исходным данным", "проверка закупочного состава", "условия до договора"]],
  ];
  columns.forEach(([label, items], index) => {
    const x = 0.58 + index * 3.05;
    box(slide, x, 1.38, 2.62, 2.72, { fill: index === 1 ? C.white : C.panel, line: index === 1 ? C.red : C.divider, lineWidth: index === 1 ? 1.3 : 0.6 });
    tx(slide, label, x + 0.18, 1.62, 2.26, 0.2, { fontSize: 8.2, bold: true, color: index === 1 ? C.red : C.black, align: "center" });
    items.forEach((item, itemIndex) => {
      dot(slide, x + 0.22, 2.18 + itemIndex * 0.55, itemIndex === 0 && index === 1 ? C.red : C.black, 0.08);
      tx(slide, item, x + 0.42, 2.06 + itemIndex * 0.55, 1.94, 0.32, { fontSize: 8.2, bold: itemIndex === 0 && index === 1, color: itemIndex === 0 && index === 1 ? C.red : C.secondary, valign: "top" });
    });
    if (index < 2) line(slide, x + 2.64, 2.72, 0.39, 0, C.red, 1.4, { endArrowType: "triangle" });
  });
  addEvidenceBadge(slide, { x: 0.58, y: 4.36, status: "demonstrated", label: "Продемонстрировано" });
  tx(slide, "Доказывает путь от инженерной коллизии к коммерческому последствию — не промышленную точность и не экономию.", 2.45, 4.39, 6.9, 0.26, { fontSize: 8, bold: true, color: C.black, align: "right" });
}

function addMaturity(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[22].title, page: 23 });
  const columns = [
    ["ПРОДЕМОНСТРИРОВАНО", C.black, ["экспертная предметная методология", "сквозные разборы строительных объектов", "сложные Word/Excel-артефакты", "девять профессиональных зон анализа", "источники, допущения и неизвестные"]],
    ["ТРЕБУЕТ ПИЛОТА И ПРИЁМКИ", C.red, ["промышленное веб-приложение", "автоматизированная оркестрация", "локальный эксплуатационный контур", "интеграции и безопасность", "повторяемая точность и производительность"]],
  ];
  columns.forEach(([label, accent, items], index) => {
    const x = 0.58 + index * 4.65;
    box(slide, x, 1.2, 4.18, 3.42, { fill: index ? C.white : C.panel, line: accent, lineWidth: index ? 1.2 : 0.7 });
    tx(slide, label, x + 0.22, 1.47, 3.74, 0.24, { fontSize: 9.2, bold: true, color: accent });
    items.forEach((item, itemIndex) => {
      box(slide, x + 0.23, 2.0 + itemIndex * 0.47, 0.14, 0.14, { fill: accent, line: accent });
      tx(slide, item, x + 0.52, 1.94 + itemIndex * 0.47, 3.38, 0.25, { fontSize: 8.4, bold: itemIndex === 0, color: C.text });
    });
  });
  tx(slide, "Корректный этап продукта: пилотная продуктализация зрелой экспертной методологии.", 1.12, 4.79, 7.75, 0.2, { fontSize: 9, bold: true, color: C.black, align: "center" });
}

function addInterface(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[23].title, page: 24 });
  addEvidenceBadge(slide, { x: 8.42, y: 0.36, status: "prototype", label: "Прототип" });
  box(slide, 0.62, 1.18, 8.76, 3.62, { fill: C.white, line: C.black, lineWidth: 0.9, shadow: true });
  box(slide, 0.62, 1.18, 1.55, 3.62, { fill: C.panel, line: C.panel });
  tx(slide, "СТРОЙИНТЕЛЛЕКТ", 0.82, 1.43, 1.15, 0.18, { fontSize: 7.2, bold: true, color: C.red });
  ["Объекты", "Документы", "Проверки", "Опорная база", "Журнал"].forEach((item, index) => {
    const active = index === 0;
    if (active) box(slide, 0.75, 1.87 + index * 0.47, 1.23, 0.32, { fill: C.red, line: C.red });
    tx(slide, item, 0.89, 1.97 + index * 0.47, 0.94, 0.12, { fontSize: 7.2, bold: active, color: active ? C.white : C.secondary });
  });
  tx(slide, "Объект: жилой комплекс / корпус 01", 2.5, 1.45, 3.8, 0.24, { fontSize: 12, bold: true, color: C.black });
  tx(slide, "решение до договора · комплект документов подтверждён частично", 2.5, 1.83, 4.6, 0.18, { fontSize: 7.5, color: C.secondary });
  const cards = [["Смета", "загружена", "12 418 строк"], ["Предложения", "3 файла", "2 несопоставимые зоны"], ["Проверка", "выполняется", "стандартный режим"]];
  cards.forEach(([title, status, detail], index) => {
    const x = 2.5 + index * 2.02;
    box(slide, x, 2.35, 1.78, 0.98, { fill: index === 2 ? C.white : C.panel, line: index === 2 ? C.red : C.panel, lineWidth: index === 2 ? 1.1 : 0 });
    tx(slide, title, x + 0.14, 2.52, 1.5, 0.16, { fontSize: 8, bold: true, color: C.black });
    tx(slide, status, x + 0.14, 2.78, 1.5, 0.16, { fontSize: 7.2, bold: true, color: index === 2 ? C.red : C.secondary });
    tx(slide, detail, x + 0.14, 3.03, 1.5, 0.13, { fontSize: 6.8, color: C.caption });
  });
  box(slide, 2.5, 3.62, 5.85, 0.82, { fill: C.black, line: C.black });
  tx(slide, "КЛЮЧЕВОЙ ВЫВОД", 2.7, 3.82, 1.2, 0.16, { fontSize: 7.2, bold: true, color: C.red });
  tx(slide, "Два предложения требуют нормализации состава до расчёта диапазона.", 4.1, 3.75, 3.98, 0.28, { fontSize: 9.2, bold: true, color: C.white });
  tx(slide, "Целевой макет — не работающая промышленная система", 6.0, 4.96, 3.35, 0.12, { fontSize: 7, color: C.caption, align: "right" });
}

function addKnowledge(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[24].title, page: 25 });
  const chain = [
    ["ИСТОЧНИК", "закрытый объект / прайс / норматив"], ["ЗНАЧЕНИЕ", "единица · период · регион"], ["СТАТУС", "факт / ориентир / нет данных"],
    ["ПРОВЕРКА", "дата и ответственный"], ["ПРИМЕНЕНИЕ", "позиция → расчёт → вывод"],
  ];
  chain.forEach(([label, body], index) => {
    const x = 0.55 + index * 1.78;
    const y = 1.37 + (index % 2) * 0.43;
    box(slide, x, y, 1.5, 1.42, { fill: index === 4 ? C.red : index % 2 ? C.white : C.panel, line: index === 4 ? C.red : index === 2 ? C.black : C.divider, lineWidth: index === 2 ? 1.1 : 0.6 });
    tx(slide, label, x + 0.15, y + 0.18, 1.2, 0.2, { fontSize: 7.4, bold: true, color: index === 4 ? C.white : index === 2 ? C.red : C.secondary });
    tx(slide, body, x + 0.15, y + 0.61, 1.2, 0.46, { fontSize: 8.2, bold: true, color: index === 4 ? C.white : C.black, align: "center", valign: "top" });
    if (index < 4) line(slide, x + 1.52, y + 0.7, 0.25, index % 2 ? -0.43 : 0.43, C.red, 1.2, { endArrowType: "triangle" });
  });
  const assets = ["расценки", "материалы", "оборудование", "себестоимость", "финансирование", "уроки объектов"];
  box(slide, 0.82, 3.72, 8.36, 0.65, { fill: C.panel, line: C.panel });
  assets.forEach((asset, index) => tx(slide, asset, 1.05 + index * 1.32, 3.94, 1.05, 0.16, { fontSize: 7.7, bold: true, color: index === 5 ? C.red : C.black, align: "center" }));
  addInsightBar(slide, { y: 4.62, h: 0.37, text: "Устаревшее значение маркируется явно; число без происхождения не считается готовым результатом." });
}

function addContours(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[25].title, page: 26 });
  box(slide, 0.6, 1.25, 5.35, 3.25, { fill: C.panel, line: C.black, lineWidth: 1.0 });
  tx(slide, "ВНУТРЕННИЙ КОНТУР", 0.88, 1.56, 2.2, 0.22, { fontSize: 9, bold: true, color: C.black });
  const internal = ["исходные документы", "authoritative-хранилища", "корпоративная база", "расчёты и история", "сформированные отчёты"];
  internal.forEach((item, index) => {
    box(slide, 0.9 + (index % 2) * 2.2, 2.08 + Math.floor(index / 2) * 0.62, 1.92, 0.42, { fill: C.white, line: C.divider });
    tx(slide, item, 1.04 + (index % 2) * 2.2, 2.21 + Math.floor(index / 2) * 0.62, 1.64, 0.14, { fontSize: 7.7, bold: index === 0, color: C.text, align: "center" });
  });
  box(slide, 6.72, 1.77, 2.68, 2.18, { fill: C.white, line: C.red, lineWidth: 1.2 });
  tx(slide, "РЕГУЛИРУЕМЫЙ ВНЕШНИЙ КОНТУР", 7.02, 2.03, 2.08, 0.42, { fontSize: 9.2, bold: true, color: C.red, align: "center" });
  tx(slide, "только минимизированные и маскированные данные для разрешённых внешних процессов", 7.04, 2.63, 2.04, 0.7, { fontSize: 7.8, color: C.secondary, align: "center", valign: "top" });
  const gates = ["регламент", "минимизация", "маскирование", "журнал"];
  gates.forEach((gate, index) => {
    const x = 5.92 + index * 0.2;
    const y = 1.44 + index * 0.68;
    box(slide, x, y, 0.52, 0.42, { fill: index === 2 ? C.red : C.black, line: index === 2 ? C.red : C.black });
    tx(slide, String(index + 1), x + 0.17, y + 0.13, 0.18, 0.11, { fontSize: 7, bold: true, color: C.white, align: "center" });
  });
  tx(slide, "1 регламент · 2 минимизация · 3 маскирование · 4 журнал", 7.03, 3.45, 2.05, 0.28, { fontSize: 6.7, bold: true, color: C.black, align: "center" });
  line(slide, 5.97, 2.86, 0.66, 0, C.red, 1.5, { endArrowType: "triangle" });
  addInsightBar(slide, { y: 4.67, h: 0.34, text: "Если утверждённого правила передачи нет, внешний процесс блокируется." });
}

function addSecurity(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[26].title, page: 27 });
  const layers = [
    ["ПОЛЬЗОВАТЕЛИ", "две базовые роли · расширение отдельно"], ["ПРИЛОЖЕНИЕ", "карточки · очередь · выгрузки"], ["ДАННЫЕ", "объекты · документы · результаты"],
    ["МОДЕЛИ И РАСЧЁТЫ", "локальный целевой runtime"], ["ИНФРАСТРУКТУРА", "контур заказчика · сеть · контейнеры"],
  ];
  layers.forEach(([label, body], index) => {
    const x = 0.7 + index * 0.55;
    const y = 1.23 + index * 0.55;
    const w = 5.7 - index * 0.72;
    box(slide, x, y, w, 0.62, { fill: index === 3 ? C.white : index % 2 ? C.white : C.panel, line: index === 3 ? C.red : C.divider, lineWidth: index === 3 ? 1.2 : 0.6, shadow: index < 3 });
    tx(slide, label, x + 0.18, y + 0.19, 1.45, 0.16, { fontSize: 7.8, bold: true, color: index === 3 ? C.red : C.black });
    tx(slide, body, x + 1.75, y + 0.17, w - 1.95, 0.2, { fontSize: 8, color: C.secondary, align: "right" });
  });
  const controls = [
    ["ЖУРНАЛ", "документы · запросы · передачи · результаты"], ["БЛОКИРОВКА", "нет регламента — нет внешней передачи"], ["ПРИЁМКА", "функциональная и security-проверка"],
  ];
  controls.forEach(([title, body], index) => {
    const y = 1.33 + index * 1.03;
    box(slide, 6.75, y, 2.6, 0.78, { fill: index === 1 ? C.red : C.panel, line: index === 1 ? C.red : C.panel });
    tx(slide, title, 6.98, y + 0.15, 0.95, 0.18, { fontSize: 8, bold: true, color: index === 1 ? C.white : C.red });
    tx(slide, body, 7.98, y + 0.12, 1.13, 0.4, { fontSize: 7.4, bold: index === 1, color: index === 1 ? C.white : C.secondary, align: "right", valign: "top" });
  });
  tx(slide, "Целевое состояние — не утверждение о текущем production-runtime.", 5.45, 4.68, 3.9, 0.18, { fontSize: 7.5, color: C.caption, align: "right" });
}

function addIntegrations(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[27].title, page: 28 });
  const channels = [
    ["СТРУКТУРИРОВАННЫЕ ФАЙЛЫ", "выделенный каталог", "базовый и устойчивый канал"],
    ["ПРОГРАММНЫЙ ИНТЕРФЕЙС (API)", "согласованный контракт", "автоматизированная передача"],
    ["КОРПОРАТИВНАЯ СИСТЕМА", "индивидуальный коннектор", "при наличии документации и тестового контура"],
  ];
  channels.forEach(([title, middle, body], index) => {
    const x = 0.62 + index * 2.6;
    const y = 1.3 + index * 0.32;
    box(slide, x, y, 2.25, 2.65, { fill: index === 1 ? C.white : C.panel, line: index === 1 ? C.red : C.divider, lineWidth: index === 1 ? 1.1 : 0.6 });
    tx(slide, String(index + 1).padStart(2, "0"), x + 0.17, y + 0.18, 0.35, 0.18, { fontSize: 8, bold: true, color: C.red });
    tx(slide, title, x + 0.17, y + 0.63, 1.91, 0.62, { fontSize: 9, bold: true, color: C.black, valign: "top" });
    tx(slide, middle, x + 0.17, y + 1.46, 1.91, 0.22, { fontSize: 8, bold: true, color: C.red });
    line(slide, x + 0.17, y + 1.82, 1.91, 0, C.divider, 0.7);
    tx(slide, body, x + 0.17, y + 2.0, 1.91, 0.4, { fontSize: 7.5, color: C.secondary, valign: "top" });
  });
  line(slide, 8.28, 2.82, 0.42, 0, C.red, 1.5, { endArrowType: "triangle" });
  box(slide, 8.76, 2.02, 0.64, 1.62, { fill: C.black, line: C.black });
  tx(slide, "ЕДИНАЯ\nКАРТОЧКА\nОБЪЕКТА", 8.9, 2.37, 0.36, 0.92, { fontSize: 7.6, bold: true, color: C.white, align: "center" });
  addInsightBar(slide, { y: 4.66, h: 0.35, text: "Глубокие коннекторы, обратная запись и встраивание интерфейсов проектируются отдельно." });
}

function addImplementation(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[28].title, page: 29 });
  addTimeline(slide, {
    y: 1.26, h: 2.96,
    items: [
      { title: "Контур и база", body: "Развёртывание, данные, эталоны и чек-листы. Результат: согласованный фундамент.", icon: "building" },
      { title: "Расчёты и документы", body: "Расчётный модуль, разбор входов и рабочие выгрузки.", icon: "document" },
      { title: "Сравнение и оценка", body: "Нормализация КП, аномалии и диапазон по согласованной методике.", icon: "check" },
      { title: "Интерфейс и приёмка", body: "Экраны, очередь, журнал, каналы данных, обучение и протокол.", icon: "people" },
    ],
  });
  tx(slide, "УПРАВЛЕНИЕ ПРОЕКТОМ", 0.62, 4.45, 1.7, 0.18, { fontSize: 7.6, bold: true, color: C.red });
  tx(slide, "совместный комитет · владельцы данных · протоколы методики · управление изменениями · критерии перехода", 2.38, 4.42, 6.92, 0.24, { fontSize: 8, bold: true, color: C.black, align: "right" });
  tx(slide, "Референс прошлого предложения: 135 календарных дней. Индивидуальный график определяется после диагностики.", 2.15, 4.92, 7.2, 0.12, { fontSize: 7, color: C.caption, align: "right" });
}

function addAcceptance(slide) {
  addSlideBase(slide, { title: COMMERCIAL_SLIDES[29].title, page: 30 });
  const gauges = [[0.95, "≥95%", "извлечение позиций"], [1, "0 ₽", "расхождение итогов"], [0.7, "≥70%", "покрытие ручного расчёта"], [0.8, "≥80%", "чек-листы компетенций"]];
  gauges.forEach(([value, valueLabel, label], index) => addProgressRing(slide, { x: 0.55 + index * 1.52, y: 1.25 + (index % 2) * 0.22, size: 1.25, value, valueLabel, label }));
  const deps = [
    ["ДАННЫЕ", "контрольные объекты и качественные документы"], ["ЛЮДИ", "назначенные специалисты и владельцы решений"],
    ["МЕТОДИКА", "ручной контрольный расчёт и допуски"], ["ИНФРАСТРУКТУРА", "вычислительный контур, сеть и доступы"],
  ];
  tx(slide, "ЗАВИСИМОСТИ ЗАКАЗЧИКА", 6.65, 1.18, 2.7, 0.2, { fontSize: 8, bold: true, color: C.red });
  deps.forEach(([title, body], index) => {
    const y = 1.55 + index * 0.68;
    box(slide, 6.63, y, 2.72, 0.52, { fill: index % 2 ? C.white : C.panel, line: C.divider, lineWidth: 0.6 });
    tx(slide, title, 6.8, y + 0.15, 0.92, 0.16, { fontSize: 7.3, bold: true, color: C.black });
    tx(slide, body, 7.77, y + 0.1, 1.4, 0.28, { fontSize: 7.1, color: C.secondary, align: "right", valign: "top" });
  });
  addInsightBar(slide, { y: 4.48, text: "Точность независимой оценки, скорость и допустимые отклонения фиксируются до итоговой приёмки." });
  tx(slide, "Референсные критерии — окончательные пороги определяются индивидуальным техническим заданием.", 3.3, 4.97, 6.02, 0.12, { fontSize: 7, color: C.caption, align: "right" });
}

function addCommercial(slide) {
  addPriceScene(slide, {
    page: 31,
    title: COMMERCIAL_SLIDES[30].title,
    price: "от 20 млн ₽",
    included: ["программный контур и база", "расчёт и сравнение", "9 компетенций", "выгрузки, журнал, обучение"],
    separate: ["Диагностика — отдельное платное предложение", "Доказательный пилот — отдельное платное предложение", "оборудование и эксплуатация", "расширения, поддержка и развитие"],
    note: "Диагностика и Доказательный пилот имеют индивидуальные цены и не входят в базовое внедрение без прямого условия договора. Полная стоимость владения включает внедрение, лицензирование при наличии, оборудование, эксплуатацию, сопровождение, базу и внешний контур.",
  });
  tx(slide, "Права использования, лицензирование, срок, территория, организационный периметр, инфраструктура, гарантия и сопровождение фиксируются индивидуально.", 5.16, 4.42, 4.23, 0.45, { fontSize: 7.4, bold: true, color: C.black, align: "right", valign: "top" });
}

function addContact(slide) {
  addContactScene(slide, {
    title: "Начнём с одного объекта и одного управленческого вопроса",
    cta: "Передать краткое описание объекта и перечень доступных документов",
    phone: "+7 (495) 198-14-77",
    email: "info@7rlines.com",
    site: "7rlines.ru",
    address: "119049, Москва, ул. Шаболовка, 23к3",
  });
}

const RENDERERS = {
  cover: addCover,
  promise: addPromise,
  conflict: addConflict,
  cost: addCost,
  category: addCategory,
  "before-after": addBeforeAfter,
  roles: addRoles,
  modules: addModules,
  sources: addSources,
  normalization: addNormalization,
  offers: addOffers,
  estimate: addEstimate,
  calculation: addCalculation,
  competencies: addCompetencies,
  engineering: addEngineering,
  procurement: addProcurement,
  economics: addEconomics,
  "governance-roles": addGovernanceRoles,
  workflow: addWorkflow,
  modes: addModes,
  outputs: addOutputs,
  proof: addProof,
  maturity: addMaturity,
  interface: addInterface,
  knowledge: addKnowledge,
  contours: addContours,
  security: addSecurity,
  integrations: addIntegrations,
  implementation: addImplementation,
  acceptance: addAcceptance,
  commercial: addCommercial,
  contact: addContact,
};

export function createCommercialDeck() {
  const pptx = configureDeck(new PptxGenJS(), {
    title: "СтройИнтеллект — универсальное коммерческое предложение",
    subject: "32-слайдовое коммерческое предложение для девелопера и застройщика",
  });
  pptx.creator = "7 КРАСНЫХ ЛИНИЙ";
  pptx.comments = "Продуктовые утверждения проверены по product truth от 12.08.2026";
  pptx.layout = THEME.layoutName;

  for (const slideData of COMMERCIAL_SLIDES) {
    const slide = pptx.addSlide();
    const renderer = RENDERERS[slideData.key];
    if (!renderer) throw new Error(`Нет визуального рендера для слайда ${slideData.number}: ${slideData.key}`);
    renderer(slide, slideData);
    addNotes(slide, slideData);
  }

  return pptx;
}
