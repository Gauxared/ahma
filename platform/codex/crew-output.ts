/**
 * Форма ответа роли экипажа и её приведение к заключению (spec-demo-stage-1 А7).
 *
 * СХЕМА ОДНА НА ВСЕ РОЛИ (ADR-V3-008): роли различаются предметом, не формой.
 * Схема по строгим правилам Responses API — все поля обязательны,
 * `additionalProperties: false`; отсутствие выражается пустой строкой, нулём
 * или пустым списком, а не пропуском ключа.
 *
 * ПОЧЕМУ НЕ `AGENT_OUTPUT_SCHEMA` КОНВЕЙЕРА. Та схема привязывает находку к
 * ПОРЯДКОВОМУ НОМЕРУ позиции одной сметы: агент конвейера смотрит один документ.
 * Роль экипажа смотрит все сметы объекта из одного треда и называет находку
 * ФАЙЛОМ И СТРОКОЙ ЛИСТА — тем, что она сама прочла в TSV рабочей папки. Плюс в
 * образце у каждого документа есть то, чего у конвейера нет: резюме в четыре
 * строки, передачи смежникам, допущения, алерты. Это и есть разница формы.
 *
 * ССЫЛКА И СУММА — РАЗНОЕ, и здесь это правило то же, что в конвейере (Т9.5а):
 * ссылка появляется, когда строка нашлась в разобранных данных; сумма влияния
 * подставляется ИЗ РАЗОБРАННОЙ СТРОКИ, а не из ответа модели (ADR-V3-010). Сумму,
 * которую роль назвала без строки, не выбрасываем — она уходит в основание
 * словом «по оценке роли», чтобы читатель видел, что это оценка, а не факт.
 */
import type { Sha256, SourceRef } from "@contracts/index.js";
import type {
  DocumentReview,
  ReviewFinding,
  ReviewSection,
  ReviewToolCall,
} from "@modules/workflow/check-object.js";

import { cellNumber } from "@modules/documents/cell-number.js";
import { isTotalRow } from "@modules/documents/total-row.js";
import { raiseVerdictColour } from "@modules/agents/verdict-colour.js";

import type { CollectedDuringCheck, ExtractedRow } from "../execution/check-ports.js";
import type { RoleTurn } from "./codex-client.js";

const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;

const HANDOFF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["to", "subject", "disputed", "needed"],
  properties: {
    /** Имя роли-адресата: Ваныч, Марина, Артемий… */
    to: { type: "string" },
    /** Предмет передачи с цифрой и обоснованием. */
    subject: { type: "string" },
    /** Спорная или непокрытая зона с ⚠/❌; пусто — нет. */
    disputed: { type: "string" },
    /** Что сделать и к какому сроку. */
    needed: { type: "string" },
  },
} as const;

const SECTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "purpose", "columns", "rows"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    purpose: { type: "string" },
    columns: { type: "array", items: { type: "string" } },
    rows: { type: "array", items: { type: "array", items: { type: "string" } } },
  },
} as const;

const OPEN_QUESTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["question", "owner", "dueBy"],
  properties: {
    question: { type: "string" },
    owner: { type: "string" },
    dueBy: { type: "string" },
  },
} as const;

