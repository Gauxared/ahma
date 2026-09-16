/**
 * Вердикт руководителя проекта — такт 4.
 *
 * Источники:
 *  · `workflow.md`, ТАКТ 4 — три цвета и обязательный примортем;
 *  · `Артемий_РП_v9.7.txt`, ЧАСТЬ 2 — пороги маржи от НМЦК;
 *  · ЧАСТЬ 4 — матрица рисков 5×5;
 *  · ЧАСТЬ 8, правило А-3 — «три условия входа» для жёлтого вердикта.
 *
 * ЧТО ЗДЕСЬ ЛУЧШЕ ОРИГИНАЛА
 *
 * Цвет вердикта в легаси ставит человек, прочитав отчёты восьми агентов. Он
 * может не заметить критическое замечание в середине третьего листа — и
 * поставить зелёный. Здесь цвет СЛЕДУЕТ из состояния: критическое замечание
 * или маржа ниже красной линии дают красный, и обойти это можно только изменив
 * состояние, а не мнение.
 *
 * ВЛИЯНИЕ ЗАМЕЧАНИЙ И МАРЖА НЕ СКЛАДЫВАЮТСЯ
 *
 * Маржа — то, что посчитано. Влияние замечаний — то, что МОЖЕТ произойти, если
 * замечание подтвердится. Сложить их значит выдать риск за факт и получить
 * число, которого нет ни в одном документе.
 *
 * УСЛОВИЕ БЕЗ ЦЕНЫ — НЕ УСЛОВИЕ
 *
 * Правило А-3 требует у каждого условия «цену вопроса». Условие без неё
 * откладывают: непонятно, чем рискуешь, пропустив его. Поэтому цена
 * обязательна в типе, а не желательна в инструкции.
 */
import { Decimal } from "decimal.js";

import { decimal } from "@contracts/index.js";
import type { DecimalString } from "@contracts/index.js";

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

/**
 * Пороги маржи от НМЦК, дословно из ЧАСТИ 2 промпта:
 * база 8–9% (цель) · оптимизм 10–12% · минимум 5–6% (красная линия) ·
 * ниже 5% = стоп-решение.
 */
export const MARGIN_THRESHOLDS = {
  stop: "0.05",
  minimum: "0.06",
  target: "0.08",
  optimistic: "0.10",
} as const;

export type MarginBand = "стоп" | "красная линия" | "минимум" | "цель" | "оптимизм";

/** Матрица 5×5 из ЧАСТИ 4: 1–4 приемлемо · 5–9 мониторинг · 10–15 меры · 16–25 СТОП. */
export function riskLevel(score: number): "приемлемо" | "мониторинг" | "меры" | "СТОП" {
  if (score <= 4) return "приемлемо";
  if (score <= 9) return "мониторинг";
  if (score <= 15) return "меры";
  return "СТОП";
}

export interface VerdictFinding {
  readonly severity: "critical" | "high" | "medium" | "info";
  readonly statement: string;
  readonly amount?: string;
}

export interface VerdictInput {
  /** НМЦК или цена договора: база для порогов маржи. */
  readonly contractAmount: string;
  readonly margin: string;
  readonly findings: readonly VerdictFinding[];
  /** Предметы протокола, оставшиеся неподтверждёнными. */
  readonly openSubjects: readonly string[];
}

export interface EntryCondition {
  readonly subject: string;
  readonly requirement: string;
  /** Цена вопроса: чем рискуем, если условие не закрыть. Обязательна (А-3). */
  readonly cost: string;
}

export interface Verdict {
  readonly color: "🟢" | "🟡" | "🔴";
  readonly headline: string;
  readonly margin: DecimalString;
  readonly marginShare: DecimalString;
  readonly marginBand: MarginBand;
  /** Сумма влияния замечаний. НЕ складывается с маржой. */
  readonly findingsImpact: DecimalString;
  readonly reasons: readonly string[];
  /** Условия входа для жёлтого вердикта. Каждое с ценой (А-3). */
  readonly conditions: readonly EntryCondition[];
  /** Примортем: обязателен перед вердиктом (workflow.md, ТАКТ 4). */
  readonly premortem: readonly string[];
}

function bandOf(share: Decimal): MarginBand {
  if (share.lessThan(new Decimal(MARGIN_THRESHOLDS.stop))) return "стоп";
  if (share.lessThan(new Decimal(MARGIN_THRESHOLDS.minimum))) return "красная линия";
  if (share.lessThan(new Decimal(MARGIN_THRESHOLDS.target))) return "минимум";
  if (share.lessThan(new Decimal(MARGIN_THRESHOLDS.optimistic))) return "цель";
  return "оптимизм";
}

