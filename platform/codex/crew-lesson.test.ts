/**
 * УРОК ОБЪЕКТА ДОЕЗЖАЕТ ДО ЧЕЛОВЕКА — И НЕ ЗАПИСЫВАЕТ САМ СЕБЯ В ПРАВИЛА.
 *
 * ЧТО БЫЛО. У роли есть накопитель приёмов (`config/agents/<роль>/deltas.md`):
 * он читается, склеивается с доктриной и входит в отпечаток прогона. Растёт он
 * только рукой человека. В эталонной системе накопитель — живой механизм: у
 * сметчика 41 приём, и каждый снят с боевого объекта («строка по ₽/м² скрывает
 * физику — разверни её в поштучную ВОР от РД»). У нас роль, встретившая на
 * объекте новый приём, уносила его с собой: сказать о нём было некуда.
 *
 * ПОЧЕМУ ПРЕДЛОЖЕНИЕ, А НЕ ЗАПИСЬ. Дельта меняет ответы роли на ВСЕХ будущих
 * объектах. Прогон, записывающий её сам, получил бы право переписать правила
 * для всех объектов на основании одного — и сделал бы это молча.
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { startCrew, type CrewRole } from "./crew.js";
import { buildCoordinateIndex } from "./crew-output.js";
import { materializeWorkspace } from "./workspace.js";
import type { RoleRunner, RoleTurn } from "./codex-client.js";
import type { CollectedDuringCheck } from "../execution/check-ports.js";

const УРОК = "встретил смету контракта без ЛСР → считай от ведомости объёмов и помечай точность ±15 %, потому что ждать ЛСР значит не дать результата вовсе";

const пусто = (): CollectedDuringCheck =>
  ({
    documentHashes: [],
    linearPositions: [],
    extracted: [],
    descriptors: [],
    designDocuments: [],
    designSheets: [],
  }) as unknown as CollectedDuringCheck;

function ответ(role: string, lesson: string): unknown {
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
    lesson,
  };
}

const РОЛИ: readonly CrewRole[] = [
  { capability: "finance_model", person: "Ваныч", role: "экономист", prompt: "П", promptSource: "доктрина", requiredSections: [] },
  { capability: "object_verdict", person: "Артемий", role: "руководитель", prompt: "П", promptSource: "доктрина", requiredSections: [] },
] as unknown as readonly CrewRole[];

async function прогон(уроки: Record<string, string>) {
  const runner: RoleRunner = async (task) => {
    await new Promise((resolve) => setTimeout(resolve, 3));
    return {
      output: ответ(task.role, уроки[task.role] ?? ""),
      finalResponse: "",
      commands: [],
      searches: [],
      errors: [],
      collab: [],
      threadId: "t",
      provider: "тест",
      model: "м",
      inputTokens: 1,
      outputTokens: 1,
    } as unknown as RoleTurn;
  };

  const space = await materializeWorkspace({
    root: await mkdtemp(join(tmpdir(), "урок-")),
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
  });

  const review = await crew.result("finance_model");
  await crew.result("object_verdict");
  return { review, root: space.root };
}

describe("урок объекта", () => {
  it("становится листом заключения — тем же путём, что и остальные листы пакета", async () => {
    const { review } = await прогон({ Ваныч: УРОК });
    const лист = review.sections?.find((section) => section.id === "lesson");

    expect(лист, "урок роли никуда не попал").toBeDefined();
    expect(лист?.rows[0]?.[0]).toBe(УРОК);
    expect(лист?.rows[0]?.[1]).toContain("Ваныч");
  }, 60_000);

  it("помечен предложением: запись в накопитель — решение человека", async () => {
    const { review } = await прогон({ Ваныч: УРОК });
    const строка = review.sections?.find((section) => section.id === "lesson")?.rows[0]?.[2] ?? "";

    // Урок, попавший в правила роли молча, изменил бы её ответы на всех
    // будущих объектах по итогам одного прогона.
    expect(строка).toContain("человек");
  }, 60_000);

  it("собирается в файл прогона по всем ролям, а не теряется в заключениях", async () => {
    const { root } = await прогон({ Ваныч: УРОК, Артемий: "второй урок" });
    const файл = await readFile(join(root, "выход", "УРОКИ.md"), "utf8");

    expect(файл).toContain(УРОК);
    expect(файл).toContain("второй урок");
    expect(файл).toContain("Ваныч");
  }, 60_000);

  it("объект не научил новому — листа нет, и это законный ответ", async () => {
    const { review } = await прогон({});

    expect(review.sections?.some((section) => section.id === "lesson")).toBe(false);
  }, 60_000);
});