export const CREW_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "verdict",
    "summary",
    "findings",
    "positions",
    "sections",
    "openQuestions",
    "handoffs",
    "returns",
    "assumptions",
    "alerts",
    "nextTakt",
    "lesson",
  ],
  properties: {
    /** Вердикт 🟢🟡🔴 одной фразой. */
    verdict: { type: "string" },
    /** «ЗАКЛЮЧЕНИЕ — 4 СТРОКИ», каждая с рублёвым эффектом. */
    summary: { type: "array", items: { type: "string" } },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "statement", "basis", "document", "row", "impactRub", "sourceStatus"],
        properties: {
          severity: { type: "string", enum: [...SEVERITIES] },
          statement: { type: "string" },
          basis: { type: "string" },
          /** Имя файла из ОБЪЕКТ.md; пусто — находка об объекте целиком. */
          document: { type: "string" },
          /** Номер строки листа из колонки «строка» TSV; 0 — строки нет. */
          row: { type: "integer" },
          /** Сумма под угрозой, десятичная строка рублей; пусто — не определена. */
          impactRub: { type: "string" },
          sourceStatus: { type: "string", enum: ["факт", "предположение", "неизвестное"] },
        },
      },
    },
    /**
     * ПОЗИЦИИ ИЗ ДОКУМЕНТА, КОТОРЫЙ РАЗБОР ФОРМЫ НЕ ЗНАЕТ — Т11.
     *
     * Заполняется, когда в документе есть строки с объёмом или ценой, а формы
     * 421/пр в нём нет: калькуляция своей вёрстки, ведомость объёмов, смета
     * контракта по 44-ФЗ, спецификация в PDF, таблица в Word.
     *
     * Эти позиции считаются НАРАВНЕ с разобранными — в сходимости, в гейтах, в
     * дублях, — и помечаются уровнем доверия `agent_normalized`: структуру
     * назвала роль, значения взяты из документа.
     *
     * Пустой список — законный ответ: в документе позиций нет. Выдумывать
     * строку нельзя, отсутствие честнее.
     */
    positions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["document", "sheet", "row", "ordinal", "section", "name", "code", "unit", "quantity", "amountRub"],
        properties: {
          /** Имя файла из ОБЪЕКТ.md — по нему позиция привязывается к документу. */
          document: { type: "string" },
          /** Лист книги или номер страницы PDF. Пусто — источник одностраничный. */
          sheet: { type: "string" },
          /** Номер строки листа. 0 — строки назвать нельзя, и позиция не пойдёт в дубли. */
          row: { type: "integer" },
          ordinal: { type: "string" },
          section: { type: "string" },
          name: { type: "string" },
          /** Обоснование как записано в документе: шифр ГЭСН/ФСБЦ или пусто. */
          code: { type: "string" },
          unit: { type: "string" },
          /** Десятичная строка. Пусто — объём в документе не указан. */
          quantity: { type: "string" },
          /** Десятичная строка рублей. ПУСТО — суммы нет; ноль сюда ставить нельзя. */
          amountRub: { type: "string" },
        },
      },
    },
    sections: { type: "array", items: SECTION_SCHEMA },
    openQuestions: { type: "array", items: OPEN_QUESTION_SCHEMA },
    handoffs: { type: "array", items: HANDOFF_SCHEMA },
    /**
     * ВОЗВРАТ РАБОТЫ СМЕЖНИКУ — механизм 2 образца, которого у нас не было.
     *
     * В эталонной системе это ОТДЕЛЬНАЯ ОПЕРАЦИЯ с жёсткой формулой: «Не
     * принимаю. Не хватает [конкретно]. Срок — [дата]», и в пакете она
     * встречается документом. Ядро р.4 требует того же: слабый ответ
     * возвращается, а не принимается «чтобы не спорить».
     *
     * ЗАМЕРЕНО 08.09.2026: за прогон роли выдали 59 блоков смежникам и НОЛЬ
     * возвратов. Причина не в ролях — возврат было НЕЧЕМ ВЫРАЗИТЬ: в схеме
     * есть «блок для смежника» (что передаю дальше) и нет «не принимаю» (что
     * возвращаю назад). Это разные операции: блок движет работу вперёд,
     * возврат останавливает и требует переделки.
     */
    returns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["to", "notAccepted", "missing", "dueBy"],
        properties: {
          to: { type: "string" },
          notAccepted: { type: "string" },
          missing: { type: "string" },
          dueBy: { type: "string" },
        },
      },
    },
    assumptions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["assumption", "verification"],
        properties: {
          assumption: { type: "string" },
          /** Чем и когда подтверждается. */
          verification: { type: "string" },
        },
      },
    },
    alerts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["situation", "moneyEffect", "document", "decision"],
        properties: {
          situation: { type: "string" },
          moneyEffect: { type: "string" },
          document: { type: "string" },
          /** Какое решение нужно от Артемия. */
          decision: { type: "string" },
        },
      },
    },
    /** «СЛЕДУЮЩИЙ ТАКТ» одной строкой. */
    nextTakt: { type: "string" },
    /**
     * УРОК ЭТОГО ОБЪЕКТА — кандидат в дельту роли (Ядро р.5, накопитель уроков).
     *
     * В эталонной системе у каждой роли есть накопитель приёмов, снятых с
     * боевых объектов: у сметчика их 41, и растут они после ретроспективы —
     * «Л-9: строка по ₽/м² скрывает физику, разверни её в поштучную ВОР».
     * Файл `deltas.md` у нас есть, читается и входит в отпечаток прогона; чего
     * не было — ПРЕДЛОЖЕНИЯ: урок писал только человек, а роль, встретившая на
     * объекте новый приём, уносила его с собой.
     *
     * Это ПРЕДЛОЖЕНИЕ, а не запись: дельта меняет ответы роли на всех будущих
     * объектах, и принимать её автоматически значило бы дать одному прогону
     * право переписать правила для всех. Урок доезжает до человека листом
     * документа и ждёт решения.
     *
     * Пусто — законный ответ: объект не научил ничему новому.
     */
    lesson: { type: "string" },
  },
} as const;

/** Ответ Дирижёра: ШАГИ 1–5 ЧАСТИ 3 его промпта (spec-demo-stage-1 А4). */
export const DISPATCHER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["passport", "route", "why", "decision", "reload", "handoffs", "whatNext"],
  properties: {
    passport: {
      type: "object",
      additionalProperties: false,
      required: ["domain", "side", "stage", "data", "goal"],
      properties: {
        domain: { type: "string" },
        side: { type: "string" },
        stage: { type: "string" },
        data: { type: "string" },
        goal: { type: "string" },
      },
    },
    route: { type: "string" },
    why: { type: "string" },
    decision: { type: "string", enum: ["маршрут", "гейт"] },
    reload: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["what", "why", "from", "dueBy"],
        properties: {
          what: { type: "string" },
          why: { type: "string" },
          from: { type: "string" },
          dueBy: { type: "string" },
        },
      },
    },
    handoffs: { type: "array", items: HANDOFF_SCHEMA },
    whatNext: { type: "string" },
  },
} as const;

