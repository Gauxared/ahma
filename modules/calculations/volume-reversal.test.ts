/**
 * Тесты написаны до реализации. Правило Д-7 промпта Денчика
 * (`reference-system-new/Выход/Денчик_ГИП_v9.7.txt`, ЧАСТЬ 8, КЕЙС: Курган):
 *
 *   «Крупная линейная монтажная позиция (провода, кабель, сети, трубы) →
 *    обязательный реверс объёма: сметный объём ÷ геометрия РД.
 *    Кратность >2 → стоп-флаг 🔴, возврат позиции.
 *    Зачем: приём дал 64,7 млн находки»
 *
 * Числа взяты из настоящего курганского ЭОМ. Базовая длина объекта 15.24 км,
 * и позиции «вынос из зоны работы и возврат» идут её кратными: 15.24, 30.48,
 * 45.72, 60.96. Эталонный выход называет весь этот блок необоснованным РД:
 * 64 710 398 ₽ при 198,12 км.
 */
import { describe, expect, it } from "vitest";

import { reverseVolumes } from "./volume-reversal.js";
import type { LinearPosition } from "./volume-reversal.js";

/** Курганские позиции «вынос КС» как они лежат в ЛСР. */
const КУРГАН: readonly LinearPosition[] = [
  { ordinal: "61", basis: "ГЭСНм20-03-035-01", name: "Вынос из зоны работы и возврат: провод", unit: "км", quantity: "15.24", amount: "21383323.11" },
  { ordinal: "67", basis: "ГЭСНм20-03-035-03", name: "Вынос из зоны работы и возврат: одного провода", unit: "км", quantity: "60.96", amount: "13213388.32" },
  { ordinal: "62", basis: "ГЭСНм20-03-035-02", name: "Вынос из зоны работы и возврат: одного провода", unit: "км", quantity: "30.48", amount: "12215272.72" },
  { ordinal: "64", basis: "ГЭСНм20-03-035-03", name: "Вынос из зоны работы и возврат: одного провода", unit: "км", quantity: "45.72", amount: "9910041.25" },
  { ordinal: "70", basis: "ГЭСНм20-03-035-06", name: "Вынос из зоны работы и возврат: провод", unit: "км", quantity: "15.24", amount: "3302643.00" },
  { ordinal: "71", basis: "ГЭСНм20-03-035-05", name: "Вынос из зоны работы и возврат: одного провода", unit: "км", quantity: "15.24", amount: "3282294.00" },
];

