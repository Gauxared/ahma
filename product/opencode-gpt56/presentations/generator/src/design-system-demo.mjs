import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import PptxGenJS from "pptxgenjs";

import {
  addAnnotatedQuote,
  addCapabilityLayers,
  addChevronFlow,
  addConstructionDocumentVisual,
  addContactScene,
  addDecisionRoomTitle,
  addEditorialStatement,
  addEvidenceBadge,
  addFunnel,
  addHorizontalBars,
  addInputAnalysisOutput,
  addInsightBar,
  addLadder,
  addLineChart,
  addMatrix,
  addMetric,
  addPriceScene,
  addProgressRing,
  addRiskMatrix,
  addRiskRegister,
  addRoleMap,
  addSlideBase,
  addSlopeChart,
  addSourceNote,
  addStackedComposition,
  addTimeline,
  addWaterfall,
} from "./components.mjs";
import { THEME, configureDeck } from "./theme.mjs";

const MODULE_PATH = fileURLToPath(import.meta.url);
const GENERATOR_DIRECTORY = path.dirname(path.dirname(MODULE_PATH));
const DEFAULT_OUTPUT_PATH = path.join(GENERATOR_DIRECTORY, "output/design-system-demo.pptx");

export const DEMO_SLIDE_COUNT = 12;

function resolveOutputPath(outputPath = DEFAULT_OUTPUT_PATH) {
  return path.isAbsolute(outputPath)
    ? outputPath
    : path.resolve(GENERATOR_DIRECTORY, outputPath);
}

function addCover(pptx) {
  const slide = pptx.addSlide();
  addEditorialStatement(slide, {
    eyebrow: "Общая система презентаций A+B",
    statement: "Решение становится убедительным, когда конфликт виден сразу, а механизм можно проверить",
    support: "Инженерная редактура создаёт напряжение и кульминацию. Комната принятия решений раскрывает процессы, доказательства и следующий управляемый шаг.",
    metric: "98",
    metricLabel: "слайдов может собираться из одной системы без повторения точной композиции",
    footer: false,
    rail: false,
  });
  addMetric(slide, { x: 7.05, y: 3.65, w: 2.15, h: 0.92, value: "10 × 5,625", label: "точный формат 16:9", fill: THEME.colors.panel, align: "right" });
}

function addConflict(pptx) {
  const slide = pptx.addSlide();
  addSlideBase(slide, { title: "Итоговая сумма скрывает, что документы описывают разный предмет работ", page: 2 });
  addAnnotatedQuote(slide, {
    x: 0.55,
    y: 1.32,
    w: 5.35,
    h: 1.36,
    quote: "Сравнивать нужно одинаковый состав, а не нижнюю строку предложения",
    author: "Правило проверки коммерческих предложений",
    annotation: "Тезис занимает главную площадь",
  });
  addHorizontalBars(slide, {
    x: 0.55,
    y: 3.05,
    w: 5.25,
    h: 1.35,
    unit: "%",
    data: [
      { label: "Состав подтверждён", value: 82 },
      { label: "Указано отдельно", value: 43 },
      { label: "Не сопоставимо", value: 27, accent: true },
    ],
  });
  addConstructionDocumentVisual(slide, {
    x: 6.35,
    y: 1.35,
    w: 1.92,
    h: 3.05,
    annotations: ["разный объём", "иная единица", "нет основания"],
  });
  addSourceNote(slide, { text: "Иллюстративный пример · без коммерческих данных", status: "результат модели" });
}

function addMechanism(pptx) {
  const slide = pptx.addSlide();
  addSlideBase(slide, { title: "Проверяемый вывод возникает только после явной цепочки происхождения числа", page: 3 });
  addInputAnalysisOutput(slide, {
    y: 1.28,
    h: 2.82,
    input: ["Проектная документация", "Смета и ведомости", "Договорные ограничения", "Предложения подрядчиков"],
    analysis: ["Нормализация состава", "Проверка количества", "Пересборка стоимости", "Фиксация неизвестного"],
    output: ["Сопоставимая база", "Диапазон стоимости", "Карта отклонений", "Решение для комитета"],
  });
  addInsightBar(slide, { y: 4.34, text: "Красным отмечается не весь анализ, а критическая точка, которая меняет решение клиента." });
  addSourceNote(slide, { text: "Методологическая схема", status: "продемонстрировано" });
}

