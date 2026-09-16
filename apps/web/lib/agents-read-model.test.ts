/**
 * Доска агентов на ИДУЩЕМ прогоне — веха Д2 плана демо.
 *
 * ЧТО ИМЕННО ПРОВЕРЯЕТСЯ, И ПОЧЕМУ ИМЕННО ЭТО
 *
 * Не «доска открывается», а четыре утверждения, без которых показ по мере
 * готовности не работает:
 *
 * 1. Агент, начавший работу, отличён от не запускавшегося. До Д2 они
 *    выглядели одинаково, и на двадцатой минуте прогона доска сообщала
 *    «высказалось 0 из 9» про девять работающих агентов.
 * 2. Замечания высказавшегося агента видны ДО конца прогона — то есть берутся
 *    из хода, когда артефакта ещё нет.
 * 3. Такие замечания ПОМЕЧЕНЫ предварительными: попытка агента может быть
 *    переиграна, и смешивать их с итоговыми значит обесценить итоговые.
 * 4. Артефакт, когда он появился, ГЛАВНЕЕ хода: канонический результат не
 *    подменяется записью о попытке.
 *
 * Гейт идёт по МЕХАНИЗМУ, а не по данным конкретного прогона: способность
 * берётся из реестра по имени агента из воркфлоу, а не пишется литералом. Набор
 * на литерал уже подводил этот проект — в свежем прогоне у сметчика замечаний
 * не оказалось, и зелёный тест ничего не значил.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadWorkflows } from "@platform/config/workflow-loader";
import { createPrismaClient, withTenant } from "@platform/db/prisma";

import { agentRoster } from "./agent-roles";
import { readAgentsBoard } from "./agents-read-model";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined || DATABASE_URL === "" ? describe.skip : describe;

/**
 * Два агента первого такта, найденные ПО ВОРКФЛОУ И РЕЕСТРУ.
 *
 * Так гейт остаётся гейтом механизма: переименуют агента в воркфлоу — набор
 * поедет за ним, а не станет зелёным на несуществующей способности.
 */
function двоеИзПервогоТакта(): readonly [string, string] {
  const workflow = loadWorkflows("config/workflows").find((bundle) => bundle.value.id === "full-check");
  const roster = agentRoster();
  const byPerson = new Map([...roster.values()].map((identity) => [identity.person.toLowerCase(), identity.capability]));

  const capabilities = (workflow?.value.stages ?? [])
    .flatMap((stage) => stage.steps)
    .map((step) => byPerson.get(step.agent.toLowerCase()))
    .filter((capability): capability is string => capability !== undefined);

  const [первый, второй] = capabilities;

  if (первый === undefined || второй === undefined) {
    throw new Error("в воркфлоу full-check меньше двух агентов, известных реестру: гейт проверять нечего");
  }

  return [первый, второй];
}

