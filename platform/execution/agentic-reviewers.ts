/**
 * АГЕНТНЫЙ РЕЖИМ — рецензенты, работающие циклом с инструментами (Т9).
 *
 * ПОЧЕМУ ОТДЕЛЬНЫМ ФАЙЛОМ И ОТДЕЛЬНЫМ РЕЖИМОМ
 *
 * Конвейер ролевых промптов (`check-ports.ts`) остаётся и никуда не денется: он
 * быстрее, дешевле и предсказуемее, и на встрече может понадобиться именно он.
 * Заменять его агентным значило бы отнять у владельца выбор — а выбор режима
 * это решение о времени и деньгах прогона, не о технике.
 *
 * Поэтому здесь ВТОРАЯ сборка тех же способностей: те же роли и та же строгая
 * схема ответа, но материал агент добывает инструментами, а не получает готовым.
 *
 * ЧТО ЭТО МЕНЯЕТ ПО СУЩЕСТВУ
 *
 * В конвейере ГИП отвечает по тому, что ему положили: сжатую выжимку текста РД и
 * двенадцать листов картинками. Его «в документации этого нет» — утверждение о
 * НАШЕМ бюджете, а не о документации. В агентном режиме он может попросить
 * страницу, поднять норматив по шифру, пересчитать сходимость и увидеть то, что
 * в выжимку не попало.
 *
 * Цена известна и объявляется: цикл дороже одного вызова, и потолок шагов —
 * единственное, что удерживает счёт за токены в границах.
 */
import type { CodeSystem } from "@contracts/index.js";
import { runAgentLoop } from "@modules/agents/agent-loop.js";
import type { LoopMessage, LoopRuntime } from "@modules/agents/agent-loop.js";
import { buildAgentTools } from "@modules/agents/agent-tools.js";
import type { AgentTool, ToolCallRecord, ToolPosition, ToolSources } from "@modules/agents/agent-tools.js";
import { AGENT_OUTPUT_SCHEMA, entitiesOf } from "@modules/agents/agent-shell.js";
import type {
  DocumentReview,
  DocumentReviewer,
  ObjectReviewer,
} from "@modules/workflow/check-object.js";

import type { Sha256, SourceRef } from "@contracts/index.js";

import type { Platform } from "../bootstrap.js";
import { anonymize, restoreDeep } from "../security/anonymizer.js";
import { readSheetOf } from "../storage/sheet-reader.js";
import { Decimal } from "decimal.js";

import type { CollectedDuringCheck } from "./check-ports.js";

/**
 * Потолок шагов на одного агента.
 *
 * Шесть — не круглое число, а замер стоимости: каждый шаг это отдельное
 * обращение к модели со всей историей диалога, и десятый шаг несёт в промпте
 * девять предыдущих. При шести шагах агент успевает пройти путь «посмотрел
 * позиции → увидел странное → поднял норматив → пересчитал → уточнил», а прогон
 * остаётся в пределах встречи.
 *
 * Переопределяется переменной среды: владелец вправе купить больше глубины.
 */
const ПОТОЛОК_ШАГОВ = Number.parseInt(process.env["STROYINTELLECT_AGENT_STEPS"] ?? "6", 10) || 6;

/** Роли агентного режима: те же способности, что в конвейере. */
const РОЛИ_ДОКУМЕНТА = [
  {
    capability: "estimate_review",
    bundle: "estimate-review",
    задача:
      "Проверь ЭТУ смету: сходимость, применимость расценок, задвоенные позиции, " +
      "нерасшифрованные комплекты, завышение объёмов. Начни с чтения позиций.",
  },
  {
    capability: "tech_opinion",
    bundle: "tech-opinion",
    задача:
      "Проверь ЭТУ смету против рабочей документации объекта: объёмы, состав работ, " +
      "количество оборудования. Читай страницы документации, а не догадывайся о них.",
  },
] as const;

const РОЛИ_ОБЪЕКТА = [
  { capability: "finance_model", bundle: "finance-model", задача: "Построй финансовую модель объекта по разобранным сметам." },
  { capability: "procurement_map", bundle: "procurement", задача: "Построй карту закупок и сроков поставки по объекту." },
  { capability: "executive_docs", bundle: "executive-docs", задача: "Собери реестр исполнительной документации и чек-лист старта." },
  { capability: "contract_audit", bundle: "contract-audit", задача: "Разбери договорные условия и разграничение объёма по документам объекта." },
  { capability: "subcontract_plan", bundle: "subcontract-plan", задача: "Составь ведомость распределения работ между своими силами и подрядом." },
  { capability: "object_passport", bundle: "object-passport", задача: "Собери паспорт объекта по переданным документам." },
] as const;