describe("реверс объёма линейных позиций (Д-7)", () => {
  const полный = reverseVolumes(КУРГАН);
  // Все курганские позиции «вынос КС» — одна таблица норм ГЭСНм20-03-035.
  const отчёт = полный.groups[0]!;

  it("находит базовую длину как наименьшую в группе", () => {
    // Геометрии РД у нас нет, но базовая длина видна из самой сметы:
    // это наименьший объём среди однотипных линейных позиций.
    expect(отчёт.baseQuantity).toBe("15.24");
    expect(отчёт.unit).toBe("км");
  });

  it("считает кратность каждой позиции к базовой длине", () => {
    const кратности = Object.fromEntries(
      отчёт.positions.map((position) => [position.ordinal, position.multiple]),
    );

    expect(кратности["61"]).toBe("1");
    expect(кратности["62"]).toBe("2");
    expect(кратности["64"]).toBe("3");
    expect(кратности["67"]).toBe("4");
  });

  it("поднимает стоп-флаг там, где кратность больше двух", () => {
    // Дословно из Д-7: «Кратность >2 → стоп-флаг 🔴, возврат позиции».
    const флаги = отчёт.positions.filter((position) => position.flagged).map((p) => p.ordinal);

    expect(флаги).toEqual(["67", "64"]);
  });

  it("считает деньги на флагах, а не только штуки", () => {
    // 13 213 388.32 + 9 910 041.25
    expect(отчёт.flaggedAmount).toBe("23123429.57");
  });

  it("считает весь линейный блок: без геометрии РД не обоснован НИ ОДИН метр", () => {
    // Эталонный выход называет необоснованным весь блок, а не только кратные:
    // кратность указывает, ГДЕ искать вставку, но обоснования нет у всей группы.
    expect(отчёт.totalAmount).toBe("63306962.40");
    expect(отчёт.totalQuantity).toBe("182.88");
  });

  it("не считает кратностью то, что ею не является", () => {
    // База 100 (повторяется дважды). 137 не кратно ей — это другой объём,
    // и выдавать его за «полторы базы» неверно.
    const разное: readonly LinearPosition[] = [
      { ordinal: "1", basis: "X-01", name: "кабель", unit: "м", quantity: "100", amount: "1000" },
      { ordinal: "2", basis: "X-02", name: "кабель", unit: "м", quantity: "100", amount: "1000" },
      { ordinal: "3", basis: "X-03", name: "кабель", unit: "м", quantity: "137", amount: "1370" },
    ];

    const группа = reverseVolumes(разное).groups[0]!;

    expect(группа.baseQuantity).toBe("100");
    expect(группа.positions.find((p) => p.ordinal === "3")?.multiple).toBeUndefined();
    expect(группа.positions.find((p) => p.ordinal === "3")?.flagged).toBe(false);
  });

  it("берёт за базу САМОЕ ЧАСТОЕ значение, а не наименьшее", () => {
    // Дефект, найденный сверкой с эталонным приёмом: при базе-минимуме
    // ею стали короткие участки 0.12 км, кратности выросли до сотен, а в
    // блок попали шесть посторонних позиций — расхождение 533 524.90 ₽.
    const сБазой: readonly LinearPosition[] = [
      ...КУРГАН,
      { ordinal: "49", basis: "ГЭСНм20-03-035-07", name: "короткий участок", unit: "км", quantity: "0.72", amount: "288549.74" },
      { ordinal: "53", basis: "ГЭСНм20-03-035-08", name: "короткий участок", unit: "км", quantity: "0.12", amount: "26005.07" },
      { ordinal: "52", basis: "ГЭСНм20-03-035-09", name: "короткий участок", unit: "км", quantity: "0.12", amount: "25844.84" },
    ];

    const группа = reverseVolumes(сБазой).groups[0]!;

    // 15.24 повторяется трижды, 0.12 — дважды.
    expect(группа.baseQuantity).toBe("15.24");
    // Короткие участки меньше базы и в реверс не входят: они её часть,
    // а не кратность.
    expect(группа.positions.some((position) => position.ordinal === "49")).toBe(false);
    expect(группа.positions.some((position) => position.ordinal === "53")).toBe(false);
  });

  it("СЧИТАЕТ РЕВЕРС ВНУТРИ ТАБЛИЦЫ НОРМ, а не по всей смете", () => {
    // Дефект первой версии, найденный на настоящих данных: все линейные
    // позиции сложились в одну группу, базой стала медная шина 0.002,
    // кратности вышли в тысячах и флаги встали на всём.
    const смесь: readonly LinearPosition[] = [
      ...КУРГАН,
      { ordinal: "82", basis: "ГЭСНм08-02-145-01", name: "Шина сборная медная", unit: "км", quantity: "0.002", amount: "128.51" },
      { ordinal: "70", basis: "ГЭСНм08-02-145-02", name: "Шина сборная медная", unit: "км", quantity: "0.003", amount: "192.84" },
    ];

    const итог = reverseVolumes(смесь);
    const кс = итог.groups.find((group) => group.table === "ГЭСНм20-03-035")!;
    const шины = итог.groups.find((group) => group.table === "ГЭСНм08-02-145")!;

    // Главное: шина не стала базой для контактной сети.
    expect(кс.baseQuantity).toBe("15.24");
    expect(шины.table).not.toBe(кс.table);
    // Шина не влияет на кратности контактной сети и не получает флага.
    expect(шины.positions.every((position) => !position.flagged)).toBe(true);
  });

  it("не трогает нелинейные позиции: штуки и тонны реверсу не подлежат", () => {
    // «Установка анкеров: 127 шт» — не линейная позиция, кратность к длине
    // для неё бессмысленна.
    const смешанные: readonly LinearPosition[] = [
      ...КУРГАН,
      { ordinal: "29", basis: "ГЭСН28-02-023-01", name: "Установка анкеров", unit: "шт", quantity: "127", amount: "10141552.64" },
    ];

    const итог = reverseVolumes(смешанные);
    const все = итог.groups.flatMap((group) => group.positions);

    expect(все.some((position) => position.ordinal === "29")).toBe(false);
  });

  it("на позициях без количества молчит, а не считает ноль", () => {
    const безКоличества: readonly LinearPosition[] = [
      { ordinal: "1", basis: "X", name: "трасса", unit: "км", amount: "5000" },
    ];

    expect(reverseVolumes(безКоличества).groups).toHaveLength(0);
  });

  it("на пустом входе не выдумывает базовую длину", () => {
    const пусто = reverseVolumes([]);

    expect(пусто.groups).toEqual([]);
    expect(пусто.flaggedAmount).toBe("0.00");
    expect(пусто.unjustifiedAmount).toBe("0.00");
  });

  it("группа из одной позиции не реверсируется: сравнивать не с чем", () => {
    const одна: readonly LinearPosition[] = [
      { ordinal: "1", basis: "Y-01", name: "трасса", unit: "км", quantity: "5", amount: "1000" },
    ];

    expect(reverseVolumes(одна).groups).toHaveLength(0);
  });
});
