/**
 * РЕДАКЦИИ: ПОВТОРНЫЙ ПРОГОН ОБЪЕКТА ПРОДОЛЖАЕТ ПРЕЖНИЙ, А НЕ НАЧИНАЕТ ЗАНОВО.
 *
 * ЧЕГО НЕ БЫЛО. `RoleTask.threadId` объявлен словами «продолжить прежний тред
 * роли, если он был (Т9.5, память между прогонами)», клиент умеет
 * `resumeThread` — а передавать туда было нечего: экипаж только ЗАПИСЫВАЛ
 * идентификатор треда в след прогона. Каждый прогон объекта начинался с
 * чистого листа.
 *
 * ЧТО ЭТО СТОИЛО. Эталонная система вела редакции: в кейсах лежат «ВОР
 * итерация1» и «итерация2 ПОЛНЫЙ», «Реестр ИД ред1» и «ред2», «ПЭС-2025-ВК
 * ред.6». Повторный прогон запускают, когда пришла недостающая ЛСР или
 * ответили на открытый вопрос, — и роль, не помнящая прежней редакции, ставит
 * те же ⚠ на те же цифры. Человеку заново читать тридцать страниц, чтобы
 * понять, что изменилось.
 *
 * ПАМЯТЬ ЗДЕСЬ ДВУХСЛОЙНАЯ, И ПРОВЕРЯЮТСЯ ОБА СЛОЯ: продолжение треда (роль
 * видит собственные рассуждения) и выписка во вводной (работает даже когда
 * продолжать нечего — тред не пережил переезд выпуска).
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { startCrew, type CrewRole } from "./crew.js";
import { buildCoordinateIndex } from "./crew-output.js";
import { materializeWorkspace } from "./workspace.js";
import type { RoleRunner, RoleTask, RoleTurn } from "./codex-client.js";
import type { CollectedDuringCheck } from "../execution/check-ports.js";
import type { PreviousEditions } from "../execution/previous-edition.js";

const пусто = (): CollectedDuringCheck =>
  ({
    documentHashes: [],
    linearPositions: [],
    extracted: [],
    descriptors: [],
    designDocuments: [],
    designSheets: [],
  }) as unknown as CollectedDuringCheck;

function ответ(role: string): unknown {
  if (role === "Дирижёр") {
    return {
      passport: { domain: "дороги", side: "подрядчик", stage: "сметы", data: "нет", goal: "вердикт" },
      route: "Классик C",
      why: "—",
      decision: "маршрут",
      reload: [],
      handoffs: [],
      whatNext: "такт 0",
    };
  }

  return {
    verdict: `🟡 ${role}`,
    summary: [],
    findings: [],
    positions: [],
    sections: [],
    openQuestions: [],
    handoffs: [],
    returns: [],
    assumptions: [],
    alerts: [],
    nextTakt: "",
  };
}

const РОЛИ: readonly CrewRole[] = [
  { capability: "object_passport", person: "Настенька", role: "администратор", prompt: "П", promptSource: "доктрина", requiredSections: [] },
  { capability: "finance_model", person: "Ваныч", role: "экономист", prompt: "П", promptSource: "доктрина", requiredSections: [] },
  { capability: "object_verdict", person: "Артемий", role: "руководитель", prompt: "П", promptSource: "доктрина", requiredSections: [] },
] as unknown as readonly CrewRole[];

/** Прежняя редакция Ваныча: вердикт, находка и открытый вопрос. */
const ПРЕЖНЯЯ: PreviousEditions = {
  edition: 2,
  roles: [
    {
      capability: "finance_model",
      threadId: "тред-прошлой-недели",
      verdict: "🔴 маржа отрицательная при сметных ценах на битум",
      saidAt: "2026-09-01T10:00:00.000Z",
      findings: ["critical · битум по смете 21 300 ₽/т против рынка 55 000 ₽/т"],
      questions: ["Дата раскрытия аванса · с кого: заказчик · срок: 2026-09-05"],
    },
  ],
};