/**
 * Источники для инструментов — из накопителя обхода, а не из базы.
 *
 * Накопитель к моменту работы агентов полон: обход запускает их последними. Идти
 * в базу отсюда значило бы читать то же самое вторым путём, и второй путь
 * разошёлся бы с первым.
 */
function источники(platform: Platform, collected: CollectedDuringCheck): ToolSources {
  const поПути = (запрос: string): string | undefined => {
    const цель = запрос.trim().toLowerCase();
    // Агент называет документ так, как увидел его в перечне: путём или именем.
    // Требовать точный путь значило бы заставить его угадывать наш формат.
    return collected.documentHashes
      .map((d) => d.path)
      .find((path) => {
        const имя = path.split("/").pop()?.toLowerCase() ?? "";
        return path.toLowerCase() === цель || имя === цель || имя.includes(цель) || цель.includes(имя);
      });
  };

  return {
    documents: async () =>
      collected.documentHashes.map((d) => {
        const позиций = collected.linearPositions.filter((p) => p.document === d.path).length;
        const имя = d.path.split("/").pop() ?? d.path;
        return позиций > 0
          ? `${имя} — разобрано позиций ${позиций}`
          : `${имя} — позиций не извлечено (не смета либо форма не распознана)`;
      }),

    positionsOf: async (запрос) => {
      const путь = поПути(запрос);
      if (путь === undefined) return [];

      return collected.linearPositions
        .filter((p) => p.document === путь)
        .map(
          (p): ToolPosition => ({
            ordinal: p.ordinal,
            // `basis` и есть шифр расценки: так он называется в форме 421/пр.
            code: p.basis === "" ? "без шифра" : p.basis,
            name: p.name,
            unit: p.unit ?? "",
            quantity: p.quantity ?? "",
            // Инструмент агента ГОВОРИТ О НЕЗНАНИИ ВСЛУХ. Пустая строка тут
            // прочиталась бы моделью как «ноль» или как сбой инструмента, и
            // она бы принялась достраивать сумму сама — ровно то, чего
            // ADR-V3-010 не допускает.
            amount: p.amount ?? "сумма в смете не указана",
          }),
        );
    },

    sheetOf: async (запрос, лист) => {
      const путь = поПути(запрос);
      if (путь === undefined) return [];

      // Имя листа читателем не выбирается: он отдаёт первый лист книги. Просить
      // конкретный можно только после того, как читатель научится их различать —
      // а обещать это в описании инструмента, не умея, значит врать агенту.
      const sheet = await readSheetOf(путь);
      if (лист !== undefined && лист !== "" && sheet.name !== лист) {
        return [`книга отдаёт лист «${sheet.name}»; выбор листа по имени пока не поддержан`];
      }
      const строки: string[] = [];

      for (const номер of [...sheet.rows.keys()].sort((a, b) => a - b)) {
        const ячейки = sheet.rows.get(номер);
        const текст = [...(ячейки ?? [])].map(([, v]) => v.trim()).filter((v) => v !== "");
        if (текст.length > 0) строки.push(`${номер}\t${текст.join("\t")}`);
      }

      return строки;
    },

    normOf: async (код) => {
      // Шифр приходит от модели и может быть с системой или без неё. Пробуем
      // обе распространённые системы, а не отвечаем «не найден» на первой же.
      const системы: readonly CodeSystem[] = ["ГЭСН", "ГЭСНм", "ГЭСНмр", "ГЭСНп", "ГЭСНр", "ФСБЦ", "ФССЦ", "ФЕР"];

      for (const system of системы) {
        const item = platform.catalogue.findByCode({ system, code: код });
        if (item !== undefined) return `${item.name} · единица ${item.unit} · шифр ${код} (${system})`;
      }
      return undefined;
    },

    textOf: async (запрос, страница) => {
      const путь = поПути(запрос) ?? запрос;
      const документ = collected.designDocuments.find(
        (d) => d.path === путь || (d.path.split("/").pop() ?? "").includes(запрос.trim()),
      );

      if (документ === undefined) return undefined;

      // Постранично не хранится — храним текст целиком. Делим по числу страниц,
      // и это ПРИБЛИЖЕНИЕ, о котором агенту сказано: иначе он решит, что видит
      // ровно ту страницу, что просил.
      const страниц = Math.max(1, документ.pages);
      const размер = Math.ceil(документ.text.length / страниц);
      const от = Math.max(0, (страница - 1) * размер);

      if (от >= документ.text.length) return undefined;

      return (
        `[приближение: текст документа поделён на ${страниц} равных частей, ` +
        `это часть ${страница}]\n\n${документ.text.slice(от, от + размер)}`
      );
    },

    convergenceOf: async (запрос) => {
      const путь = поПути(запрос);
      if (путь === undefined) return "документ не найден среди разобранных";

      const позиции = collected.linearPositions.filter((p) => p.document === путь);
      if (позиции.length === 0) return "позиций из этого документа не извлечено, сходимость считать не из чего";

      /**
       * СМЕТА БЕЗ СТОИМОСТНОЙ ЧАСТИ — ОТВЕТ, А НЕ СБОЙ.
       *
       * Отдать сюда «0.00 ₽» значило бы сообщить модели, что смета бесплатна;
       * промолчать — что инструмент сломался. И то и другое кончилось бы тем,
       * что агент достроил бы сумму сам.
       *
       * ПРЕЖДЕ ОТКАЗ БЫЛ ЖЁСТКИМ: одна позиция без суммы — и итог не выдавался
       * вовсе, даже когда остальные триста сумму имели. Считаем по тем, что
       * есть, и называем числом, скольких не хватает.
       */
      const сСуммой = позиции.filter((p) => p.amount !== undefined && p.amount !== "");
      const сумма = сСуммой.reduce((acc, p) => acc.plus(new Decimal(p.amount!.replace(",", "."))), new Decimal(0));
      const безСуммы = позиции.length - сСуммой.length;

      if (сСуммой.length === 0) {
        return (
          `позиций ${позиции.length}, суммы нет НИ У ОДНОЙ: в документе нет стоимостной части. ` +
          "Итог не считается — складывать нечего. Ноль здесь означал бы «стоимость равна нулю», а она неизвестна."
        );
      }

      return (
        `позиций ${позиции.length}, сумма посчитана по ${сСуммой.length}: ${сумма.toFixed(2)} ₽` +
        (безСуммы > 0 ? `; у ${безСуммы} позиций суммы в документе нет — в итог они НЕ вошли` : "") +
        ". Посчитано расчётным модулем, не моделью."
      );
    },
  };
}

