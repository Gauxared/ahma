/**
 * Отбор «3–5 сильных».
 *
 * ЧТО ЗДЕСЬ ЗАЩИЩАЕТСЯ, И ПОЧЕМУ ИМЕННО ЭТО
 *
 * Каждое правило отбора введено против конкретного исхода, который система
 * давала бы без него, и проверяется именно этот исход, а не «функция вернула
 * массив»:
 *
 *  · без отсечения повторов пятёрка на курганском объекте оказывается пятью
 *    мнениями об ОДНОЙ строке: пять агентов ссылаются на позицию 61;
 *  · без потолка на автора разговор превращается в доклад одного агента,
 *    а ценность кросс-валидации в том, что видно нескольких;
 *  · без требования координаты в перечень попадает вывод, который нельзя
 *    показать в исходном файле, — а первое, что спросят, это «откуда».
 */
import { describe, expect, it } from "vitest";

import type { ReviewFindingView } from "./check-read-model.js";
import { STRONGEST_MAX, strongest, type Candidate } from "./strongest.js";

function замечание(
  parts: {
    readonly severity: string;
    readonly statement: string;
    readonly row: number | null;
    readonly amount?: number;
    readonly document?: string;
    readonly hash?: string;
  },
): ReviewFindingView {
  return {
    severity: parts.severity,
    statement: parts.statement,
    basis: "основание",
    amount:
      parts.amount === undefined
        ? null
        : { text: String(parts.amount), value: parts.amount, currency: "₽" },
    deviation: null,
    document: parts.document ?? "ЛСР-1.xlsx",
    source:
      parts.row === null
        ? null
        : {
            document: parts.document ?? "ЛСР-1.xlsx",
            where: `лист «Раздел 1», строка ${parts.row}`,
            sheet: "Раздел 1",
            row: parts.row,
            status: "факт",
            acquisition: "разобрано из файла",
            contentHash: parts.hash ?? "a".repeat(64),
          },
  };
}

function кандидат(capability: string, finding: ReviewFindingView): Candidate {
  return { capability, person: capability.toUpperCase(), finding };
}

describe("отбор сильных выводов", () => {
  it("тяжёлое сверху при любой сумме", () => {
    const выбрано = strongest([
      кандидат("a", замечание({ severity: "medium", statement: "средняя дорогая", row: 1, amount: 10_000_000 })),
      кандидат("b", замечание({ severity: "critical", statement: "блокер дешёвый", row: 2, amount: 100 })),
    ]);

    expect(выбрано.map((item) => item.finding.statement)).toEqual(["блокер дешёвый", "средняя дорогая"]);
  });

  it("внутри важности — по сумме позиции", () => {
    const выбрано = strongest([
      кандидат("a", замечание({ severity: "high", statement: "дешевле", row: 1, amount: 1_000 })),
      кандидат("b", замечание({ severity: "high", statement: "дороже", row: 2, amount: 900_000 })),
    ]);

    expect(выбрано[0]?.finding.statement).toBe("дороже");
  });

  it("одна позиция даёт одну находку", () => {
    // Пять мнений об одной строке — это один разговор, а не пять.
    const одна = { severity: "critical", row: 61, amount: 21_383_323 } as const;
    const выбрано = strongest([
      кандидат("a", замечание({ ...одна, statement: "первое мнение" })),
      кандидат("b", замечание({ ...одна, statement: "второе мнение" })),
      кандидат("c", замечание({ ...одна, statement: "третье мнение" })),
      кандидат("d", замечание({ severity: "high", statement: "другая строка", row: 99, amount: 5 })),
    ]);

    expect(выбрано).toHaveLength(2);
    expect(выбрано.map((item) => item.finding.statement)).toEqual(["первое мнение", "другая строка"]);
  });

  it("та же строка в ДРУГОМ документе — другая позиция", () => {
    // Строка 48 есть в каждой смете объекта: считать их одной позицией значило
    // бы выбросить настоящую находку по соседнему файлу. Документы различаются
    // ОТПЕЧАТКОМ — именем нельзя, у объектных агентов оно пусто.
    const выбрано = strongest([
      кандидат("a", замечание({ severity: "critical", statement: "в первой", row: 48, hash: "1".repeat(64) })),
      кандидат("b", замечание({ severity: "critical", statement: "во второй", row: 48, hash: "2".repeat(64) })),
    ]);

    expect(выбрано).toHaveLength(2);
  });

  /**
   * ОДНА СТРОКА ОДНОГО ФАЙЛА — ОДНА НАХОДКА, ДАЖЕ ЕСЛИ ИМЯ ДОКУМЕНТА ПУСТО.
   *
   * У объектных агентов `document` пуст: их предмет — объект, а не файл. Пока
   * ключ позиции строился по имени, правило не срабатывало ровно там, где
   * нужнее всего, и перечень из пяти РАЗНЫХ находок начинался двумя мнениями
   * об одной строке 240.
   */
  it("объектный агент и документный об одной строке дают одну находку", () => {
    const одна = { severity: "critical", row: 240, hash: "f".repeat(64) } as const;
    const выбрано = strongest([
      кандидат("объектный", замечание({ ...одна, statement: "матрица разграничения", document: "" })),
      кандидат("документный", замечание({ ...одна, statement: "позиция 61 крупнейшая", document: "ЛСР-1.xlsx" })),
    ]);

    expect(выбрано).toHaveLength(1);
  });

  it("один автор — не больше двух находок", () => {
    const выбрано = strongest([
      кандидат("a", замечание({ severity: "critical", statement: "первое a", row: 1 })),
      кандидат("a", замечание({ severity: "critical", statement: "второе a", row: 2 })),
      кандидат("a", замечание({ severity: "critical", statement: "третье a", row: 3 })),
      кандидат("b", замечание({ severity: "medium", statement: "первое b", row: 4 })),
    ]);

    expect(выбрано.map((item) => item.capability)).toEqual(["a", "a", "b"]);
  });

  it("вывод без координаты в перечень не идёт", () => {
    // Он остаётся законным и читается на экране агента. Но показать его в
    // исходном файле нечем, а на встрече спрашивают именно это.
    const выбрано = strongest([
      кандидат("a", замечание({ severity: "critical", statement: "без координаты", row: null })),
      кандидат("b", замечание({ severity: "info", statement: "со следом", row: 7 })),
    ]);

    expect(выбрано.map((item) => item.finding.statement)).toEqual(["со следом"]);
  });

  it("не отдаёт больше пяти", () => {
    const много = Array.from({ length: 40 }, (_, index) =>
      кандидат(`агент-${index}`, замечание({ severity: "critical", statement: `находка ${index}`, row: index + 1 })),
    );

    expect(strongest(много)).toHaveLength(STRONGEST_MAX);
  });

  it("порядок устойчив: те же данные дают тот же перечень", () => {
    // Перечень, меняющийся от прогона к прогону при тех же данных, нельзя ни
    // сравнить с предыдущим, ни переслать.
    const вход = [
      кандидат("b", замечание({ severity: "high", statement: "одинаково", row: 1 })),
      кандидат("a", замечание({ severity: "high", statement: "одинаково", row: 2 })),
    ];

    expect(strongest(вход).map((item) => item.capability)).toEqual(
      strongest([...вход].reverse()).map((item) => item.capability),
    );
  });

  it("пусто, когда показывать нечего", () => {
    expect(strongest([])).toEqual([]);
  });
});