/** Открытый вопрос — зеркало формы обхода: вопрос, владелец, срок. */
export interface OpenQuestion {
  readonly question: string;
  readonly owner: string;
  readonly dueBy: string;
}

export interface Handoff {
  readonly to: string;
  readonly subject: string;
  readonly disputed: string;
  readonly needed: string;
}

export interface CrewFinding {
  readonly severity: string;
  readonly statement: string;
  readonly basis: string;
  readonly document: string;
  readonly row: number;
  readonly impactRub: string;
  readonly sourceStatus: string;
}

/** Позиция, нормализованная ролью из документа вне формы 421/пр (Т11). */
export interface CrewPosition {
  readonly document: string;
  readonly sheet: string;
  readonly row: number;
  readonly ordinal: string;
  readonly section: string;
  readonly name: string;
  readonly code: string;
  readonly unit: string;
  readonly quantity: string;
  /** Пусто — суммы в документе нет. Ноль сюда не ставится (ТЗ §9). */
  readonly amountRub: string;
}

/** Возврат работы смежнику: «не принимаю, не хватает X, срок Y». */
export interface CrewReturn {
  readonly to: string;
  readonly notAccepted: string;
  readonly missing: string;
  readonly dueBy: string;
}

export interface CrewOutput {
  readonly verdict: string;
  readonly summary: readonly string[];
  readonly findings: readonly CrewFinding[];
  readonly positions: readonly CrewPosition[];
  readonly sections: readonly ReviewSection[];
  readonly openQuestions: readonly OpenQuestion[];
  readonly handoffs: readonly Handoff[];
  readonly returns: readonly CrewReturn[];
  readonly assumptions: readonly { readonly assumption: string; readonly verification: string }[];
  readonly alerts: readonly {
    readonly situation: string;
    readonly moneyEffect: string;
    readonly document: string;
    readonly decision: string;
  }[];
  readonly nextTakt: string;
  /** Урок объекта — кандидат в дельту роли; пусто, если объект не научил новому. */
  readonly lesson: string;
}

export interface DispatcherOutput {
  readonly passport: {
    readonly domain: string;
    readonly side: string;
    readonly stage: string;
    readonly data: string;
    readonly goal: string;
  };
  readonly route: string;
  readonly why: string;
  readonly decision: "маршрут" | "гейт";
  readonly reload: readonly { readonly what: string; readonly why: string; readonly from: string; readonly dueBy: string }[];
  readonly handoffs: readonly Handoff[];
  readonly whatNext: string;
}

const str = (value: unknown): string => (typeof value === "string" ? value : value === undefined || value === null ? "" : String(value));
const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const rec = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

function handoffs(value: unknown): Handoff[] {
  return list(value)
    .map(rec)
    .map((h) => ({ to: str(h["to"]).trim(), subject: str(h["subject"]), disputed: str(h["disputed"]), needed: str(h["needed"]) }))
    .filter((h) => h.to !== "" && (h.subject !== "" || h.needed !== ""));
}

/**
 * Разбор ответа — СНИСХОДИТЕЛЬНЫЙ. Схема обещает форму, но провайдер может
 * вернуть не всё; отказ роли из-за пропущенного поля был бы отказом там, где
 * есть содержание. Пропущенное становится пустым, и пустота видна на экране.
 */