/**
 * Рантайм цикла поверх агентного порта платформы.
 *
 * ОБЕЗЛИЧИВАНИЕ ЗДЕСЬ ОБЯЗАТЕЛЬНО, И ЭТО НЕ ФОРМАЛЬНОСТЬ.
 *
 * Первый агентный прогон отказал целиком: шлюз не выпустил ни одного вызова —
 * «классы [commercial_secret] не выпускаются в исходном виде (ТЗ §12.1л)».
 * Цикл ходил к модели напрямую, без расписки анонимизатора, и правило fail
 * closed остановило его ДО отправки данных.
 *
 * Это ровно тот случай, ради которого правило и написано: я построил второй
 * путь к модели и забыл, что защита стоит на первом. Ни один байт наружу при
 * этом не ушёл.
 *
 * ОБЕЗЛИЧИВАЕТСЯ ВЕСЬ ДИАЛОГ, А НЕ ПОСЛЕДНЕЕ СООБЩЕНИЕ. Результат инструмента —
 * это позиции сметы с наименованиями и суммами, то есть ровно те сведения, что
 * защищает §11. Обезличить вопрос и отправить сырой ответ инструмента значило
 * бы выполнить правило наполовину.
 */
function рантаймЦикла(
  platform: Platform,
  tenantId: string,
  now: string,
  operationId: string,
  сущности: readonly { readonly value: string; readonly kind: string }[],
  соль: string,
): LoopRuntime {
  const runtime = platform.agentRuntime;

  if (runtime === undefined) {
    throw new Error("агентный режим требует настроенного рантайма модели");
  }

  const оценка = (messages: readonly LoopMessage[]): number =>
    Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 3);

  /** Обезличивает диалог целиком и отдаёт расписку по тому, что уйдёт. */
  const обезличить = (
    messages: readonly LoopMessage[],
    entities: readonly { readonly value: string; readonly kind: string }[],
    salt: string,
  ) => {
    const склеено = messages.map((m) => m.content).join("\n");
    const итог = anonymize({ text: склеено, knownEntities: entities, salt });

    // Разрезается по тем же границам: замены не переносят переводы строк, и
    // число частей совпадает. Иначе диалог склеился бы в одно сообщение.
    const части = итог.text.split("\n");
    let i = 0;
    const выход = messages.map((m) => {
      const строк = m.content.split("\n").length;
      const content = части.slice(i, i + строк).join("\n");
      i += строк;
      return { ...m, content };
    });

    return { messages: выход, receipt: итог.receipt, map: итог.map };
  };

  return {
    step: async (messages, tools) => {
      const чистый = обезличить(messages, сущности, соль);

      const результат = await runtime.run({
        prompt: "",
        anonymization: чистый.receipt,
        messages: чистый.messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.toolCallId === undefined ? {} : { toolCallId: m.toolCallId }),
          ...(m.toolCalls === undefined ? {} : { toolCalls: m.toolCalls }),
        })),
        tools: tools.map((t: AgentTool) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
        estimatedInputTokens: оценка(messages),
      });

      // КАЖДЫЙ шаг цикла — в журнал §12.1л. Двести двадцать обращений,
      // записанные как два, — это неправда о том, сколько раз система ходила
      // наружу, а журнал существует ровно ради этого числа.
      platform.recordModelCall?.({
        operationId,
        contour: результат.contour,
        provider: результат.provider,
        model: результат.model,
        anonymized: чистый.receipt.clean,
        inputTokens: результат.inputTokens,
        outputTokens: результат.outputTokens,
      });

      // Псевдонимы разворачиваются обратно: замечание «Организация-4721
      // завысила объём» человеку заказчика бесполезно.
      const выход = restoreDeep(результат.output, чистый.map) as
        | { readonly kind?: string; readonly content?: string; readonly toolCalls?: readonly { id: string; name: string; arguments: string }[] }
        | string;

      if (typeof выход === "string") {
        return { content: выход, toolCalls: [], inputTokens: результат.inputTokens, outputTokens: результат.outputTokens };
      }

      return {
        content: выход.content ?? "",
        toolCalls: выход.toolCalls ?? [],
        inputTokens: результат.inputTokens,
        outputTokens: результат.outputTokens,
      };
    },

    finish: async (messages, schema) => {
      const чистый = обезличить(messages, сущности, соль);

      const результат = await runtime.run({
        prompt: "",
        anonymization: чистый.receipt,
        messages: чистый.messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.toolCallId === undefined ? {} : { toolCallId: m.toolCallId }),
          ...(m.toolCalls === undefined ? {} : { toolCalls: m.toolCalls }),
        })),
        outputSchema: schema,
        estimatedInputTokens: оценка(messages),
      });

      platform.recordModelCall?.({
        operationId,
        contour: результат.contour,
        provider: результат.provider,
        model: результат.model,
        anonymized: чистый.receipt.clean,
        inputTokens: результат.inputTokens,
        outputTokens: результат.outputTokens,
      });

      return {
        output: restoreDeep(результат.output, чистый.map),
        inputTokens: результат.inputTokens,
        outputTokens: результат.outputTokens,
      };
    },
  };
}