function addArchitecture(pptx) {
  const slide = pptx.addSlide();
  addSlideBase(slide, { title: "Девять компетенций работают как слои одного управленческого результата", page: 4 });
  addCapabilityLayers(slide, {
    y: 1.24,
    h: 3.52,
    layers: [
      { label: "ИСТОЧНИКИ", title: "Документы, нормативы, предложения и фактические данные объекта" },
      { label: "ПРОВЕРКА", title: "Сопоставимость состава, количества, сроков и договорных условий" },
      { label: "ЭКОНОМИКА", title: "Прямые и косвенные затраты, риски, меры и диапазон результата" },
      { label: "РЕШЕНИЕ", title: "Роли, критерии перехода, доказательный пилот и приёмка" },
    ],
    outcome: "Руководитель видит не обещание, а проверяемую причинно-следственную связь",
  });
  addEvidenceBadge(slide, { x: 7.72, y: 4.38, status: "pilot" });
}

function addEvidence(pptx) {
  const slide = pptx.addSlide();
  addSlideBase(slide, { title: "Неизвестное сохраняется в матрице, а не маскируется точным вердиктом", page: 5 });
  addMatrix(slide, {
    x: 0.55,
    y: 1.28,
    w: 6.25,
    h: 3.18,
    columns: ["Проект", "Смета", "Договор", "Предложение"],
    rows: ["Количество", "Комплектация", "Цена", "Срок", "Ответственность"],
    values: [
      ["есть", "есть", "—", "!"],
      ["есть", "!", "—", "!"],
      ["—", "есть", "есть", "есть"],
      ["есть", "—", "есть", "!"],
      ["—", "—", "есть", "нет"],
    ],
  });
  addProgressRing(slide, { x: 7.35, y: 1.38, size: 1.55, value: 0.68, label: "полнота доказательств", valueLabel: "68%" });
  addMetric(slide, { x: 7.12, y: 3.32, w: 2.05, h: 0.94, value: "4", label: "критических разрыва", fill: THEME.colors.panel, align: "center" });
  addInsightBar(slide, { y: 4.56, h: 0.42, text: "Недостаток данных становится условием пилота, а не скрытой уверенностью." });
}

function addProcess(pptx) {
  const slide = pptx.addSlide();
  addSlideBase(slide, { title: "Пилот сокращает риск, если каждый этап заканчивается проверяемым артефактом", page: 6 });
  addTimeline(slide, {
    y: 1.32,
    h: 2.88,
    items: [
      { title: "Граница задачи", body: "Фиксируем объект, документы, роли и вопрос, который должен получить ответ.", icon: "building" },
      { title: "Контрольный расчёт", body: "Собираем сопоставимую базу и показываем происхождение каждого вывода.", icon: "document" },
      { title: "Проверка качества", body: "Заказчик подтверждает критерии, ограничения и допустимость использования данных.", icon: "check" },
      { title: "Решение", body: "Комитет принимает следующий шаг по заранее согласованным правилам.", icon: "people" },
    ],
  });
  addChevronFlow(slide, {
    x: 1.38,
    y: 4.42,
    w: 7.25,
    h: 0.44,
    items: ["объект", "расчёт", "приёмка", "масштабирование"],
  });
}