export function parseCrewOutput(raw: unknown): CrewOutput {
  const o = rec(raw);

  return {
    verdict: str(o["verdict"]).trim(),
    summary: list(o["summary"]).map(str).filter((s) => s.trim() !== ""),
    findings: list(o["findings"])
      .map(rec)
      .map((f) => ({
        severity: SEVERITIES.includes(str(f["severity"]) as (typeof SEVERITIES)[number]) ? str(f["severity"]) : "medium",
        statement: str(f["statement"]),
        basis: str(f["basis"]),
        document: str(f["document"]).trim(),
        row: Number.isInteger(f["row"]) ? (f["row"] as number) : Number.parseInt(str(f["row"]), 10) || 0,
        impactRub: str(f["impactRub"]).trim(),
        sourceStatus: str(f["sourceStatus"]) || "предположение",
      }))
      .filter((f) => f.statement.trim() !== ""),
    /**
     * ПОЗИЦИЯ БЕЗ ИМЕНИ ИЛИ БЕЗ ДОКУМЕНТА НЕ БЕРЁТСЯ. Она пойдёт в сходимость
     * наравне с разобранной, поэтому строка, которую не к чему привязать, здесь
     * опаснее её отсутствия: посчитается, а показать будет нечего.
     */
    positions: list(o["positions"])
      .map(rec)
      .map((p) => ({
        document: str(p["document"]).trim(),
        sheet: str(p["sheet"]).trim(),
        row: Number.isInteger(p["row"]) ? (p["row"] as number) : Number.parseInt(str(p["row"]), 10) || 0,
        ordinal: str(p["ordinal"]).trim(),
        section: str(p["section"]).trim(),
        name: str(p["name"]).trim(),
        code: str(p["code"]).trim(),
        unit: str(p["unit"]).trim(),
        quantity: str(p["quantity"]).trim(),
        amountRub: str(p["amountRub"]).trim(),
      }))
      .filter((p) => p.name !== "" && p.document !== ""),
    sections: list(o["sections"])
      .map(rec)
      .map((s) => ({
        id: str(s["id"]).trim() || "лист",
        title: str(s["title"]),
        purpose: str(s["purpose"]),
        columns: list(s["columns"]).map(str),
        rows: list(s["rows"]).map((r) => list(r).map(str)),
      }))
      .filter((s) => s.rows.length > 0),
    openQuestions: list(o["openQuestions"])
      .map(rec)
      .map((q) => ({ question: str(q["question"]), owner: str(q["owner"]), dueBy: str(q["dueBy"]) }))
      .filter((q) => q.question.trim() !== ""),
    handoffs: handoffs(o["handoffs"]),
    /**
     * Возврат без адресата или без «чего не хватает» неисполним: первый некому
     * исполнять, второй нечем. Такой отбрасывается — он был бы не требованием,
     * а недовольством.
     */
    returns: list(o["returns"])
      .map(rec)
      .map((r) => ({
        to: str(r["to"]).trim(),
        notAccepted: str(r["notAccepted"]).trim(),
        missing: str(r["missing"]).trim(),
        dueBy: str(r["dueBy"]).trim() || "до конца такта",
      }))
      .filter((r) => r.to !== "" && r.missing !== ""),
    assumptions: list(o["assumptions"])
      .map(rec)
      .map((a) => ({ assumption: str(a["assumption"]), verification: str(a["verification"]) }))
      .filter((a) => a.assumption.trim() !== ""),
    alerts: list(o["alerts"])
      .map(rec)
      .map((a) => ({
        situation: str(a["situation"]),
        moneyEffect: str(a["moneyEffect"]),
        document: str(a["document"]),
        decision: str(a["decision"]),
      }))
      .filter((a) => a.situation.trim() !== ""),
    // Роль часто повторяет подпись поля в его значении — «СЛЕДУЮЩИЙ ТАКТ: …»;
    // в вердикте подпись ставит оболочка, и дважды она не нужна.
    nextTakt: str(o["nextTakt"]).trim().replace(/^следующий такт\s*[:—-]\s*/iu, ""),
    lesson: str(o["lesson"]).trim(),
  };
}

export function parseDispatcherOutput(raw: unknown): DispatcherOutput {
  const o = rec(raw);
  const p = rec(o["passport"]);

  return {
    passport: {
      domain: str(p["domain"]) || "❌",
      side: str(p["side"]) || "❌",
      stage: str(p["stage"]) || "❌",
      data: str(p["data"]) || "❌",
      goal: str(p["goal"]) || "❌",
    },
    route: str(o["route"]),
    why: str(o["why"]),
    decision: str(o["decision"]) === "гейт" ? "гейт" : "маршрут",
    reload: list(o["reload"])
      .map(rec)
      .map((r) => ({ what: str(r["what"]), why: str(r["why"]), from: str(r["from"]), dueBy: str(r["dueBy"]) }))
      .filter((r) => r.what.trim() !== ""),
    handoffs: handoffs(o["handoffs"]),
    whatNext: str(o["whatNext"]),
  };
}

/**
 * Координаты строк для ссылок находок: файл → строка листа → сумма.
 *
 * Строится по накопителю обхода. Ключ поиска — имя файла, потому что роль
 * называет документ так, как увидела его в ОБЪЕКТ.md, а не абсолютным путём.
 */
export interface CoordinateIndex {
  /** Разобранный документ по имени, пути или подстроке имени. */
  readonly resolve: (document: string) => { readonly path: string; readonly contentHash: Sha256 } | undefined;
  /** Сумма строки листа, если позиция с такой строкой извлечена. */
  readonly amountAt: (path: string, row: number) => { readonly known: boolean; readonly amount: string | undefined };
}