/**
 * Позиции для КООРДИНАТЫ замечания: номер позиции → строка книги и её файл.
 *
 * Строится по накопителю обхода, а не по денежным спискам: строка известна у
 * каждой позиции, сумма — не у каждой.
 */
function координаты(
  collected: CollectedDuringCheck,
  документ: string | undefined,
): ReadonlyMap<string, { row: number; amount?: string | undefined; document: string; contentHash: Sha256 }> {
  const индекс = new Map<
    string,
    { row: number; amount?: string | undefined; document: string; contentHash: Sha256 }
  >();

  for (const строка of collected.extracted) {
    if (документ !== undefined && строка.document !== документ) continue;
    if (строка.sourceRow <= 0) continue;

    const хэш = collected.documentHashes.find((entry) => entry.path === строка.document)?.contentHash;
    if (хэш === undefined) continue;

    индекс.set(строка.ordinal, {
      row: строка.sourceRow,
      ...(строка.amount === undefined ? {} : { amount: строка.amount }),
      document: строка.document,
      // `ReadDocument.contentHash` — строка; тип отпечатка тот же, но объявлен
      // в контрактах. Приведение здесь, а не в контракте обхода.
      contentHash: хэш as Sha256,
    });
  }

  return индекс;
}

/**
 * Ответ агента приводится к тому же виду, что и в конвейере.
 *
 * КООРДИНАТА ЗАМЕЧАНИЯ ПЕРЕНОСИТСЯ ЗДЕСЬ, и раньше она терялась.
 *
 * Схема ответа требует `impactOrdinal` — номер позиции, к которой относится
 * вывод, — и модель его возвращает. Конвейер по нему находит строку в книге;
 * агентный режим брал только severity/statement/basis и номер выбрасывал.
 * Панель «Что показать клиенту» из-за этого была пуста на ЛЮБОМ агентном
 * прогоне: показать в документе нечего, хотя строка известна.
 */
