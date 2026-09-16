/**
 * Тесты написаны до реализации. Сравнение предложений — ТЗ §10, четвёртая из
 * четырёх договорных выгрузок:
 *
 *   «Сравнение предложений (Excel) | Сопоставимые позиции, цены по каждому
 *    предложению подрядчика, разброс, оценка Системы, отклонения и аномалии»
 *
 * ГЛАВНОЕ ТРЕБОВАНИЕ — СЛОВО «СОПОСТАВИМЫЕ»
 *
 * §5.2 говорит прямо: несопоставленные позиции в расчёт разброса не входят.
 * В выгрузке это означает, что подрядчик, не давший цену, оставляет ПУСТУЮ
 * ячейку, а не ноль. Ноль в таблице сравнения читается как «предложил
 * бесплатно» и занижает и минимум, и разброс — то есть искажает ровно то
 * число, ради которого таблицу и строят.
 *
 * ОЦЕНКА СИСТЕМЫ — ОТДЕЛЬНЫЙ СТОЛБЕЦ, А НЕ ОДНО ИЗ ПРЕДЛОЖЕНИЙ
 *
 * Смешать её с ценами подрядчиков значит позволить ей влиять на разброс. §5.2
 * требует обратного: оценка сравнивается С разбросом, а не участвует в нём.
 *
 * ВЫГРУЗКА НИЧЕГО НЕ СЧИТАЕТ
 *
 * Разброс и отклонение приходят ПОСЧИТАННЫМИ, из расчётного модуля. Дай
 * выгрузке считать самой — и Excel разойдётся с результатом Проверки, а
 * защищать перед заказчиком придётся два разных числа. Поэтому тесты передают
 * готовый разброс: это не неудобство теста, а форма контракта.
 */
import { describe, expect, it } from "vitest";

import { buildOffersComparison } from "./offers-comparison.js";

/**
 * Разброс и отклонение задаются ДАННЫМИ, а не вызовом расчётного модуля.
 *
 * Так и должно быть: выгрузка от расчётного модуля не зависит — ни в коде, ни
 * в тесте. Тест, тянущий соседний модуль, привязывает выгрузку к его
 * внутренностям и перестаёт проверять то, ради чего талия существует. Здесь
 * повторяется ровно контракт: что придёт, то и будет отрисовано.
 *
 * Арифметика фикстур посчитана вручную и проверена в тестах самого разброса.
 */
function позицияС(input: {
  readonly name: string;
  readonly unit: string;
  readonly quantity: string;
  readonly offers: readonly { contractor: string; amount?: string }[];
  readonly systemEstimate?: string;
  readonly spread: {
    readonly min?: string;
    readonly max?: string;
    readonly median?: string;
    readonly ratio?: string;
    readonly comparable: number;
    readonly unmatched: readonly { source: string; reason: string }[];
    readonly anomalies: readonly { source: string; amount: string; impact: string; ratio: string }[];
    readonly computable: boolean;
    readonly reason?: string;
    readonly note: string;
  };
  readonly deviation?: { readonly absolute: string; readonly relative?: string };
}) {
  return input;
}

/** Разброс трёх цен 1.0 / 1.2 / 1.4 млн: медиана 1.2, отношение 1.4. */
const РАЗБРОС_ТРЁХ = {
  min: "1000000.00",
  max: "1400000.00",
  median: "1200000.00",
  ratio: "1.4000",
  comparable: 3,
  unmatched: [],
  anomalies: [],
  computable: true,
  note: "в расчёт вошли все 3 предложений",
};

const ПОЗИЦИЯ = позицияС({
  name: "Кабель ВВГнг(А)-LS 5х16",
  unit: "м",
  quantity: "1200",
  offers: [
    { contractor: "Подрядчик А", amount: "1000000.00" },
    { contractor: "Подрядчик Б", amount: "1200000.00" },
    { contractor: "Подрядчик В", amount: "1400000.00" },
  ],
  systemEstimate: "1150000.00",
  spread: РАЗБРОС_ТРЁХ,
  // Медиана 1 200 000 против оценки 1 150 000 — плюс 4,35%.
  deviation: { absolute: "50000.00", relative: "0.0435" },
});

