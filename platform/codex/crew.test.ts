/**
 * ЭКИПАЖ: ВОРОТА ТАКТОВ, ПЕРЕДАЧА БЛОКОВ, ГЕЙТ ДИРИЖЁРА, ОСТАНОВКА.
 *
 * Проверяется ОРКЕСТРАТОР, а не модель: исполнитель роли подставной, и он
 * записывает, кого позвали, в каком порядке и с каким текстом вводной. Именно
 * это — то, что образец называет системой: «без ворот предыдущего такта
 * следующий не стартует», «блок всегда содержит паспорт объекта + данные во
 * входном формате агента», «не угадывай — верни список дозагрузки».
 *
 * Тесты без Codex и без сети намеренно: сбой здесь — сбой порядка, и его
 * должно быть видно за секунду, а не за сорок минут живого прогона.
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CheckStopped } from "@modules/workflow/check-object.js";

import type { RoleRunner, RoleTask, RoleTurn } from "./codex-client.js";
import { buildCoordinateIndex } from "./crew-output.js";
import { CREW_PLAN, recipientOf, startCrew, type CrewRole } from "./crew.js";
import type { Workspace } from "./workspace.js";
import type { CollectedDuringCheck } from "../execution/check-ports.js";

const ROSTER: readonly [string, string, string, "документ" | "объект" | "синтез"][] = [
  ["object-passport", "object_passport", "Настенька", "объект"],
  ["tech-opinion", "tech_opinion", "Денчик", "документ"],
  ["estimate-review", "estimate_review", "Людмила", "документ"],
  ["executive-docs", "executive_docs", "Палыч", "объект"],
  ["contract-audit", "contract_audit", "Виктор", "объект"],
  ["finance-model", "finance_model", "Ваныч", "объект"],
  ["procurement", "procurement_map", "Марина", "объект"],
  ["subcontract-plan", "subcontract_plan", "Халиль", "объект"],
  ["verdict", "object_verdict", "Артемий", "синтез"],
  ["schedule", "work_schedule", "Тимофей", "синтез"],
];

const roles = (): CrewRole[] =>
  ROSTER.map(([id, capability, person, scope]) => ({
    id,
    capability,
    person,
    role: `роль ${person}`,
    scope,
    requiredSections: [],
    prompt: `ПРОМПТ ${person}`,
    promptSource: "эталон" as const,
  }));

async function workspace(): Promise<Workspace> {
  const root = await mkdtemp(join(tmpdir(), "экипаж-"));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(root, "передачи"));
  await mkdir(join(root, "выход"));

  return {
    root,
    objectPath: "/о/партия",
    objectCode: "ТЕСТ",
    summary: "# ОБЪЕКТ ТЕСТ",
    estimates: [],
    texts: [],
    sheets: [],
    withoutBase: ["Тимофей"],
  };
}

const empty = (): CollectedDuringCheck =>
  ({ documentHashes: [], linearPositions: [], extracted: [], descriptors: [], designDocuments: [], designSheets: [] }) as unknown as CollectedDuringCheck;

/** Ответ роли по умолчанию — пустой, но с вердиктом; Дирижёр — маршрут без гейта. */
function answer(role: string, extra: Record<string, unknown> = {}): unknown {
  if (role === "Дирижёр") {
    return {
      passport: { domain: "дороги", side: "подрядчик", stage: "РД+сметы", data: "3 ЛСР", goal: "вердикт" },
      route: "Классик C",
      why: "полный пакет",
      decision: "маршрут",
      reload: [],
      handoffs: [],
      whatNext: "такт 0",
      ...extra,
    };
  }

  return {
    verdict: `🟡 ${role}`,
    summary: [],
    findings: [],
    sections: [],
    openQuestions: [],
    handoffs: [],
    assumptions: [],
    alerts: [],
    nextTakt: "",
    ...extra,
  };
}