function кОбзору(
  выход: unknown,
  вызовы: readonly ToolCallRecord[],
  шагов: number,
  исчерпан: boolean,
  индекс: ReadonlyMap<string, { row: number; amount?: string | undefined; document: string; contentHash: Sha256 }> =
    new Map(),
): DocumentReview {
  const вызовов = вызовы.length;
  const о = (выход ?? {}) as {
    verdict?: string;
    findings?: readonly {
      severity?: string;
      statement?: string;
      basis?: string;
      deviation?: string;
      impactOrdinal?: string;
    }[];
    openQuestions?: readonly { question?: string; owner?: string; dueBy?: string }[];
    sections?: readonly { id?: string; title?: string; purpose?: string; columns?: readonly string[]; rows?: readonly (readonly string[])[] }[];
  };

  const хвост = исчерпан
    ? ` [ПОТОЛОК ШАГОВ ИСЧЕРПАН: ${шагов} шагов, ${вызовов} вызовов инструментов — часть проверок не выполнена]`
    : ` [агентный режим: ${шагов} шагов, ${вызовов} вызовов инструментов]`;

  return {
    verdict: `${о.verdict ?? "вердикт не выдан"}${хвост}`,
    findings: (о.findings ?? []).map((f) => {
      const позиция = индекс.get(String(f.impactOrdinal ?? "").trim());

      /**
       * ССЫЛКА И СУММА ВЛИЯНИЯ — РАЗНОЕ. Ссылка есть, когда известна строка;
       * сумма — когда известны деньги. В смете без стоимостной части первое
       * есть, второго нет, и подставленный ноль объявил бы находку безобидной.
       */
      const source: SourceRef | undefined =
        позиция === undefined
          ? undefined
          : {
              sourceId: позиция.document,
              contentHash: позиция.contentHash,
              locator: { kind: "row", sheet: "ЛСР", row: позиция.row },
              status: "fact",
              acquisition: "parsed",
              checkedAt: new Date().toISOString().slice(0, 10) as never,
              staleAfterDays: 90,
            };

      return {
        severity: String(f.severity ?? "medium"),
        statement: String(f.statement ?? ""),
        basis: String(f.basis ?? ""),
        ...(f.deviation === undefined || f.deviation === "none"
          ? {}
          : { deviation: f.deviation as never }),
        ...(source === undefined ? {} : { source }),
        ...(source === undefined || позиция?.amount === undefined
          ? {}
          : {
              impact: {
                value: { amount: позиция.amount as never, currency: "RUB" as never },
                provenance: { kind: "source" as const, ref: source },
              },
            }),
      };
    }),
    ...(о.openQuestions === undefined
      ? {}
      : {
          openQuestions: о.openQuestions.map((q) => ({
            question: String(q.question ?? ""),
            owner: String(q.owner ?? ""),
            dueBy: String(q.dueBy ?? ""),
          })),
        }),
    // Вызовы инструментов — В АРТЕФАКТ, а не только в текст вердикта (Т9.4).
    // «Агент позвал инструмент шесть раз» без перечня — это счётчик, а не след:
    // по нему нельзя проверить, что именно он смотрел.
    toolCalls: вызовы.map((c) => ({
      tool: c.tool,
      arguments: c.arguments,
      resultChars: c.resultChars,
      resultDigest: c.resultDigest,
      ...(c.failed === undefined ? {} : { failed: c.failed }),
    })),
    ...(о.sections === undefined
      ? {}
      : {
          sections: о.sections
            .filter((s) => (s.rows ?? []).length > 0)
            .map((s) => ({
              id: String(s.id ?? "лист"),
              title: String(s.title ?? ""),
              purpose: String(s.purpose ?? ""),
              columns: (s.columns ?? []).map(String),
              rows: (s.rows ?? []).map((r) => r.map(String)),
            })),
        }),
  };
}