/**
 * Примортем: «Мы на финише, риск реализовался. Как мы его пропустили?»
 *
 * Причины берутся из состояния прогона, а не из общего списка: примортем по
 * шаблону читают по диагонали, примортем по своим цифрам — нет.
 */
function premortemFor(input: VerdictInput, band: MarginBand): readonly string[] {
  const reasons: string[] = [];

  for (const finding of input.findings.filter((item) => item.severity === "critical")) {
    reasons.push(
      `${finding.statement} — подтвердилось на этапе исполнения, ` +
        `и цена вопроса ${finding.amount ?? "не оценена"} легла на нас`,
    );
  }

  for (const subject of input.openSubjects) {
    reasons.push(`предмет «${subject}» так и не закрыли, и это вскрылось на приёмке`);
  }

  if (band === "стоп" || band === "красная линия" || band === "минимум") {
    reasons.push(`маржа ${band} на старте: любое отклонение увело объект в убыток`);
  }

  // Три причины — минимум протокола. Общие добавляются, только если своих мало.
  const generic = [
    "объёмы приняли по смете, не сверив с проектом",
    "ключевую поставку заказали позже крайнего срока",
    "исполнительную документацию собрали в конце, а не по ходу",
  ];

  return [...reasons, ...generic].slice(0, Math.max(3, reasons.length));
}

export function buildVerdict(input: VerdictInput): Verdict {
  const contract = new Decimal(input.contractAmount);
  const margin = new Decimal(input.margin);

  const share = contract.isZero() ? new Decimal(0) : margin.dividedBy(contract);
  const band = bandOf(share);

  /**
   * ДЕНЬГИ СКЛАДЫВАЮТСЯ ТОЛЬКО У ТЕХ НАХОДОК, У КОТОРЫХ ОНИ ЕСТЬ.
   *
   * `?? "0"` здесь занижал итог МОЛЧА: находка без суммы — это «величина не
   * определена», а не «ущерб нулевой». Сложив их с настоящими, мы получали
   * число, которое выглядит полным и полным не является; читатель вердикта не
   * мог узнать, что за ним стоит половина находок без оценки.
   */
  const сСуммой = input.findings.filter((finding) => finding.amount !== undefined);
  const impact = сСуммой.reduce((sum, finding) => sum.plus(new Decimal(finding.amount!)), new Decimal(0));
  const безСуммы = input.findings.length - сСуммой.length;

  const critical = input.findings.filter((finding) => finding.severity === "critical");
  const reasons: string[] = [];

  for (const finding of critical) {
    reasons.push(`критическое замечание не закрыто: ${finding.statement}`);
  }

  if (band === "стоп") {
    reasons.push(
      `маржа ${share.times(100).toDecimalPlaces(2).toString()}% ниже красной линии ` +
        `${MARGIN_THRESHOLDS.stop} — стоп-решение по порогам НМЦК`,
    );
  }

  const conditions: EntryCondition[] = input.openSubjects.map((subject) => ({
    subject,
    requirement: `закрыть предмет «${subject}» до подписания`,
    // Цена берётся из замечаний по этому предмету, если они есть.
    cost:
      input.findings
        .filter((finding) => finding.statement.toLowerCase().includes(subject.split("-")[0] ?? ""))
        .map((finding) => finding.amount)
        .find((amount) => amount !== undefined) ?? "не оценена — оценить до подписания",
  }));

  for (const finding of input.findings.filter((item) => item.severity === "high")) {
    conditions.push({
      subject: finding.statement,
      requirement: `снять замечание «${finding.statement}» либо принять риск письменно`,
      cost: finding.amount ?? "не оценена — оценить до подписания",
    });
  }

  // Цвет СЛЕДУЕТ из состояния: критическое замечание или стоп-маржа дают
  // красный независимо от того, что думает читатель отчёта.
  const color = reasons.length > 0 ? "🔴" : conditions.length > 0 ? "🟡" : "🟢";

  return {
    color,
    headline:
      color === "🟢"
        ? "Старт разрешён: критических замечаний нет, маржа в пределах порогов"
        : color === "🟡"
          ? `Условный старт: ${conditions.length} условий входа до подписания`
          : `Стоп: ${reasons.length} оснований не начинать`,
    margin: decimal(margin.toFixed(2)),
    marginShare: decimal(share.toDecimalPlaces(4).toFixed(4)),
    marginBand: band,
    findingsImpact: decimal(impact.toFixed(2)),
    reasons,
    conditions,
    premortem: premortemFor(input, band),
  };
}