async function прогон(previous?: PreviousEditions) {
  const ходы: RoleTask[] = [];

  const runner: RoleRunner = async (task) => {
    ходы.push(task);
    await new Promise((resolve) => setTimeout(resolve, 3));
    return {
      output: ответ(task.role),
      finalResponse: "",
      commands: [],
      searches: [],
      errors: [],
      collab: [],
      threadId: `новый-${task.role}`,
      provider: "тест",
      model: "м",
      inputTokens: 1,
      outputTokens: 1,
    } as unknown as RoleTurn;
  };

  const space = await materializeWorkspace({
    root: await mkdtemp(join(tmpdir(), "редакция-")),
    label: "ТЕСТ",
    objectCode: "ТЕСТ",
    objectPath: await mkdtemp(join(tmpdir(), "партия-")),
    collected: пусто(),
    documents: [],
    roles: [],
    referenceBaseText: async () => undefined,
    normOf: () => undefined,
    bases: [],
    catalogue: [],
    coreRules: "ЯДРО",
  });

  const crew = startCrew({
    runner,
    workspace: space,
    roles: РОЛИ,
    dispatcherPrompt: "Д",
    coreRules: "ЯДРО",
    index: buildCoordinateIndex(пусто()),
    provider: "тест",
    model: "м",
    turnMinutes: 1,
    now: "2026-09-08T12:00:00.000Z",
    ...(previous === undefined ? {} : { previous }),
  });

  await crew.result("object_verdict");
  return ходы;
}

describe("редакции объекта", () => {
  it("ход роли продолжает её прежний тред по этому объекту", async () => {
    const ходы = await прогон(ПРЕЖНЯЯ);
    const ваныч = ходы.find((t) => t.role === "Ваныч")!;

    expect(ваныч.threadId).toBe("тред-прошлой-недели");
  }, 60_000);

  it("прежнее заключение стоит во вводной до того, как роль начнёт отвечать", async () => {
    const ходы = await прогон(ПРЕЖНЯЯ);
    const ваныч = ходы.find((t) => t.role === "Ваныч")!;

    // Роль, узнавшая о повторе через две тысячи знаков, уже отвечает как впервые.
    expect(ваныч.text.indexOf("ЭТО РЕДАКЦИЯ 2")).toBeLessThan(700);
    // Находка и вопрос прежней редакции перенесены дословно: по ним роль
    // отчитывается «закрыто / осталось», а пересказ своими словами такой
    // отчётности не даёт.
    expect(ваныч.text).toContain("битум по смете 21 300 ₽/т против рынка 55 000 ₽/т");
    expect(ваныч.text).toContain("Дата раскрытия аванса");
    expect(ваныч.text).toContain("ЧТО ИЗМЕНИЛОСЬ С ПРОШЛОЙ РЕДАКЦИИ");
  }, 60_000);

  it("роль без прежней редакции работает как впервые — и не слышит про редакцию 2", async () => {
    const ходы = await прогон(ПРЕЖНЯЯ);
    const настенька = ходы.find((t) => t.role === "Настенька")!;

    expect(настенька.threadId).toBeUndefined();
    expect(настенька.text).not.toContain("ЭТО РЕДАКЦИЯ");
  }, 60_000);

  it("первый прогон объекта не превращается в редакцию", async () => {
    const ходы = await прогон();

    expect(ходы.every((t) => t.threadId === undefined)).toBe(true);
    expect(ходы.every((t) => !t.text.includes("ЭТО РЕДАКЦИЯ"))).toBe(true);
  }, 60_000);

  it("мёртвый тред не мешает памяти: выписка во вводной остаётся", async () => {
    // Так выглядит редакция после переезда выпуска: rollout треда не пережил
    // сервер, и `crew-reviewers` снял идентификатор — но не выписку.
    const { threadId: _мёртвый, ...безТреда } = ПРЕЖНЯЯ.roles[0]!;
    const ходы = await прогон({ edition: 3, roles: [безТреда] });
    const ваныч = ходы.find((t) => t.role === "Ваныч")!;

    expect(ваныч.threadId).toBeUndefined();
    expect(ваныч.text).toContain("ЭТО РЕДАКЦИЯ 3");
    expect(ваныч.text).toContain("Прежнего разговора у тебя перед глазами нет");
  }, 60_000);
});