function системный(platform: Platform, bundle: string, capability: string): string {
  const роль = platform.roster.find(capability);
  const каркас = роль?.requiredSections ?? [];

  return [
    `Ты ${роль?.role ?? capability} по имени ${роль?.person ?? capability}.`,
    "",
    "У ТЕБЯ ЕСТЬ ИНСТРУМЕНТЫ, И МАТЕРИАЛ ТЫ ДОБЫВАЕШЬ САМ.",
    "Не догадывайся о содержимом документов — прочитай их. Не оценивай сходимость",
    "на глаз — пересчитай. Не предполагай, что за шифром — подними норматив.",
    "",
    "Вывод, сделанный без чтения того, о чём он, ничем не отличается от догадки,",
    "а догадка в заключении дороже отсутствия вывода.",
    "",
    "НОМЕР ПОЗИЦИИ В ЗАМЕЧАНИИ — ЭТО ССЫЛКА, А НЕ ФОРМАЛЬНОСТЬ.",
    "В поле impactOrdinal ставь порядковый номер позиции, О КОТОРОЙ замечание.",
    "Если замечание об объекте или комплекте в целом — оставь поле ПУСТОЙ СТРОКОЙ.",
    "",
    "По этому номеру система находит строку в книге и показывает её на встрече.",
    "Номер «на всякий случай» приведёт читателя не туда, и выдуманная ссылка",
    "хуже отсутствующей: она обещает след и не приводит никуда.",
    "",
    каркасом(каркас),
    "",
    `Бандл роли: ${bundle}.`,
  ]
    .filter((s) => s !== "")
    .join("\n");
}

function каркасом(каркас: readonly { id: string; title: string; why: string }[]): string {
  if (каркас.length === 0) return "";

  return [
    "ЛИСТЫ, ОБЯЗАТЕЛЬНЫЕ ПРИ ЛЮБОМ ОБЪЕКТЕ (это твоя роль, а не предмет):",
    ...каркас.map((s) => `  · id «${s.id}» — ${s.title}: ${s.why}`),
  ].join("\n");
}

/** Документные агенты агентного режима. */
export function buildAgenticReviewers(
  platform: Platform,
  tenantId: string,
  now: string,
): (collected: CollectedDuringCheck) => readonly DocumentReviewer[] {
  return (collected) =>
    РОЛИ_ДОКУМЕНТА.map((роль) => ({
      capability: роль.capability,
      review: async (document): Promise<DocumentReview> => {
        const tools = buildAgentTools(источники(platform, collected));
        const итог = await runAgentLoop({
          systemPrompt: системный(platform, роль.bundle, роль.capability),
          task: `${роль.задача}\n\nДокумент: ${document.path.split("/").pop()}`,
          tools,
          schema: AGENT_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
          maxSteps: ПОТОЛОК_ШАГОВ,
          runtime: рантаймЦикла(
            platform,
            tenantId,
            now,
            `agentic-${роль.bundle}`,
            entitiesOf(document.path),
            collected.documentHashes[0]?.contentHash ?? "соль",
          ),
        });

        return кОбзору(
          итог.output,
          итог.toolCalls,
          итог.steps,
          итог.exhausted,
          координаты(collected, document.path),
        );
      },
    }));
}

/** Объектные агенты агентного режима. */
export function buildAgenticObjectReviewers(
  platform: Platform,
  tenantId: string,
  now: string,
): (collected: CollectedDuringCheck) => readonly ObjectReviewer[] {
  return (collected) =>
    РОЛИ_ОБЪЕКТА.map((роль) => ({
      capability: роль.capability,
      review: async (context): Promise<DocumentReview> => {
        const tools = buildAgentTools(источники(platform, collected));
        const итог = await runAgentLoop({
          systemPrompt: системный(platform, роль.bundle, роль.capability),
          task: `${роль.задача}\n\nОбъект: ${context.objectPath.split("/").pop()}`,
          tools,
          schema: AGENT_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
          maxSteps: ПОТОЛОК_ШАГОВ,
          runtime: рантаймЦикла(
            platform,
            tenantId,
            now,
            `agentic-${роль.bundle}`,
            entitiesOf(context.objectPath),
            collected.documentHashes[0]?.contentHash ?? "соль",
          ),
        });

        // У объектного агента позиции приходят из РАЗНЫХ смет: документ не
        // ограничивается, а файл берётся у самой позиции.
        return кОбзору(итог.output, итог.toolCalls, итог.steps, итог.exhausted, координаты(collected, undefined));
      },
    }));
}