export function buildCoordinateIndex(collected: CollectedDuringCheck): CoordinateIndex {
  const rows = new Map<string, Map<number, string | undefined>>();

  for (const row of collected.extracted) {
    if (row.sourceRow <= 0) continue;
    const perDocument = rows.get(row.document) ?? new Map<number, string | undefined>();
    perDocument.set(row.sourceRow, row.amount);
    rows.set(row.document, perDocument);
  }

  /**
   * УКАЗАТЕЛЬ ЗНАЕТ ВСЕ ДОКУМЕНТЫ ПАРТИИ, А НЕ ТОЛЬКО РАЗОБРАННЫЕ СМЕТЫ.
   *
   * ЗАМЕРЕНО НА ПРОГОНЕ 15 (08.09.2026): роли вернули 136 позиций из сметы
   * контракта, ведомости объёмов и обоснования НМЦК — и НИ ОДНА не дошла до
   * системы. `documentHashes` пополняется только при удачном разборе формы
   * 421/пр; у Дагестана таких смет нет вовсе, поэтому список был пуст, а
   * `resolve` возвращал `undefined` на любое имя.
   *
   * То есть отбор, написанный ради честности («позицию, которую не к чему
   * привязать, не берём»), давал ГАРАНТИРОВАННЫЙ НОЛЬ ровно в том случае, ради
   * которого Т11 и заведено. Молча: роль отработала, файл записан, счёт пуст.
   *
   * Дескрипторы заводит обход на КАЖДЫЙ обойдённый файл — их и берём. Ложной
   * координаты это не создаёт: `amountAt` по-прежнему отвечает «строка
   * неизвестна» там, где разбора не было.
   */
  const byPath = new Map<string, { path: string; contentHash: Sha256 }>();

  for (const document of [...collected.descriptors, ...collected.documentHashes]) {
    byPath.set(document.path, { path: document.path, contentHash: document.contentHash as Sha256 });
  }

  const documents = [...byPath.values()].map((d) => ({
    path: d.path,
    name: (d.path.split("/").pop() ?? d.path).toLowerCase(),
    contentHash: d.contentHash,
  }));

  return {
    resolve: (document) => {
      const wanted = document.trim().toLowerCase();
      if (wanted === "") return undefined;
      const found =
        documents.find((d) => d.path.toLowerCase() === wanted || d.name === wanted) ??
        documents.find((d) => d.name.includes(wanted) || wanted.includes(d.name));
      return found === undefined ? undefined : { path: found.path, contentHash: found.contentHash };
    },
    amountAt: (path, row) => {
      const perDocument = rows.get(path);
      if (perDocument === undefined || !perDocument.has(row)) return { known: false, amount: undefined };
      return { known: true, amount: perDocument.get(row) };
    },
  };
}

/** Отпечаток FNV-1a — тот же, что в цикле конвейера: короткий и без зависимостей. */
function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Команды и поиски роли — в цепочку доказательности (Т9.4). */
export function traceOf(turn: RoleTurn): ReviewToolCall[] {
  return [
    ...turn.commands.map((c) => ({
      tool: "shell",
      arguments: c.command.length > 600 ? `${c.command.slice(0, 600)}…` : c.command,
      resultChars: c.output.length,
      resultDigest: digest(c.output),
      ...(c.exitCode === undefined || c.exitCode === 0 ? {} : { failed: `код выхода ${c.exitCode}` }),
    })),
    ...turn.searches.map((q) => ({ tool: "web_search", arguments: q, resultChars: 0, resultDigest: digest(q) })),
    ...turn.errors.map((e) => ({ tool: "codex", arguments: "", resultChars: 0, resultDigest: digest(e), failed: e })),
    // Вызовы субагентов — тоже след (А12): кого позвали, что передали, что ответили.
    ...turn.collab.map((c) => {
      const replies = c.states.map((st) => `${st.status}: ${st.message}`).join(" | ");
      return {
        tool: c.tool,
        arguments: c.prompt.length > 600 ? `${c.prompt.slice(0, 600)}…` : c.prompt,
        resultChars: replies.length,
        resultDigest: digest(replies),
      };
    }),
  ];
}

/** Эталонная рамка блока передачи — как в каждом из девяти промптов образца. */
export function renderHandoff(from: string, handoff: Handoff): string {
  const lines = [handoff.subject.trim()];
  if (handoff.disputed.trim() !== "") lines.push(`Спорная зона: ${handoff.disputed.trim()}`);
  if (handoff.needed.trim() !== "") lines.push(`Нужно: ${handoff.needed.trim()}`);

  return [
    `▸ БЛОК ДЛЯ ${handoff.to.toUpperCase()} (от: ${from}) ───────────────────────────`,
    ...lines.filter((line) => line !== ""),
    "─────────────────────────────────────────────",
  ].join("\n");
}

/** Раздел заключения Настеньки с итогом Дирижёра (А4). */
export function dispatcherSection(d: DispatcherOutput): ReviewSection {
  const rows: string[][] = [
    ["Домен объекта", d.passport.domain],
    ["Сторона стола", d.passport.side],
    ["Стадия", d.passport.stage],
    ["Состав и объём данных", d.passport.data],
    ["Срок и цель", d.passport.goal],
    ["Маршрут", d.route === "" ? "—" : d.route],
    ["Почему", d.why === "" ? "—" : d.why],
    ["Решение", d.decision === "гейт" ? "ГЕЙТ: данных для честного маршрута не хватает; прогон продолжен в режиме допущений" : "маршрут выдан"],
    ...d.reload.map((r) => ["Дозагрузить", `${r.what} — ${r.why}; от: ${r.from}; срок: ${r.dueBy}`]),
    ["Что дальше", d.whatNext === "" ? "—" : d.whatNext],
  ];

  return {
    id: "dispatcher_route",
    title: "Приём входа Дирижёром: паспорт, маршрут, гейт",
    purpose: "ШАГИ 1–5 Дирижёра v9.8: чем является вход, куда он направлен и чего в нём не хватает",
    columns: ["Поле", "Значение"],
    rows,
  };
}

