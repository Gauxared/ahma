/**
 * РАБОЧАЯ ПАПКА ПРОГОНА — то, что роли читают сами (spec-demo-stage-1 А5).
 *
 * Проверяется договор между детерминированным слоем и ролями: каждая позиция
 * сметы — строка TSV со СТРОКОЙ ЛИСТА (по ней находка получает ссылку), каждый
 * документ назван в ОБЪЕКТ.md с указанием, где его читать, а роль без опорной
 * базы названа поимённо — ей объявят режим [БЕЗ БАЗЫ], а не подсунут пустоту.
 */
import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { CollectedDuringCheck } from "../execution/check-ports.js";
import { materializeWorkspace } from "./workspace.js";

const ПАРТИЯ = "/о/партия";
const СМЕТА = `${ПАРТИЯ}/сметы/ЛСР-1 Электрика.xlsx`;
const РД = `${ПАРТИЯ}/РД/Пояснительная записка.pdf`;

function накопитель(): CollectedDuringCheck {
  return {
    documentHashes: [{ path: СМЕТА, contentHash: "a".repeat(64) }, { path: РД, contentHash: "b".repeat(64) }],
    linearPositions: [],
    extracted: [
      { document: СМЕТА, ordinal: "1", section: "1", sourceName: "Кабель\tс табуляцией", basis: "ФССЦ-1", unit: "м", quantity: "150", amount: "48200.00", sourceRow: 12 },
      { document: СМЕТА, ordinal: "2", section: "1", sourceName: "Лоток", basis: "ФССЦ-2", unit: "м", quantity: "20", amount: undefined, sourceRow: 13 },
    ],
    descriptors: [],
    designDocuments: [{ path: РД, pages: 3, text: "Текст пояснительной записки" }],
    designSheets: [{ document: РД, page: 1, dataUrl: `data:image/png;base64,${Buffer.from("png").toString("base64")}`, bytes: 3 }],
  } as unknown as CollectedDuringCheck;
}

