/**
 * Регрессия на порядок префиксов шифров.
 *
 * Дефект найден на реальных данных: все 44 позиции курганского СОТВ имеют
 * шифры ГЭСНм, и при проверке короткого префикса первым они разбирались как
 * ГЭСН с кодом «м08-…». Сопоставление давало ноль, и это выглядело как
 * свойство данных, а не как ошибка разбора.
 */
import { describe, expect, it } from "vitest";

import { parseItemCode } from "./grand-smeta.js";

describe("разбор шифра нормативной базы", () => {
  it("не путает отраслевую ветвь с базовой: ГЭСНм ≠ ГЭСН", () => {
    expect(parseItemCode("ГЭСНм08-03-572-06")).toEqual({ system: "ГЭСНм", code: "08-03-572-06" });
    expect(parseItemCode("ГЭСН08-03-572-06")).toEqual({ system: "ГЭСН", code: "08-03-572-06" });
  });

  it("разбирает все ветви ГЭСН", () => {
    expect(parseItemCode("ГЭСНмр01-01-001")?.system).toBe("ГЭСНмр");
    expect(parseItemCode("ГЭСНп02-01-001")?.system).toBe("ГЭСНп");
    expect(parseItemCode("ГЭСНр03-01-001")?.system).toBe("ГЭСНр");
  });

  it("разбирает ветви ФЕР и ТЕР", () => {
    expect(parseItemCode("ФЕРм08-01-001")?.system).toBe("ФЕРм");
    expect(parseItemCode("ФЕРмр08-01-001")?.system).toBe("ФЕРмр");
    expect(parseItemCode("ТЕРр01-01-001")?.system).toBe("ТЕРр");
    expect(parseItemCode("ФЕР01-01-001")?.system).toBe("ФЕР");
  });

  it("не считает шифром обоснование накладных расходов", () => {
    expect(parseItemCode("Пр/812-049.3-1")).toBeUndefined();
    expect(parseItemCode("ТЦ_61.1.03.03_77_7708256411")).toBeUndefined();
  });

  it("отличает ФССЦпг от ФССЦ", () => {
    expect(parseItemCode("ФССЦпг03-01-01-001")?.system).toBe("ФССЦпг");
    expect(parseItemCode("ФССЦ03-01-01-001")?.system).toBe("ФССЦ");
  });
});

describe("разделитель между системой и кодом", () => {
  it("отбрасывает дефис ФСБЦ, но не трогает слитную запись ГЭСН", () => {
    // Реальная запись из курганского ЭОМ.
    expect(parseItemCode("ФСБЦ-08.3.05.02-0021")).toEqual({
      system: "ФСБЦ",
      code: "08.3.05.02-0021",
    });
    expect(parseItemCode("ГЭСНм08-03-572-06")).toEqual({
      system: "ГЭСНм",
      code: "08-03-572-06",
    });
  });
});