/** Пункты дозагрузки Дирижёра — открытыми вопросами с адресатом и сроком. */
export function reloadAsQuestions(d: DispatcherOutput): OpenQuestion[] {
  return d.reload.map((r) => ({
    question: `Дозагрузить: ${r.what} — ${r.why}`,
    owner: r.from === "" ? "владелец объекта" : r.from,
    dueBy: r.dueBy === "" ? "до такта 1" : r.dueBy,
  }));
}

/** Что вышло из позиций роли: строки в счёт и пересказ уже разобранного. */
export interface NormalizedPositions {
  readonly rows: readonly ExtractedRow[];
  /** Строки, которые код уже разобрал: роль переписала их вторым способом. */
  readonly alreadyCounted: readonly string[];
  /** Числа, записанные так, что понять их нельзя: остались «не определено». */
  readonly unreadableNumbers: readonly string[];
}

/**
 * ЧИСЛО ОТ РОЛИ → КАНОНИЧЕСКАЯ ДЕСЯТИЧНАЯ СТРОКА, ИЛИ НИЧЕГО.
 *
 * ЧЕМ ЭТО ВЫЗВАНО. Позиции Т11 приходят из модели строкой, и модель пишет число
 * так, как оно стояло в документе: «1 234 567,89», «3187750,00 ₽», «72 359.55».
 * Дальше эта строка идёт наравне с разобранной — в своды, в гейты, в
 * сортировки. А там она:
 *
 *  · в `Number("1 234,56")` даёт NaN, и сравнение «NaN > порога» — ЛОЖЬ. То
 *    есть позиция на полтора миллиона молча читается как «порог не превышен»,
 *    и требование трёх коммерческих предложений снимается само собой;
 *  · в `decimal()` бросает TypeError на границе записи — то есть роняет то, что
 *    её вызовет.
 *
 * Обе беды тихие и обе денежные. Поэтому число разбирается ЗДЕСЬ, на входе.
 *
 * РАЗБИРАЕТ ЕГО `cellNumber` — ТОТ ЖЕ КОД, ЧТО ЧИТАЕТ ЯЧЕЙКИ КНИГ.
 *
 * Сначала здесь стояла своя реализация тех же правил, и это была ошибка ровно
 * того рода, о которой предупреждает сам `cell-number.ts`: правило, записанное
 * дважды, расходится молча. Роль и разбор формы 421/пр обязаны читать
 * «1,500» одинаково — иначе одна и та же смета даст разные числа в зависимости
 * от того, кто её прочёл.
 *
 * Здесь остаётся только то, чего в ячейке книги не бывает: знак валюты. Модель
 * пишет «403000 ₽» и «15000,00 руб.», потому что так стояло в тексте.
 *
 * ЧТО НЕ ПРИНИМАЕТСЯ: «≈3,2 млн», «от 100 до 200», «н/д». Такое число не
 * угадывается — остаётся ПУСТЫМ, то есть «не определено» (ТЗ §9), и уходит
 * в список непрочитанных, а не подставляется нулём.
 */
export function числоРоли(raw: string): string | undefined {
  const безВалюты = raw.trim().replace(/(?:₽|руб\.?|р\.)$/iu, "");

  return cellNumber(безВалюты);
}


/**
 * ПОЗИЦИИ РОЛИ → СТРОКИ НАКОПИТЕЛЯ ОБХОДА (Т11).
 *
 * Имя документа роль берёт из `ОБЪЕКТ.md`, поэтому оно разрешается тем же
 * указателем, что и координата находки. Позиция, чей документ не разрешился,
 * ОТБРАСЫВАЕТСЯ: она пошла бы в сходимость и в дубли, а показать её было бы
 * нечем — хуже, чем её отсутствие.
 *
 * Сумма пустая остаётся пустой. Ноль здесь сложился бы с настоящими суммами и
 * дал бы расхождение размером в стоимость объекта (ТЗ §9).
 */
