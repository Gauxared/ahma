/**
 * Реестр нарушений — ТЗ §10, вторая из четырёх договорных выгрузок:
 *
 *   «Реестр нарушений (Excel) | Позиция, характер нарушения, сумма, основание,
 *    путь урегулирования»
 *
 * ПЯТЬ КОЛОНОК — ЭТО ПЯТЬ ОБЯЗАТЕЛЬСТВ
 *
 * ТЗ перечисляет их не ради вида таблицы. Нарушение без СУММЫ нельзя
 * приоритизировать: непонятно, стоит ли из-за него спорить. Без ОСНОВАНИЯ его
 * нельзя предъявить: подрядчик спросит «на каком пункте», и ответа не будет.
 * Без ПУТИ УРЕГУЛИРОВАНИЯ реестр остаётся списком претензий, с которым служба
 * заказчика не знает, что делать.
 *
 * Поэтому строка без любого из пяти полей в реестр НЕ ПОПАДАЕТ — она уходит в
 * отдельный список неполных находок. Выдать нарушение без основания значит
 * подставить того, кто пойдёт с ним к подрядчику.
 *
 * НЕПОЛНЫЕ НАХОДКИ НАЗЫВАЮТСЯ, А НЕ ВЫБРАСЫВАЮТСЯ
 *
 * §12.1в меряет ПОЛНОТУ реестра относительно ручного расчёта заказчика — не
 * менее 70%. Значит, потерянная находка стоит дороже лишней: лишнюю снимут на
 * разборе, потерянная не попадёт в измерение вовсе. Неполная находка остаётся
 * видимой, чтобы её дособрали, а не забыли.
 *
 * ПУСТОЙ РЕЕСТР — ЭТО УТВЕРЖДЕНИЕ
 *
 * Пустой лист читается как «нарушений нет». Если проверка не проводилась или
 * прошла частично, это ложь. Поэтому лист без строк несёт явную пометку о том,
 * что именно проверено.
 */
import { Decimal } from "decimal.js";

import { decimal, escapeFormulaInjection } from "@contracts/index.js";
import type { DecimalString } from "@contracts/index.js";

import type { Cell, CellStyle, WorkbookSpec } from "./calculation-workbook.js";

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export const VIOLATIONS_TEMPLATE_VERSION = "violations-register-1" as const;

/** Пять колонок §10 в порядке, объявленном ТЗ. */
const COLUMNS = [
  "Позиция",
  "Характер нарушения",
  "Сумма, ₽",
  "Основание",
  "Путь урегулирования",
  "Документ",
] as const;

const COLUMN_WIDTHS = [34, 30, 18, 46, 46, 28];

export interface Violation {
  readonly position: string;
  readonly kind: string;
  /** Пусто — сумма нарушения неизвестна: в смете нет стоимостной части. */
  readonly amount: string | undefined;
  readonly basis: string;
  readonly remedy: string;
  readonly document: string;
}

export interface IncompleteViolation {
  readonly position: string;
  /** Какие из обязательных полей пусты. */
  readonly missing: readonly string[];
}

export interface ViolationsRegister extends WorkbookSpec {
  /** Сумма по строкам, попавшим в реестр. Неполные находки в неё не входят. */
  readonly totalAmount: DecimalString;
  readonly incomplete: readonly IncompleteViolation[];
}

function text(value: string, style?: CellStyle): Cell {
  const base = { kind: "text" as const, value: escapeFormulaInjection(value) };
  return style === undefined ? base : { ...base, style };
}

function money(value: string, marker: string, style?: CellStyle): Cell {
  const base = {
    kind: "number" as const,
    value: decimal(new Decimal(value).toFixed(2)),
    marker,
  };
  return style === undefined ? base : { ...base, style };
}

/** Какие обязательные поля пусты. Порядок совпадает с порядком колонок §10. */
function missingFields(violation: Violation): string[] {
  const required: ReadonlyArray<readonly [string, string]> = [
    ["позиция", violation.position],
    ["характер нарушения", violation.kind],
    // Сумма, которой нет, — это НЕПОЛНОЕ нарушение, а не нарушение на ноль
    // рублей. Реестр уже умеет отделять неполные и предъявлять их отдельно:
    // смета без стоимостной части попадает ровно в этот механизм.
    ["сумма", violation.amount ?? ""],
    ["основание", violation.basis],
    ["путь урегулирования", violation.remedy],
  ];

  return required.filter(([, value]) => value.trim() === "").map(([name]) => name);
}

export function buildViolationsRegister(input: {
  readonly objectName: string;
  readonly violations: readonly Violation[];
  readonly generatorVersion?: string;
  readonly producedAt?: string;
  readonly artifactId?: string;
}): ViolationsRegister {
  const complete: (Violation & { amount: string })[] = [];
  const incomplete: IncompleteViolation[] = [];

  for (const violation of input.violations) {
    const missing = missingFields(violation);
    if (missing.length === 0 && violation.amount !== undefined) {
      complete.push({ ...violation, amount: violation.amount });
    } else {
      incomplete.push({ position: violation.position, missing });
    }
  }

  // Спорят сначала о крупном: реестр, отсортированный по порядку появления,
  // заставляет службу заказчика искать существенное глазами.
  const sorted = [...complete].sort((a, b) =>
    new Decimal(b.amount).comparedTo(new Decimal(a.amount)),
  );

  const total = sorted.reduce((sum, violation) => sum.plus(violation.amount), new Decimal(0));

  const rows: Cell[][] = [COLUMNS.map((name) => text(name, "header"))];

  for (const violation of sorted) {
    rows.push([
      text(violation.position),
      text(violation.kind),
      money(violation.amount, `находка: ${violation.basis}`),
      text(violation.basis),
      text(violation.remedy),
      text(violation.document),
    ]);
  }

  if (sorted.length === 0) {
    // Пустой лист читается как «нарушений нет» — утверждение, которое надо
    // либо делать явно, либо не делать вовсе.
    rows.push([
      text(
        incomplete.length === 0
          ? `нарушений не найдено на объекте «${input.objectName}»`
          : `нарушений не найдено полностью оформленных; неполных находок: ${incomplete.length}`,
        "note",
      ),
    ]);
  } else {
    rows.push([
      text("ИТОГО", "total"),
      { kind: "empty" },
      money(total.toFixed(2), `сумма ${sorted.length} нарушений реестра`, "total"),
    ]);
  }

  if (incomplete.length > 0) {
    rows.push([{ kind: "empty" }]);
    rows.push([text("НЕПОЛНЫЕ НАХОДКИ — не предъявляются, требуют дооформления", "header")]);

    for (const item of incomplete) {
      rows.push([text(item.position), text(`не заполнено: ${item.missing.join(", ")}`, "note")]);
    }
  }

  return {
    sheets: [{ name: "Реестр нарушений", columnWidths: COLUMN_WIDTHS, rows }],
    metadata: {
      templateVersion: VIOLATIONS_TEMPLATE_VERSION,
      generatorVersion: input.generatorVersion ?? "не указана",
      artifactId: input.artifactId ?? "не указан",
      inputHashes: [],
      producedAt: input.producedAt ?? "не указано",
    },
    totalAmount: decimal(total.toFixed(2)),
    incomplete,
  };
}