/** Подставной исполнитель: записывает задания, отвечает по таблице. */
function recorder(
  answers: (role: string) => unknown = (role) => answer(role),
  fail: (role: string) => string | undefined = () => undefined,
): { runner: RoleRunner; tasks: RoleTask[] } {
  const tasks: RoleTask[] = [];

  const runner: RoleRunner = async (task) => {
    tasks.push(task);
    // Небольшая задержка — чтобы параллельные роли одного такта действительно
    // шли одновременно, а порядок определялся воротами, не очередью вызовов.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const reason = fail(task.role);
    if (reason !== undefined) throw new Error(reason);

    const turn: RoleTurn = {
      output: answers(task.role),
      finalResponse: "",
      commands: [{ command: "cat ОБЪЕКТ.md", output: "…", exitCode: 0 }],
      searches: [],
      errors: [],
      collab: [],
      inputTokens: 100,
      outputTokens: 10,
      threadId: `тред-${task.role}`,
    };
    return turn;
  };

  return { runner, tasks };
}

async function crewOf(input: { runner: RoleRunner; stopRequested?: () => string | undefined; webSearch?: boolean }) {
  const space = await workspace();
  const crew = startCrew({
    ...(input.webSearch === undefined ? {} : { webSearch: input.webSearch }),
    runner: input.runner,
    workspace: space,
    roles: roles(),
    dispatcherPrompt: "ПРОМПТ ДИРИЖЁРА",
    coreRules: "ЯДРО",
    index: buildCoordinateIndex(empty()),
    provider: "тест",
    model: "модель",
    turnMinutes: 1,
    now: "2026-09-07T12:00:00.000Z",
    ...(input.stopRequested === undefined ? {} : { stopRequested: input.stopRequested }),
  });
  return { crew, space };
}

const order = (tasks: readonly RoleTask[]): string[] => tasks.map((t) => t.role);

describe("ворота тактов", () => {
  it("роль стартует ТОЛЬКО после своих смежников, а такт 4 — после всех", async () => {
    const { runner, tasks } = recorder();
    const { crew } = await crewOf({ runner });

    await Promise.all(ROSTER.map(([, capability]) => crew.result(capability)));

    const seen = order(tasks);
    const at = (role: string): number => seen.indexOf(role);

    expect(at("Дирижёр"), "Дирижёр не первый").toBe(0);
    expect(at("Людмила"), "Людмила стартовала до Денчика — ошибка 30–40 % по образцу").toBeGreaterThan(at("Денчик"));
    expect(at("Ваныч"), "Ваныч без ВОР Людмилы — финмодель на воздухе").toBeGreaterThan(at("Людмила"));
    expect(at("Ваныч")).toBeGreaterThan(at("Виктор"));
    expect(at("Марина")).toBeGreaterThan(at("Ваныч"));
    expect(at("Халиль")).toBeGreaterThan(at("Ваныч"));

    for (const role of ["Настенька", "Денчик", "Людмила", "Палыч", "Виктор", "Ваныч", "Марина", "Халиль"]) {
      expect(at("Артемий"), `Артемий стартовал раньше ${role}`).toBeGreaterThan(at(role));
    }
    expect(at("Тимофей")).toBeGreaterThan(at("Артемий"));
    expect(seen).toHaveLength(11);
  });

  it("план покрывает все десять способностей реестра, и у каждой роли такта ≥1 есть ворота", () => {
    for (const [, capability] of ROSTER) {
      const plan = CREW_PLAN[capability];
      expect(plan, `${capability} нет в плане`).toBeDefined();
      if (plan!.takt > 0) expect(plan!.after.length, `${capability} без предусловий`).toBeGreaterThan(0);
    }
  });

  it("первый вопрос запускает экипаж один раз — ролей не зовут дважды", async () => {
    const { runner, tasks } = recorder();
    const { crew } = await crewOf({ runner });

    await Promise.all([crew.result("object_verdict"), crew.result("estimate_review"), crew.result("estimate_review")]);

    expect(order(tasks).filter((r) => r === "Людмила")).toHaveLength(1);
  });
});