export function toExtractedRows(output: CrewOutput, index: CoordinateIndex): NormalizedPositions {
  const rows: ExtractedRow[] = [];
  const alreadyCounted: string[] = [];
  const unreadableNumbers: string[] = [];

  for (const position of output.positions) {
    const document = index.resolve(position.document);

    /**
     * ЧИСЛА РОЛИ ПРИВОДЯТСЯ К КАНОНИЧЕСКОМУ ВИДУ ЗДЕСЬ, НА ВХОДЕ.
     *
     * Модель пишет число так, как оно стояло в документе: «1 234 567,89».
     * Дальше эта строка идёт наравне с разобранной — в своды, в сортировки, в
     * пороги. `Number("1 234,56")` даёт NaN, а «NaN > порога» — ложь: позиция
     * на полтора миллиона молча читается как «порог не превышен».
     *
     * Не разобралось — остаётся ПУСТЫМ, то есть «не определено», и попадает в
     * список непрочитанных. Ноль сложился бы с настоящими суммами.
     */
    const amount = числоРоли(position.amountRub);
    const quantity = числоРоли(position.quantity);

    if (position.amountRub !== "" && amount === undefined) {
      unreadableNumbers.push(`${position.document} строка ${position.row}: сумма «${position.amountRub}»`.slice(0, 200));
    }
    if (position.quantity !== "" && quantity === undefined) {
      unreadableNumbers.push(`${position.document} строка ${position.row}: количество «${position.quantity}»`.slice(0, 200));
    }

    /**
     * СТРОКА, УЖЕ РАЗОБРАННАЯ КОДОМ, ВТОРОЙ РАЗ НЕ СЧИТАЕТСЯ.
     *
     * С 08.09.2026 разобранная смета уходит роли И позициями, И текстом целиком
     * (Т10: удачный разбор терял больше, чем неудачный — вторые листы, расчёты
     * индексов, примечания). Плата за это — роль ВИДИТ строки формы 421/пр в
     * `документация/` и может добросовестно переписать их в `positions`.
     *
     * Тогда одна и та же работа встала бы в счёт дважды: в сходимость, в
     * межсметный дубль, в свод по деньгам. На объекте это не «неточность» —
     * это оплаченная дважды работа.
     *
     * Строка при этом НЕ теряется: она уже в системе, разобранная, с
     * координатой и с лучшим уровнем доверия, чем «назвала модель». Теряется
     * только её ВТОРАЯ копия — и не молча: пересказ уходит в заключение роли
     * отдельной находкой, чтобы человек видел, что роль дублировала разбор.
     */
    if (document !== undefined && position.row > 0 && index.amountAt(document.path, position.row).known) {
      alreadyCounted.push(`${position.document} строка ${position.row}: ${position.name}`.slice(0, 200));
      continue;
    }

    /**
     * ИМЯ НЕ РАЗРЕШИЛОСЬ — ПОЗИЦИЯ НЕ ВЫБРАСЫВАЕТСЯ МОЛЧА.
     *
     * Прежде здесь стоял `continue`, и он однажды съел 136 позиций разом. Урок
     * записан правилом: ворота на пути данных не отбрасывают, а ПОМЕЧАЮТ.
     *
     * Позицию, чей документ не найден в партии, привязать не к чему — записать
     * её в реестр позиций нельзя, там документ обязателен. Но исчезнуть она не
     * должна: имя, названное ролью, кладётся в поле документа как есть, и такая
     * строка видна и отделима. Кто её увидит, поймёт: роль назвала документ,
     * которого в партии нет, — и это находка, а не пустота.
     */
    if (document === undefined) {
      rows.push({
        document: `не найден в партии: ${position.document}`,
        ordinal: position.ordinal,
        section: position.section,
        sourceName: position.name,
        basis: position.code,
        unit: position.unit,
        ...(quantity === undefined ? {} : { quantity }),
        amount,
        sourceRow: position.row,
        acquisition: "agent_normalized",
        ...(position.sheet === "" ? {} : { sheet: position.sheet }),
        ...(isTotalRow(position.name) ? { total: true } : {}),
      });
      continue;
    }

    rows.push({
      document: document.path,
      ordinal: position.ordinal,
      section: position.section,
      sourceName: position.name,
      basis: position.code,
      unit: position.unit,
      ...(quantity === undefined ? {} : { quantity }),
      amount,
      sourceRow: position.row,
      acquisition: "agent_normalized",
      ...(position.sheet === "" ? {} : { sheet: position.sheet }),
      ...(isTotalRow(position.name) ? { total: true } : {}),
    });
  }

  return { rows, alreadyCounted, unreadableNumbers };
}

export interface ReviewAssembly {
  readonly output: CrewOutput;
  readonly turn: RoleTurn;
  readonly index: CoordinateIndex;
  /** «эталон» — полный промпт образца; «доктрина» — сокращённый prompt.md. */
  readonly promptSource: "эталон" | "доктрина";
  readonly provider: string;
  readonly model: string;
  readonly checkedAt: string;
}

/**
 * Ответ роли → заключение той же формы, что у конвейера.
 *
 * Экран, пакет и выгрузки получают `DocumentReview` и не знают, чем он сделан.
 * Именно поэтому новый путь не требует ни одной правки в них.
 */
