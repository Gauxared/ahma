/**
 * Распознавание зрением — против подмены уровня доверия и молчаливых пропусков.
 *
 * ЧТО ЗДЕСЬ ЗАЩИЩАЕТСЯ
 *
 * Сканы и таблицы из PDF долго стояли в документе как «чего нет». Когда их
 * делают, появляется соблазн худшего рода: выдать прочитанное с картинки за
 * разобранное из файла. Разница существенна — у разбора есть лист и строка, у
 * зрения только номер страницы, — и стереть её значит обесценить весь след.
 *
 * Второй соблазн — тишина: страница не прочиталась, и её просто нет в выводе.
 * Тогда «в спецификации этого нет» оказывается утверждением о нашем сбое.
 */
import { describe, expect, it } from "vitest";

import { extractByVision, visionBrief, VISION_PAGE_SCHEMA, VISION_PROMPT } from "./vision-extract.js";

const СТРАНИЦА = { page: 7, dataUrl: "data:image/png;base64,AAA" };

function читатель(ответ: unknown) {
  return { read: async () => ответ };
}

describe("распознавание зрением", () => {
  it("строки таблицы доезжают с номером страницы", async () => {
    const итог = await extractByVision({
      document: "/о/КУРГАН_СОТ.pdf",
      pages: [СТРАНИЦА],
      reader: читатель({
        kind: "спецификация",
        text: "",
        rows: [{ ordinal: "3", code: "СОТ-01", name: "Камера наружная", unit: "шт", quantity: "191", amount: "" }],
      }),
    });

    expect(итог.pages[0]?.rows).toHaveLength(1);
    expect(итог.pages[0]?.rows[0]?.name).toBe("Камера наружная");
    expect(итог.pages[0]?.page, "номер страницы — единственная координата зрения").toBe(7);
  });

  it("уровень доверия — «ориентир», и он ОБЪЯВЛЕН первой строкой", async () => {
    /**
     * Агент, узнавший об «ориентире» через две тысячи знаков, уже сделал вывод.
     * Поэтому пометка идёт первой строкой, а не сноской внизу.
     */
    const итог = await extractByVision({
      document: "/о/скан.pdf",
      pages: [СТРАНИЦА],
      reader: читатель({ kind: "ведомость", text: "", rows: [{ ordinal: "1", code: "", name: "Работа", unit: "м2", quantity: "10", amount: "" }] }),
    });

    expect(итог.trust).toBe("ориентир");

    const сводка = visionBrief(итог);
    expect(сводка.split("\n")[0]).toContain("ПРОЧИТАНО ЗРЕНИЕМ");
    expect(сводка.split("\n")[0]).toContain("ориентир");
    expect(сводка).toContain("Разбором из файла это не подтверждено");
  });

  it("непрочитанная страница НАЗЫВАЕТСЯ, а не исчезает", async () => {
    // Молча пропустить страницу — значит отдать неполное распознавание под
    // видом полного. Агент скажет «в спецификации этого нет», имея в виду
    // наш сбой.
    let первая = true;
    const итог = await extractByVision({
      document: "/о/подшивка.pdf",
      pages: [
        { page: 1, dataUrl: "data:image/png;base64,A" },
        { page: 2, dataUrl: "data:image/png;base64,B" },
      ],
      reader: {
        read: async () => {
          if (первая) {
            первая = false;
            throw new Error("модель не ответила");
          }
          return { kind: "текст", text: "содержимое", rows: [] };
        },
      },
    });

    expect(итог.pages).toHaveLength(1);
    expect(итог.skipped).toEqual([{ page: 1, reason: "модель не ответила" }]);
    expect(visionBrief(итог)).toContain("НЕ ПРОЧИТАНО 1 страниц");
  });

  it("строка без наименования отбрасывается — это рамка листа, а не позиция", async () => {
    /**
     * Замерено на курганской подшивке: разбор текстового слоя вернул 214
     * «таблиц», и все 214 оказались рамками. Зрение даёт тот же мусор, если его
     * не отсечь, — и тогда в спецификации появятся пустые позиции.
     */
    const итог = await extractByVision({
      document: "/о/чертёж.pdf",
      pages: [СТРАНИЦА],
      reader: читатель({
        kind: "чертёж",
        text: "",
        rows: [
          { ordinal: "", code: "", name: "", unit: "", quantity: "", amount: "" },
          { ordinal: "1", code: "", name: "Кабель ВВГнг", unit: "м", quantity: "220", amount: "" },
        ],
      }),
    });

    expect(итог.pages[0]?.rows).toHaveLength(1);
    expect(итог.pages[0]?.rows[0]?.name).toBe("Кабель ВВГнг");
  });

  it("схема ответа СТРОГАЯ: необязательных полей нет", () => {
    // В строгом структурированном выводе каждое свойство обязано быть в
    // `required`. Провайдер отвергает схему целиком, а не по полю, — проверено
    // боем на схеме агента.
    const проверить = (схема: { required?: readonly string[]; properties?: Record<string, unknown> }): void => {
      const свойства = Object.keys(схема.properties ?? {});
      expect([...(схема.required ?? [])].sort()).toEqual([...свойства].sort());
    };

    проверить(VISION_PAGE_SCHEMA as never);
    проверить((VISION_PAGE_SCHEMA.properties.rows.items as never) as { required?: string[]; properties?: Record<string, unknown> });
  });

  it("промпт запрещает додумывать, и запрет назван причиной", () => {
    // «Не додумывай» здесь не вежливость: выдуманное число неотличимо от
    // прочитанного и уйдёт в отчёт как факт.
    expect(VISION_PROMPT).toContain("НЕ ДОДУМЫВАЙ");
    expect(VISION_PROMPT).toContain("пустое поле честнее правдоподобного");
  });

  it("пустое распознавание не даёт пустой сводки с обещанием", async () => {
    // Заголовок «прочитано зрением» над пустотой читается как «прочитано и
    // ничего нет» — утверждение, которого никто не делал.
    const итог = await extractByVision({ document: "/о/п.pdf", pages: [], reader: читатель({}) });
    expect(visionBrief(итог)).toBe("");
  });
});