describe("передача «БЛОК ДЛЯ» (Ядро р.2)", () => {
  it("блок Людмилы попадает в вводную Ваныча дословно, в эталонной рамке, и в файл передач", async () => {
    const { runner, tasks } = recorder((role) =>
      role === "Людмила"
        ? answer(role, {
            handoffs: [
              { to: "Ваныча", subject: "Смета 48,2 млн; обоснованное снятие 3,5 млн (двойной счёт 2,3 + НР 1,2)", disputed: "щебень ≈ 0,6 млн", needed: "потолки по пакетам к такту 2" },
            ],
          })
        : answer(role),
    );
    const { crew, space } = await crewOf({ runner });

    await crew.result("finance_model");

    const vanych = tasks.find((t) => t.role === "Ваныч")!;
    expect(vanych.text).toContain("▸ БЛОК ДЛЯ ВАНЫЧА");
    expect(vanych.text).toContain("обоснованное снятие 3,5 млн");
    expect(vanych.text).toContain("Спорная зона: щебень ≈ 0,6 млн");

    const file = await readFile(join(space.root, "передачи", "для-Ваныч.md"), "utf8");
    expect(file).toContain("БЛОК ДЛЯ ВАНЫЧА");

    // Марине блока не адресовали — у неё «блоков нет», а не чужой блок.
    await crew.result("procurement_map");
    const marina = tasks.find((t) => t.role === "Марина")!;
    expect(marina.text).toContain("Блоков, адресованных тебе, нет");
  });

  it("адресат узнаётся в любом падеже и по названию роли", () => {
    const all = roles();
    expect(recipientOf("Ваныча", all)?.person).toBe("Ваныч");
    expect(recipientOf("ХАЛИЛЯ", all)?.person).toBe("Халиль");
    expect(recipientOf("Артемию", all)?.person).toBe("Артемий");
    expect(recipientOf("Настеньке", all)?.person).toBe("Настенька");
    expect(recipientOf("кто-то", all)).toBeUndefined();
  });

  it("вводная роли несёт Ядро, ОБЪЕКТ.md, паспорт Дирижёра и ожидание на выходе; промпт — системой", async () => {
    const { runner, tasks } = recorder();
    const { crew } = await crewOf({ runner });

    await crew.result("estimate_review");

    const ludmila = tasks.find((t) => t.role === "Людмила")!;
    // Промпт роли — системой треда (developer_instructions), не текстом хода (А12).
    expect(ludmila.developerInstructions).toBe("ПРОМПТ Людмила");
    expect(ludmila.text).not.toContain("ПРОМПТ Людмила");
    expect(ludmila.text).toContain("ЯДРО");
    expect(ludmila.text).toContain("# ОБЪЕКТ ТЕСТ");
    expect(ludmila.text).toContain("ПАСПОРТ ВХОДА: домен=дороги");
    expect(ludmila.text).toContain(CREW_PLAN["estimate_review"]!.expects);
    // Смежник назван вместе с тем, где лежит его ответ.
    expect(ludmila.text).toContain("выход/Денчик.json");
    // Режим [БЕЗ БАЗЫ] объявляется тому, у кого базы нет, и только ему.
    await crew.result("work_schedule");
    expect(tasks.find((t) => t.role === "Тимофей")!.text).toContain("[БЕЗ БАЗЫ]");
    expect(ludmila.text).not.toContain("режим [БЕЗ БАЗЫ] (Ядро р.8): заяви");
  });
});

describe("веб-проверка цен", () => {
  it("разрешение и правила цитирования появляются во вводной только при включённом флаге", async () => {
    const off = recorder();
    await (await crewOf({ runner: off.runner })).crew.result("estimate_review");
    expect(off.tasks.find((t) => t.role === "Людмила")!.text).not.toContain("Рыночная проверка цен — инструментами платформы");

    const on = recorder();
    await (await crewOf({ runner: on.runner, webSearch: true })).crew.result("estimate_review");
    const text = on.tasks.find((t) => t.role === "Людмила")!.text;
    expect(text).toContain("Рыночная проверка цен — инструментами платформы");
    expect(text).toContain("`market_check`");
    // В сеть — инструментом платформы, не curl по поисковикам: три прогона показали CAPTCHA и подставную выдачу.
    expect(text).toContain("`инструменты/поиск");
    expect(text).toContain("`инструменты/страница <url>`");
    // Цифра из сети без источника и даты запрещена Ядром р.7 — правило названо.
    expect(text).toContain("[ИСТОЧНИК: <url>, <дата>");
  });

  it("экономист считает финмодель инструментом, а не в голове — независимо от флага сети", async () => {
    const { runner, tasks } = recorder();
    await (await crewOf({ runner })).crew.result("finance_model");
    const text = tasks.find((t) => t.role === "Ваныч")!.text;

    expect(text).toContain("## Финмодель считает код (ADR-V3-010)");
    expect(text).toContain("`инструменты/финмодель --цена <с НДС>");
    expect(text).toContain("[ИСТОЧНИК: инструменты/финмодель calculation.finance-model v1");
    expect(tasks.find((t) => t.role === "Людмила")!.text).not.toContain("## Финмодель считает код");
  });
});