export function toDocumentReview(input: ReviewAssembly): DocumentReview {
  const { output, turn, index } = input;
  const checkedAt = input.checkedAt.slice(0, 10) as never;

  const findings: ReviewFinding[] = output.findings.map((f) => {
    const document = f.document === "" ? undefined : index.resolve(f.document);
    const coordinate = document !== undefined && f.row > 0 ? index.amountAt(document.path, f.row) : undefined;

    const source: SourceRef | undefined =
      document === undefined || coordinate === undefined || !coordinate.known
        ? undefined
        : {
            sourceId: document.path,
            contentHash: document.contentHash,
            locator: { kind: "row", sheet: "ЛСР", row: f.row },
            status: f.sourceStatus === "факт" ? "fact" : "benchmark",
            acquisition: "parsed",
            checkedAt,
            staleAfterDays: 90,
          };

    /**
     * Сумма — из разобранной строки, когда строка нашлась. Названная ролью сумма
     * без строки не становится `impact`: она уходит в основание словом, чтобы
     * читатель видел оценку, а не факт (ADR-V3-010).
     */
    const parsedAmount = source === undefined ? undefined : coordinate?.amount;
    const basis =
      f.impactRub !== "" && parsedAmount === undefined
        ? `${f.basis}${f.basis.trim() === "" ? "" : " · "}сумма по оценке роли: ${f.impactRub} ₽ (⚠ без строки документа)`
        : f.basis;

    return {
      severity: f.severity,
      statement: f.statement,
      basis,
      ...(source === undefined ? {} : { source }),
      ...(source === undefined || parsedAmount === undefined
        ? {}
        : {
            impact: {
              value: { amount: parsedAmount as never, currency: "RUB" as never },
              provenance: { kind: "source" as const, ref: source },
            },
          }),
    };
  });

  // Алерты — находки высшего уровня: в образце алерт без денежного последствия
  // «не засчитывается», и здесь деньги стоят в основании словом.
  for (const alert of output.alerts) {
    findings.push({
      severity: "critical",
      statement: `🚨 АЛЕРТ: ${alert.situation}`,
      basis: [alert.document, alert.moneyEffect === "" ? "" : `денежный эффект: ${alert.moneyEffect}`, alert.decision === "" ? "" : `нужно решение Артемия: ${alert.decision}`]
        .filter((part) => part.trim() !== "")
        .join(" · "),
    });
  }

  const taken = new Set(output.sections.map((s) => s.id));
  const sections: ReviewSection[] = [...output.sections];

  // Служебные листы добавляются, только если роль не завела лист с тем же
  // идентификатором сама: у Тимофея `assumptions` — обязательный лист каркаса.
  if (output.summary.length > 0 && !taken.has("summary")) {
    sections.unshift({
      id: "summary",
      title: "Резюме — заключение",
      purpose: "четыре строки заключения, каждая с рублёвым эффектом (образец: лист 00_Резюме_Заключение)",
      columns: ["#", "Строка заключения"],
      rows: output.summary.map((line, i) => [String(i + 1), line]),
    });
  }

  if (output.assumptions.length > 0 && !taken.has("assumptions")) {
    sections.push({
      id: "assumptions",
      title: "Допущения",
      purpose: "что принято без документа и чем это подтверждается (Ядро р.7, Блок 5 Денчика)",
      columns: ["Допущение", "Чем и когда проверить"],
      rows: output.assumptions.map((a) => [a.assumption, a.verification]),
    });
  }

  if (output.handoffs.length > 0 && !taken.has("handoffs")) {
    sections.push({
      id: "handoffs",
      title: "Передачи смежникам",
      purpose: "БЛОК ДЛЯ каждого адресата — что несу дальше по конвейеру (образец: лист NN_Передачи_смежникам)",
      columns: ["Кому", "Что передано", "Спорное", "Что нужно и к какому сроку"],
      rows: output.handoffs.map((h) => [h.to, h.subject, h.disputed === "" ? "—" : h.disputed, h.needed === "" ? "—" : h.needed]),
    });
  }

  const tokens = turn.inputTokens + turn.outputTokens;
  const tail =
    `[след: ${turn.commands.length} команд, ${tokens} токенов` +
    (input.promptSource === "доктрина" ? ", БЕЗ ЭТАЛОННОГО ПРОМПТА" : "") +
    "]";
  // Цвет вердикта — по собственным находкам роли; правило общее с конвейером
  // (`modules/agents/verdict-colour.ts`), потому что беда у них одна.
  const verdict = raiseVerdictColour(
    output.verdict === "" ? "вердикт не выдан" : output.verdict,
    findings.map((f) => f.severity),
  );

  return {
    verdict: `${verdict}${output.nextTakt === "" ? "" : ` · СЛЕДУЮЩИЙ ТАКТ: ${output.nextTakt}`} ${tail}`,
    findings,
    openQuestions: [...output.openQuestions],
    sections,
    toolCalls: traceOf(turn),
    run: {
      ...(turn.threadId === undefined ? {} : { threadId: turn.threadId }),
      provider: input.provider,
      model: input.model,
      inputTokens: turn.inputTokens,
      outputTokens: turn.outputTokens,
    },
  };
}