describe("сравнение предложений (§10)", () => {
  it("даёт колонку на каждого подрядчика", () => {
    const книга = buildOffersComparison({ objectName: "Курган", positions: [ПОЗИЦИЯ] });
    const шапка = книга.sheets[0]!.rows[0]!.map((c) => (c.kind === "text" ? c.value : ""));

    for (const подрядчик of ["Подрядчик А", "Подрядчик Б", "Подрядчик В"]) {
      expect(шапка).toContain(подрядчик);
    }
  });

  it("несёт разброс, оценку Системы и аномалии", () => {
    const книга = buildOffersComparison({ objectName: "Курган", positions: [ПОЗИЦИЯ] });
    const шапка = книга.sheets[0]!.rows[0]!.map((c) => (c.kind === "text" ? c.value : "")).join(" ");

    expect(шапка).toContain("Разброс");
    expect(шапка).toContain("Оценка Системы");
    expect(шапка).toContain("Отклонение");
  });

  it("ОСТАВЛЯЕТ ПУСТУЮ ячейку у подрядчика без цены, а не ноль", () => {
    // Ноль читается как «предложил бесплатно» и занижает минимум и разброс —
    // то есть искажает ровно то число, ради которого таблицу строят.
    const книга = buildOffersComparison({
      objectName: "Курган",
      positions: [
        позицияС({
          name: ПОЗИЦИЯ.name,
          unit: ПОЗИЦИЯ.unit,
          quantity: ПОЗИЦИЯ.quantity,
          offers: [
            { contractor: "Подрядчик А", amount: "1000000.00" },
            { contractor: "Подрядчик Б" },
          ],
          spread: {
            min: "1000000.00",
            max: "1000000.00",
            median: "1000000.00",
            comparable: 1,
            unmatched: [{ source: "Подрядчик Б", reason: "цена не предложена" }],
            anomalies: [],
            computable: false,
            reason: "разброс не считается: одно предложение — не выборка",
            note: "НЕ входят несопоставленные по §5.2: Подрядчик Б",
          },
        }),
      ],
    });

    const строка = книга.sheets[0]!.rows[1]!;
    const ячейки = строка.filter((c) => c.kind === "number" || c.kind === "empty");

    expect(ячейки.some((c) => c.kind === "empty")).toBe(true);
    expect(строка.every((c) => c.kind !== "number" || c.value !== "0.00")).toBe(true);
  });

  it("НЕ включает предложение без цены в разброс (§5.2)", () => {
    const книга = buildOffersComparison({
      objectName: "Курган",
      positions: [
        позицияС({
          name: ПОЗИЦИЯ.name,
          unit: ПОЗИЦИЯ.unit,
          quantity: ПОЗИЦИЯ.quantity,
          offers: [
            { contractor: "Подрядчик А", amount: "1000000.00" },
            { contractor: "Подрядчик Б", amount: "1400000.00" },
            { contractor: "Подрядчик В" },
          ],
          spread: {
            min: "1000000.00",
            max: "1400000.00",
            median: "1200000.00",
            ratio: "1.4000",
            comparable: 2,
            unmatched: [{ source: "Подрядчик В", reason: "цена не предложена" }],
            anomalies: [],
            computable: true,
            note: "НЕ входят несопоставленные по §5.2: Подрядчик В",
          },
        }),
      ],
    });

    expect(книга.positions[0]?.spread.comparable).toBe(2);
    expect(книга.positions[0]?.spread.ratio).toBe("1.4000");
  });

  it("НЕ смешивает оценку Системы с ценами подрядчиков в разбросе", () => {
    // Оценка сравнивается С разбросом, а не участвует в нём: иначе она влияет
    // на число, по которому её же и проверяют.
    const книга = buildOffersComparison({
      objectName: "Курган",
      positions: [
        позицияС({
          name: ПОЗИЦИЯ.name,
          unit: ПОЗИЦИЯ.unit,
          quantity: ПОЗИЦИЯ.quantity,
          offers: [
            { contractor: "Подрядчик А", amount: "1000000.00" },
            { contractor: "Подрядчик Б", amount: "1200000.00" },
            { contractor: "Подрядчик В", amount: "1400000.00" },
          ],
          systemEstimate: "50.00",
          spread: РАЗБРОС_ТРЁХ,
        }),
      ],
    });

    expect(книга.positions[0]?.spread.min).toBe("1000000.00");
    expect(книга.positions[0]?.spread.comparable).toBe(3);
  });

  it("считает отклонение медианы от оценки Системы", () => {
    const книга = buildOffersComparison({ objectName: "Курган", positions: [ПОЗИЦИЯ] });

    // Медиана 1 200 000 против оценки 1 150 000 — плюс 4,35%.
    expect(книга.positions[0]?.deviation?.relative).toBe("0.0435");
  });

  it("НЕ считает отклонение, когда оценки Системы нет", () => {
    const книга = buildOffersComparison({
      objectName: "Курган",
      positions: [
        позицияС({
          name: ПОЗИЦИЯ.name,
          unit: ПОЗИЦИЯ.unit,
          quantity: ПОЗИЦИЯ.quantity,
          offers: [
            { contractor: "Подрядчик А", amount: "1000000.00" },
            { contractor: "Подрядчик Б", amount: "1200000.00" },
            { contractor: "Подрядчик В", amount: "1400000.00" },
          ],
          spread: РАЗБРОС_ТРЁХ,
        }),
      ],
    });

    expect(книга.positions[0]?.deviation).toBeUndefined();
  });

  it("НАЗЫВАЕТ аномалию отдельной строкой с суммой влияния (§5.2)", () => {
    const книга = buildOffersComparison({
      objectName: "Курган",
      positions: [
        позицияС({
          name: ПОЗИЦИЯ.name,
          unit: ПОЗИЦИЯ.unit,
          quantity: ПОЗИЦИЯ.quantity,
          offers: [
            { contractor: "Подрядчик А", amount: "1000000.00" },
            { contractor: "Подрядчик Б", amount: "1100000.00" },
            { contractor: "Подрядчик В", amount: "9000000.00" },
          ],
          spread: {
            min: "1000000.00",
            max: "9000000.00",
            median: "1100000.00",
            ratio: "9.0000",
            comparable: 3,
            unmatched: [],
            // §5.2: аномалия называется с СУММОЙ ВЛИЯНИЯ.
            anomalies: [
              { source: "Подрядчик В", amount: "9000000.00", impact: "7900000.00", ratio: "8.1818" },
            ],
            computable: true,
            note: "в расчёт вошли все 3 предложений",
          },
        }),
      ],
    });

    expect(книга.positions[0]?.spread.anomalies).toHaveLength(1);
    expect(книга.positions[0]?.spread.anomalies[0]?.source).toBe("Подрядчик В");
  });

  it("сообщает, что разброс по одному предложению НЕ считается", () => {
    const книга = buildOffersComparison({
      objectName: "Курган",
      positions: [
        позицияС({
          name: ПОЗИЦИЯ.name,
          unit: ПОЗИЦИЯ.unit,
          quantity: ПОЗИЦИЯ.quantity,
          offers: [{ contractor: "Подрядчик А", amount: "1000000.00" }],
          spread: {
            min: "1000000.00",
            max: "1000000.00",
            median: "1000000.00",
            comparable: 1,
            unmatched: [],
            anomalies: [],
            computable: false,
            reason: "разброс не считается: одно предложение — не выборка, а его разброс равен единице по построению",
            note: "в расчёт вошли все 1 предложений",
          },
        }),
      ],
    });

    expect(книга.positions[0]?.spread.computable).toBe(false);
    const текст = книга.sheets[0]!.rows.flat().map((c) => (c.kind === "text" ? c.value : "")).join(" ");
    expect(текст).toContain("не выборка");
  });

  it("каждое число несёт маркер источника (§12.1д)", () => {
    const книга = buildOffersComparison({ objectName: "Курган", positions: [ПОЗИЦИЯ] });

    for (const row of книга.sheets[0]!.rows) {
      for (const cell of row) {
        if (cell.kind === "number") expect(cell.marker).toBeTruthy();
      }
    }
  });

  it("держит порядок подрядчиков одинаковым во всех строках", () => {
    // Иначе цена одного подрядчика окажется в колонке другого — ошибка,
    // которую в таблице на двадцать позиций никто не заметит.
    const книга = buildOffersComparison({
      objectName: "Курган",
      positions: [
        ПОЗИЦИЯ,
        позицияС({
          name: "Лоток",
          unit: "м",
          quantity: "80",
          // Порядок намеренно другой, и подрядчик А цену не дал.
          offers: [
            { contractor: "Подрядчик В", amount: "300000.00" },
            { contractor: "Подрядчик Б", amount: "200000.00" },
          ],
          spread: {
            min: "200000.00",
            max: "300000.00",
            median: "250000.00",
            ratio: "1.5000",
            comparable: 2,
            unmatched: [],
            anomalies: [],
            computable: true,
            note: "в расчёт вошли все 2 предложений",
          },
        }),
      ],
    });

    expect(книга.contractors).toEqual(["Подрядчик А", "Подрядчик Б", "Подрядчик В"]);

    const вторая = книга.sheets[0]!.rows[2]!;
    // Колонки подрядчиков идут после наименования, единицы и количества.
    expect(вторая[3]).toMatchObject({ kind: "empty" });
    expect(вторая[4]).toMatchObject({ value: "200000.00" });
    expect(вторая[5]).toMatchObject({ value: "300000.00" });
  });
});