describeDb("доска агентов на идущем прогоне", () => {
  const db = createPrismaClient(DATABASE_URL);
  const tenant = randomUUID();
  const [высказавшийся, работающий] = двоеИзПервогоТакта();
  let живой = "";
  let завершённый = "";

  beforeAll(async () => {
    await db.tenant.create({
      data: { id: tenant, slug: `agents-live-${tenant.slice(0, 8)}`, displayName: "Ход прогона" },
    });

    await withTenant(db, tenant, async (tx) => {
      const object = await tx.projectObject.create({
        data: { tenantId: tenant, code: "AGN-LIVE", name: "Объект хода прогона" },
      });

      const running = await tx.check.create({
        data: {
          tenantId: tenant,
          objectId: object.id,
          workflowId: "full-check",
          mode: "standard",
          createdBy: randomUUID(),
          status: "running",
          startedAt: new Date(),
          phase: "агенты по сметам",
          documentsTotal: 4,
          documentsDone: 4,
        },
      });

      живой = running.id;

      // Задача очереди — часть идущего прогона: «живым» read-модель считает
      // тот, у которого есть чем продолжиться. Проверка без задачи не идёт, она
      // числится, и опрашивать её экраном незачем.
      await tx.job.create({
        data: {
          tenantId: tenant,
          checkId: running.id,
          type: "check",
          payload: { objectPath: "объект", objectCode: "AGN-LIVE" },
          payloadHash: "0".repeat(64),
          idempotencyKey: `набор-доски:${running.id}`,
          status: "running",
        },
      });

      await tx.agentRun.createMany({
        data: [
          {
            tenantId: tenant,
            checkId: running.id,
            agentId: высказавшийся,
            subject: "объект/ЛСР-1.xlsx",
            stage: "агенты по сметам",
            scope: "документ",
            status: "исполнен",
            startedAt: new Date(),
            finishedAt: new Date(),
            verdict: "смета к работе пригодна",
            findings: [
              {
                severity: "critical",
                statement: "расценка задвоена",
                basis: "позиции 12 и 48",
                // Координата — как её кладёт оболочка агента: ссылка на
                // источник целиком, а не отдельное поле «строка».
                source: {
                  sourceId: "объект/ЛСР-1.xlsx",
                  contentHash: "a".repeat(64),
                  locator: { kind: "row", sheet: "Раздел 3", row: 48 },
                  status: "fact",
                  acquisition: "parsed",
                  checkedAt: "2026-09-04",
                  staleAfterDays: 90,
                },
              },
              // Второе замечание БЕЗ координаты: разницу и проверяем.
              { severity: "medium", statement: "объём без подтверждения", basis: "лист 2" },
            ],
            questions: [
              { question: "запросить исполнительную по земляным работам", owner: "ПТО", dueBy: "2026-09-10" },
            ],
          },
          {
            tenantId: tenant,
            checkId: running.id,
            agentId: работающий,
            subject: "объект/ЛСР-1.xlsx",
            stage: "агенты по сметам",
            scope: "документ",
            status: "выполняется",
            startedAt: new Date(),
          },
        ],
      });

      // Второй прогон: то же самое, но артефакт УЖЕ есть, и он главнее хода.
      const finished = await tx.check.create({
        data: {
          tenantId: tenant,
          objectId: object.id,
          workflowId: "full-check",
          mode: "standard",
          createdBy: randomUUID(),
          status: "completed",
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      });

      завершённый = finished.id;

      await tx.agentRun.create({
        data: {
          tenantId: tenant,
          checkId: finished.id,
          agentId: высказавшийся,
          subject: "объект/ЛСР-1.xlsx",
          stage: "агенты по сметам",
          scope: "документ",
          status: "исполнен",
          startedAt: new Date(),
          finishedAt: new Date(),
          findings: [{ severity: "low", statement: "запись хода", basis: "попытка прогона" }],
        },
      });

      await tx.artifact.create({
        data: {
          tenantId: tenant,
          checkId: finished.id,
          operationId: "check-object",
          operationVersion: 1,
          completeness: "full",
          inputHashes: [],
          body: {
            objectPath: "объект",
            documents: [],
            totals: {},
            gates: [],
            verdict: "принято",
            review: {
              requested: true,
              findings: 1,
              failed: 0,
              bySeverity: { high: 1 },
              documents: [
                {
                  path: "объект/ЛСР-1.xlsx",
                  capability: высказавшийся,
                  verdict: "итог из артефакта",
                  findings: [{ severity: "high", statement: "запись артефакта", basis: "тело результата" }],
                },
              ],
            },
          },
        },
      });
    });
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: tenant } });
    await db.$disconnect();
  });

  it("работающий агент отличён от не запускавшегося и не считается высказавшимся", async () => {
    const board = await readAgentsBoard(tenant, "AGN-LIVE", живой);
    const агенты = board?.tacts.flatMap((tact) => tact.agents) ?? [];

    expect(агенты.find((agent) => agent.capability === работающий)?.state.kind).toBe("работает");
    expect(агенты.find((agent) => agent.capability === высказавшийся)?.state.kind).toBe("высказался");
    // Ключевое число экрана: работающий в «высказалось» не входит.
    expect(board?.spoke).toBe(1);
    expect(board?.working).toBe(1);
    // И остальные агенты конвейера по-прежнему не запускались.
    expect(агенты.filter((agent) => agent.state.kind === "не-запускался").length).toBeGreaterThan(0);
  });

  it("замечания высказавшегося агента видны до конца прогона и помечены предварительными", async () => {
    const board = await readAgentsBoard(tenant, "AGN-LIVE", живой);
    const агент = board?.tacts
      .flatMap((tact) => tact.agents)
      .find((candidate) => candidate.capability === высказавшийся);

    expect(агент?.findings.map((finding) => finding.statement)).toContain("расценка задвоена");
    expect(агент?.preliminary).toBe(true);
    expect(board?.preliminary).toBe(true);
    // Критичное замечание доезжает до «что убьёт проект» — того места, ради
    // которого доску и открывают на встрече.
    expect(board?.critical.map((item) => item.finding.statement)).toContain("расценка задвоена");
    expect(board?.findings).toBe(2);
    // Прогон объявлен живым: без этого экран не обновляется сам.
    expect(board?.live).toBe(true);
    expect(board?.phase).toBe("агенты по сметам");
    expect(board?.documentsDone).toBe(4);
  });

  /**
   * ВЕХА Д3: источник у вывода.
   *
   * Проверяется то, ради чего веха заведена: замечание доводит читателя до
   * листа и строки, а замечание без координаты ОТЛИЧИМО от него словом. Ровно
   * это условие задачи называет «одной из главных особенностей продукта», и
   * ровно здесь легко получить худший исход — показать оба одинаково.
   */
  it("замечание несёт лист и строку словами человека, а не ключами артефакта", async () => {
    const board = await readAgentsBoard(tenant, "AGN-LIVE", живой);
    const агент = board?.tacts
      .flatMap((tact) => tact.agents)
      .find((candidate) => candidate.capability === высказавшийся);

    const сСледом = агент?.findings.find((finding) => finding.statement === "расценка задвоена");

    expect(сСледом?.source?.where).toBe("лист «Раздел 3», строка 48");
    // Лист и строка отдельно — по ним строится переход к позиции сметы.
    expect(сСледом?.source?.row).toBe(48);
    expect(сСледом?.document).toBe("ЛСР-1.xlsx");
    // Слова, а не `fact` и `parsed`: внутреннее имя контракта на экран не течёт.
    expect(сСледом?.source?.status).toBe("факт");
    expect(сСледом?.source?.acquisition).toBe("разобрано из файла");
  });

  it("замечание без координаты отличимо от замечания со следом", async () => {
    const board = await readAgentsBoard(tenant, "AGN-LIVE", живой);
    const агент = board?.tacts
      .flatMap((tact) => tact.agents)
      .find((candidate) => candidate.capability === высказавшийся);

    const безСледа = агент?.findings.find((finding) => finding.statement === "объём без подтверждения");

    // `null`, а не выдуманная координата: «лист, строка 0» отправила бы
    // читателя искать строку, которой в документе нет.
    expect(безСледа?.source).toBeNull();
  });

  /**
   * ВЕРДИКТ ПОДПИСАН ПРЕДМЕТОМ.
   *
   * Вердикты склеивались в одну строку через `; `, а список предметов лежал
   * рядом отдельным полем: по четырём вердиктам и четырём именам файлов нельзя
   * было сказать, какой вердикт о какой смете. Связь терялась НЕОБРАТИМО — из
   * склеенной строки её уже не восстановить, — и терялась молча.
   */
  it("вердикт из хода прогона подписан предметом, а не склеен в абзац", async () => {
    const board = await readAgentsBoard(tenant, "AGN-LIVE", живой);
    const агент = board?.tacts
      .flatMap((tact) => tact.agents)
      .find((candidate) => candidate.capability === высказавшийся);

    expect(агент?.verdicts).toEqual([
      { subject: "ЛСР-1.xlsx", light: null, text: "смета к работе пригодна" },
    ]);
  });

  it("что проверить человеку доходит до доски с владельцем и сроком", async () => {
    const board = await readAgentsBoard(tenant, "AGN-LIVE", живой);
    const агент = board?.tacts
      .flatMap((tact) => tact.agents)
      .find((candidate) => candidate.capability === высказавшийся);

    expect(агент?.openQuestions).toEqual([
      { question: "запросить исполнительную по земляным работам", owner: "ПТО", dueBy: "2026-09-10" },
    ]);
  });

  it("артефакт главнее хода прогона: запись о попытке не подменяет результат", async () => {
    const board = await readAgentsBoard(tenant, "AGN-LIVE", завершённый);
    const агент = board?.tacts
      .flatMap((tact) => tact.agents)
      .find((candidate) => candidate.capability === высказавшийся);

    expect(агент?.findings.map((finding) => finding.statement)).toEqual(["запись артефакта"]);
    expect(агент?.preliminary).toBe(false);
    expect(board?.preliminary).toBe(false);
    expect(board?.live).toBe(false);
  });
});
