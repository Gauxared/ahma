/**
 * ВОЗВРАТ РАБОТЫ СМЕЖНИКУ — механизм 2 эталонной системы.
 *
 * ЧЕГО НЕ БЫЛО. Замерено на боевом прогоне 08.09.2026: одиннадцать ролей
 * выдали 59 блоков смежникам и НОЛЬ возвратов. Причина была не в ролях —
 * возврат было нечем выразить: в схеме ответа есть «блок для смежника» (что
 * передаю дальше) и не было «не принимаю» (что возвращаю назад).
 *
 * ПОЧЕМУ ЭТО РАЗНЫЕ ОПЕРАЦИИ. Блок движет работу вперёд и ничего не отменяет.
 * Возврат ОСТАНАВЛИВАЕТ: результат смежника использовать нельзя, и пока он не
 * переделан, всё, что на нём стоит, держится на песке. В образце это отдельный
 * документ пакета, а Ядро р.4 прямо запрещает принимать слабый ответ.
 *
 * ЧТО ПРОВЕРЯЕТСЯ ЗДЕСЬ: возврат не остаётся текстом в чужом заключении, а
 * ЗАПУСКАЕТ РАБОТУ — адресат получает ход ещё раз, с требованием во вводной, и
 * в пакет уходит исправленная редакция, а не прежняя.
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

const пусто = (): CollectedDuringCheck =>
  ({
    documentHashes: [],
    linearPositions: [],
    extracted: [],
    descriptors: [],
    designDocuments: [],
    designSheets: [],
  }) as unknown as CollectedDuringCheck;

function ответ(role: string, returns: unknown[] = []): unknown {
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
    returns,
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

async function прогон(returnsFrom: Record<string, unknown[]>) {
  const ходы: RoleTask[] = [];

  const runner: RoleRunner = async (task) => {
    ходы.push(task);
    await new Promise((resolve) => setTimeout(resolve, 3));
    // Возврат выдаётся ТОЛЬКО в первый ход роли: во второй она «исправилась».
    const первый = ходы.filter((t) => t.role === task.role).length === 1;
    const turn: RoleTurn = {
      output: ответ(task.role, первый ? (returnsFrom[task.role] ?? []) : []),
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
    return turn;
  };

  const space = await materializeWorkspace({
    root: await mkdtemp(join(tmpdir(), "возврат-")),
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

  return { crew, ходы };
}

describe("возврат работы смежнику", () => {
  it("запускает повторный ход адресата, а не остаётся текстом", async () => {
    const { crew, ходы } = await прогон({
      Артемий: [{ to: "Ваныч", notAccepted: "финмодель", missing: "три сценария маржи и дата кассового разрыва", dueBy: "2026-09-10" }],
    });

    await crew.result("object_verdict");

    // Ваныч ходил ДВАЖДЫ: первый раз по такту, второй — по возврату Артемия.
    expect(ходы.filter((t) => t.role === "Ваныч")).toHaveLength(2);
  }, 60_000);

  it("во вводной переделки первым стоит, что именно не принято", async () => {
    const { crew, ходы } = await прогон({
      Артемий: [{ to: "Ваныч", notAccepted: "финмодель", missing: "три сценария маржи", dueBy: "2026-09-10" }],
    });

    await crew.result("object_verdict");
    const переделка = ходы.filter((t) => t.role === "Ваныч")[1]!;

    // Роль, узнавшая о непринятом результате через две тысячи знаков, уже
    // начала отвечать по-прежнему.
    expect(переделка.text.indexOf("НЕ ПРИНЯТ")).toBeLessThan(200);
    expect(переделка.text).toContain("три сценария маржи");
    expect(переделка.text).toContain("Артемий");
  }, 60_000);

  it("возвращать можно один раз на роль: второй возврат не запускает третий ход", async () => {
    const { crew, ходы } = await прогон({
      Артемий: [
        { to: "Ваныч", notAccepted: "финмодель", missing: "сценарии", dueBy: "10.09" },
        { to: "Ваныч", notAccepted: "финмодель", missing: "и ещё раз сценарии", dueBy: "11.09" },
      ],
    });

    await crew.result("object_verdict");

    // Второй возврат по образцу означает «сделать самому» — это решение
    // человека, а не оркестратора, и бесконечный круг здесь недопустим.
    expect(ходы.filter((t) => t.role === "Ваныч")).toHaveLength(2);
  }, 60_000);

  it("возврат несуществующей роли никого не запускает и прогон не роняет", async () => {
    const { crew, ходы } = await прогон({
      Артемий: [{ to: "Кого-нет", notAccepted: "что-то", missing: "что-то", dueBy: "10.09" }],
    });

    await expect(crew.result("object_verdict")).resolves.toBeDefined();
    expect(ходы.filter((t) => t.role === "Ваныч")).toHaveLength(1);
  }, 60_000);
});