describe("рабочая папка", () => {
  it("раскладывает сметы в TSV со строкой листа, тексты, листы, нормативы, Ядро и ОБЪЕКТ.md", async () => {
    const root = await mkdtemp(join(tmpdir(), "папка-"));

    const space = await materializeWorkspace({
      root,
      label: "ТЕСТ 2026",
      objectCode: "ТЕСТ",
      objectPath: ПАРТИЯ,
      collected: накопитель(),
      documents: [
        { path: СМЕТА, kind: "лср", status: "проверен", positions: 2, converged: false, delta: "100.00", documentTotal: "48300.00" },
        { path: РД, kind: "рабочая-документация", status: "прочитан", reason: "текстовый слой прочитан" },
      ],
      declaredTotal: "50000.00",
      roles: [
        { capability: "estimate_review", person: "Людмила", referenceBase: "есть.xlsx" },
        { capability: "work_schedule", person: "Тимофей" },
      ],
      referenceBaseText: async (path) => (path === "есть.xlsx" ? "ОПОРНАЯ БАЗА Людмилы" : undefined),
      normOf: (code) => (code === "ФССЦ-1" ? "Кабель силовой · м · ФССЦ" : undefined),
      bases: [],
      catalogue: [],
      coreRules: "ЯДРО",
    });

    const tsv = await readFile(join(space.root, "сметы", space.estimates[0]!.file), "utf8");
    const lines = tsv.trimEnd().split("\n");
    expect(lines, "строк TSV должно быть шапка + позиции").toHaveLength(3);
    expect(lines[0]).toContain("строка листа");
    expect(lines[1]!.split("\t")).toHaveLength(8);
    expect(lines[1]!.split("\t")[7]).toBe("12");
    expect(lines[1], "табуляция внутри наименования сломала бы колонки").toContain("Кабель с табуляцией");
    expect(lines[2]!.split("\t")[6], "неизвестная сумма — пусто, а не ноль").toBe("");

    const convergence = await readFile(join(space.root, "сметы", space.estimates[0]!.file.replace(/\.tsv$/, ".сходимость.md")), "utf8");
    expect(convergence).toContain("сошлось: НЕТ");
    expect(convergence).toContain("расхождение, ₽: 100.00");

    expect(await readdir(join(space.root, "документация"))).toEqual(["Пояснительная_записка.txt"]);
    expect(await readdir(join(space.root, "листы"))).toHaveLength(1);
    expect(await readFile(join(space.root, "нормативы.tsv"), "utf8")).toContain("ФССЦ-1\tКабель силовой · м · ФССЦ");
    expect(await readFile(join(space.root, "нормативы.tsv"), "utf8")).toContain("ФССЦ-2\tне найден в каталоге");
    expect(await readFile(join(space.root, "ядро.md"), "utf8")).toContain("ЯДРО");
    expect(await readFile(join(space.root, "опора", "Людмила.md"), "utf8")).toContain("ОПОРНАЯ БАЗА Людмилы");
    expect(space.withoutBase).toEqual(["Тимофей"]);

    // Инструменты роли — исполняемые обёртки над tsx выпуска, из которого работает служба.
    expect((await readdir(join(space.root, "инструменты"))).sort()).toEqual(["документ", "источник", "поиск", "страница", "финмодель", "цены"]);
    const wrapper = await readFile(join(space.root, "инструменты", "финмодель"), "utf8");
    expect(wrapper.startsWith("#!/bin/sh\n")).toBe(true);
    expect(wrapper).toContain(`${join(process.cwd(), "apps/cli/src/tools.ts")}" финмодель "$@"`);
    expect(wrapper).toContain(`TSX_TSCONFIG_PATH="${join(process.cwd(), "tsconfig.json")}"`);
    expect((await stat(join(space.root, "инструменты", "финмодель"))).mode & 0o111, "обёртка исполняемая").not.toBe(0);
    expect(space.summary).toContain("`инструменты/финмодель`");

    expect(space.summary).toContain("| сметы/ЛСР-1 Электрика.xlsx | лср | проверен | 2 | 48300.00 | НЕТ | сметы/");
    expect(space.summary).toContain("| РД/Пояснительная записка.pdf | рабочая-документация | прочитан | — | — | — | документация/ | текстовый слой прочитан");
    expect(space.summary).toContain("Итог по сводному расчёту (цена заказчику): 50000.00");
    expect(await readFile(join(space.root, "ОБЪЕКТ.md"), "utf8")).toBe(`${space.summary}\n`);
  });

  it("одноимённые файлы из разных папок не затирают друг друга", async () => {
    const root = await mkdtemp(join(tmpdir(), "папка-"));
    const a = `${ПАРТИЯ}/а/ЛСР.xlsx`;
    const b = `${ПАРТИЯ}/б/ЛСР.xlsx`;
    const row = { ordinal: "1", section: "1", sourceName: "x", basis: "", unit: "", quantity: "1", amount: "1.00", sourceRow: 5 };

    const space = await materializeWorkspace({
      root,
      label: "к",
      objectCode: "К",
      objectPath: ПАРТИЯ,
      collected: {
        documentHashes: [{ path: a, contentHash: "a".repeat(64) }, { path: b, contentHash: "b".repeat(64) }],
        linearPositions: [],
        extracted: [{ document: a, ...row }, { document: b, ...row }],
        descriptors: [],
        designDocuments: [],
        designSheets: [],
      } as unknown as CollectedDuringCheck,
      documents: [],
      roles: [],
      referenceBaseText: async () => undefined,
      normOf: () => undefined,
      bases: [],
      catalogue: [],
      coreRules: "",
    });

    expect(space.estimates.map((e) => e.file)).toEqual(["ЛСР.tsv", "ЛСР_2.tsv"]);
  });
});