describe("гейт Дирижёра (А4)", () => {
  it("гейт виден всем ролям, попадает разделом к Настеньке и вопросами дозагрузки, но прогон идёт", async () => {
    const { runner, tasks } = recorder((role) =>
      role === "Дирижёр"
        ? answer(role, { decision: "гейт", reload: [{ what: "договор подряда", why: "без него нет аудита Виктора", from: "заказчик", dueBy: "до такта 1" }] })
        : answer(role),
    );
    const { crew } = await crewOf({ runner });

    const nastya = await crew.result("object_passport");
    const artemy = await crew.result("object_verdict");

    expect(nastya.sections?.[0]?.id).toBe("dispatcher_route");
    expect(nastya.openQuestions?.some((q) => q.question.includes("договор подряда"))).toBe(true);
    expect(artemy.verdict).toContain("🟡 Артемий");

    for (const task of tasks.filter((t) => t.role !== "Дирижёр")) {
      expect(task.text, `${task.role} не узнал о гейте`).toContain("ГЕЙТ НЕПОЛНЫХ ДАННЫХ");
      expect(task.text).toContain("договор подряда");
    }
  });
});

describe("отказы и остановка", () => {
  it("отказ смежника не гасит роль: ей сказано, что смежник отказал", async () => {
    const { runner, tasks } = recorder(undefined, (role) => (role === "Денчик" ? "тред упал" : undefined));
    const { crew } = await crewOf({ runner });

    await expect(crew.result("tech_opinion")).rejects.toThrow("тред упал");
    const ludmila = await crew.result("estimate_review");

    expect(ludmila.verdict).toContain("🟡 Людмила");
    expect(tasks.find((t) => t.role === "Людмила")!.text).toContain("Денчик (роль Денчик): ОТКАЗАЛ — тред упал");
  });

  it("потерянная аренда останавливает следующий такт с CheckStopped, не зовя роли", async () => {
    let stop: string | undefined;
    const { runner, tasks } = recorder();
    const { crew } = await crewOf({ runner, stopRequested: () => stop });

    /**
     * СТОП СТАВИТСЯ ДО ЗАПРОСА РЕЗУЛЬТАТА, А НЕ МЕЖДУ ДВУМЯ ЗАПРОСАМИ.
     *
     * Прежде тест опирался на то, что первый результат возвращается, пока
     * поздние такты ещё идут. С появлением фазы возвратов (Ядро р.2, механизм
     * 2 образца) итоговое заключение роли известно только после всех тактов:
     * вернуть работу может лишь роль позднего такта, и до её хода ответ
     * раннего не окончателен.
     *
     * Проверяемое свойство от этого не изменилось: потеря аренды не даёт
     * следующему такту стартовать. Изменился момент, в который стоп ставится.
     */
    stop = "аренда потеряна";

    await expect(crew.result("finance_model")).rejects.toBeInstanceOf(CheckStopped);
    expect(order(tasks)).not.toContain("Ваныч");
  });

  it("ответы ролей ложатся в выход/<Имя>.json — их читают следующие такты", async () => {
    const { runner } = recorder();
    const { crew, space } = await crewOf({ runner });

    await crew.result("object_passport");

    const saved = JSON.parse(await readFile(join(space.root, "выход", "Настенька.json"), "utf8")) as { capability: string };
    expect(saved.capability).toBe("object_passport");
    expect(await readFile(join(space.root, "дирижёр.md"), "utf8")).toContain("МАРШРУТ: Классик C");
  });
});