function addEconomics(pptx) {
  const slide = pptx.addSlide();
  addSlideBase(slide, { title: "Полная себестоимость меняет знак модельной маржи раньше, чем объект меняет бюджет", page: 7 });
  addWaterfall(slide, {
    x: 0.58,
    y: 1.42,
    w: 5.55,
    h: 2.9,
    unit: "",
    data: [
      { label: "Контракт", value: 100, total: true },
      { label: "Прямые", value: -58 },
      { label: "Косвенные", value: -24 },
      { label: "Риски", value: -13, accent: true },
      { label: "Меры", value: 7 },
      { label: "Результат", value: 12, total: true },
    ],
  });
  addSlopeChart(slide, {
    x: 6.55,
    y: 1.45,
    w: 2.55,
    h: 2.72,
    unit: "%",
    data: [
      { from: 18, to: 12 },
      { from: 9, to: -4, accent: true },
    ],
    leftLabel: "СМЕТА",
    rightLabel: "ПОЛНАЯ МОДЕЛЬ",
  });
  addInsightBar(slide, { y: 4.48, text: "Кульминация строится на одном конфликте: модельная прибыль не равна полной экономике объекта." });
  addSourceNote(slide, { text: "Иллюстративные значения", status: "результат модели" });
}

function addRisk(pptx) {
  const slide = pptx.addSlide();
  addSlideBase(slide, { title: "Красная зона риска должна сразу вести к владельцу действия", page: 8 });
  addRiskMatrix(slide, {
    x: 0.82,
    y: 1.35,
    size: 2.82,
    points: [
      { probability: 2.7, impact: 2.65, label: "несопоставимый состав", critical: true },
      { probability: 1.75, impact: 2.25, label: "неполные количества" },
      { probability: 2.4, impact: 1.2, label: "задержка ответа" },
    ],
  });
  addRiskRegister(slide, {
    x: 4.25,
    y: 1.35,
    w: 5.15,
    h: 2.95,
    risks: [
      { risk: "Разный состав", cause: "Нет общей базы", probability: "Высокое", impact: "Высокое", action: "Нормализация" },
      { risk: "Пропуск объёма", cause: "Разные версии", probability: "Среднее", impact: "Высокое", action: "Проверка источника" },
      { risk: "Ложная точность", cause: "Нет данных", probability: "Среднее", impact: "Среднее", action: "Диапазон" },
    ],
  });
  addInsightBar(slide, { y: 4.52, text: "Регистр полезен только тогда, когда риск связан с причиной, влиянием и конкретным действием." });
}

function addRoles(pptx) {
  const slide = pptx.addSlide();
  addSlideBase(slide, { title: "Решение ускоряется, когда у каждой роли есть свой предмет проверки", page: 9 });
  addRoleMap(slide, {
    x: 0.62,
    y: 1.25,
    w: 5.55,
    h: 3.45,
    center: "Решение по объекту",
    roles: [
      { title: "Чемпион", note: "ведёт задачу", critical: true },
      { title: "Экономический покупатель", note: "утверждает эффект" },
      { title: "Сметчик", note: "проверяет расчёт" },
      { title: "Технический эксперт", note: "проверяет физику" },
      { title: "Юрист", note: "проверяет договор" },
      { title: "Информационные технологии", note: "проверяют контур" },
    ],
  });
  addStackedComposition(slide, {
    x: 6.65,
    y: 1.68,
    w: 2.45,
    h: 0.62,
    totalLabel: "ВРЕМЯ КОМИТЕТА",
    data: [
      { label: "Факты", value: 45 },
      { label: "Ограничения", value: 25 },
      { label: "Выбор", value: 30, accent: true },
    ],
  });
  addMetric(slide, { x: 6.65, y: 3.65, w: 2.45, h: 0.8, value: "1", label: "владелец следующего шага", fill: THEME.colors.panel, align: "center" });
}

function addRoute(pptx) {
  const slide = pptx.addSlide();
  addSlideBase(slide, { title: "Вход в проект становится безопаснее, когда следующий уровень нужно заслужить доказательством", page: 10 });
  addFunnel(slide, {
    x: 0.72,
    y: 1.27,
    w: 4.95,
    h: 3.35,
    stages: ["Диагностическая встреча", "Платная диагностика", "Доказательный пилот", "Базовое внедрение"],
    criteria: ["Согласован вопрос решения", "Доступны исходные документы", "Критерии приёмки подтверждены", "Эффект и ограничения доказаны"],
  });
  addLadder(slide, {
    x: 6.55,
    y: 2.05,
    w: 2.45,
    h: 2.42,
    steps: [
      { title: "Факт" },
      { title: "Связь" },
      { title: "Расчёт" },
      { title: "Решение" },
    ],
  });
  addEvidenceBadge(slide, { x: 6.55, y: 1.42, status: "demonstrated" });
}

function addDynamics(pptx) {
  const slide = pptx.addSlide();
  addSlideBase(slide, { title: "План развития полезен только рядом с фактом и границей применимости", page: 11 });
  addLineChart(slide, {
    x: 0.58,
    y: 1.42,
    w: 5.75,
    h: 2.78,
    labels: ["Неделя 1", "Неделя 2", "Неделя 3", "Неделя 4", "Неделя 5"],
    series: [
      { label: "План", values: [18, 34, 56, 76, 92] },
      { label: "Факт", values: [14, 31, 48, 61, 68], accent: true },
    ],
    unit: "%",
  });
  addProgressRing(slide, { x: 7.05, y: 1.28, size: 1.62, value: 0.68, label: "подтверждено данными", valueLabel: "68%" });
  addMetric(slide, { x: 6.78, y: 3.45, w: 2.2, h: 0.85, value: "−24 п.п.", label: "отклонение от плана", fill: THEME.colors.panel, align: "center" });
  addInsightBar(slide, { y: 4.5, text: "Красная серия показывает отклонение, а подпись объясняет период, единицу и статус данных." });
  addSourceNote(slide, { text: "Референсная динамика", status: "иллюстративный пример" });
}

function addCommercialAndContact(pptx) {
  const priceSlide = pptx.addSlide();
  addPriceScene(priceSlide, {
    page: 11,
    price: "от 20 млн ₽",
    title: "Цена появляется после механизма доверия, а не вместо него",
    included: ["Согласованный состав базового внедрения", "Настройка ключевых сценариев", "Приёмка по критериям проекта"],
    separate: ["Платная диагностика", "Доказательный пилот", "Дополнительные интеграции"],
    note: "Точная стоимость зависит от объекта, состава данных, контура размещения и критериев приёмки. Неизвестное не превращается в искусственный тариф.",
  });

  const contactSlide = pptx.addSlide();
  addContactScene(contactSlide, {
    title: "Следующий шаг — выбрать один объект и один вопрос для доказательной проверки",
    cta: "Согласовать диагностическую встречу",
  });
}

function composeDemo(pptx) {
  addCover(pptx);
  addConflict(pptx);
  addMechanism(pptx);
  addArchitecture(pptx);
  addEvidence(pptx);
  addProcess(pptx);
  addEconomics(pptx);
  addRisk(pptx);
  addRoles(pptx);
  addRoute(pptx);
  addCommercialAndContact(pptx);
}

export async function writeDesignSystemDemo(outputPath = DEFAULT_OUTPUT_PATH) {
  const resolvedOutputPath = resolveOutputPath(outputPath);
  await mkdir(path.dirname(resolvedOutputPath), { recursive: true });

  const pptx = configureDeck(new PptxGenJS(), {
    subject: "Визуальная демонстрация общей системы презентаций A+B",
    title: "7 КРАСНЫХ ЛИНИЙ — демонстрация дизайн-системы",
  });
  composeDemo(pptx);
  if (pptx._slides.length !== DEMO_SLIDE_COUNT) {
    throw new Error(`Ожидалось ${DEMO_SLIDE_COUNT} слайдов, создано ${pptx._slides.length}`);
  }
  await pptx.writeFile({ fileName: resolvedOutputPath, compression: true });
  return resolvedOutputPath;
}

const isDirectRun = process.argv[1]
  ? MODULE_PATH === path.resolve(process.argv[1])
  : false;

if (isDirectRun) {
  const outputPath = process.argv[2] ?? DEFAULT_OUTPUT_PATH;
  const writtenPath = await writeDesignSystemDemo(outputPath);
  console.log(writtenPath);
}
