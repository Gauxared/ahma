/**
 * ПРЕЖНЯЯ РЕДАКЦИЯ ПРОТИВ НАСТОЯЩЕЙ БАЗЫ.
 *
 * ПОЧЕМУ НЕ НА ЗАГЛУШКЕ. Проверять здесь надо ровно то, чего заглушка не
 * покажет: отбор идёт ПО СВЯЗИ `agent_run → check → object` под политикой RLS,
 * и ошибиться в нём можно молча. Пустой список выглядит как «объект пришёл
 * впервые» — то есть как законный ответ, а не как сбой; ровно так уже терялись
 * позиции ролей, и повторять эту ошибку в механизме памяти нельзя.
 *
 * Три свойства ломаются молча и потому проверяются каждое:
 *
 *  · берётся ПОСЛЕДНЕЕ, что роль сказала об объекте, а не последний прогон:
 *    отказ роли в прошлый раз не должен стирать её память;
 *  · идущий прогон исключён — иначе роль получила бы «прежней редакцией» саму
 *    себя, начатую минуту назад;
 *  · чужой объект того же арендатора в редакцию не попадает.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, withTenant } from "../db/prisma.js";

import { loadPreviousEditions } from "./previous-edition.js";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined || DATABASE_URL === "" ? describe.skip : describe;

describeDb("прежние редакции объекта", () => {
  const db = createPrismaClient(DATABASE_URL);
  const tenant = randomUUID();
  const objectCode = `EDI-${tenant.slice(0, 8)}`;

  let objectId = "";
  let другойОбъект = "";
  /** Прогоны по возрастанию времени: первый — самый старый. */
  const прогоны: string[] = [];
  let идущий = "";

  beforeAll(async () => {
    await db.tenant.create({
      data: { id: tenant, slug: `edition-${tenant.slice(0, 8)}`, displayName: "Редакции" },
    });

    await withTenant(db, tenant, async (tx) => {
      const object = await tx.projectObject.create({
        data: { tenantId: tenant, code: objectCode, name: "Объект редакций" },
      });
      objectId = object.id;

      const foreign = await tx.projectObject.create({
        data: { tenantId: tenant, code: `${objectCode}-X`, name: "Соседний объект" },
      });
      другойОбъект = foreign.id;

      const check = async (target: string, status: "completed" | "running"): Promise<string> => {
        const row = await tx.check.create({
          data: {
            tenantId: tenant,
            objectId: target,
            workflowId: "full-check",
            mode: "standard",
            createdBy: randomUUID(),
            status,
          },
        });
        return row.id;
      };

      прогоны.push(await check(objectId, "completed"));
      прогоны.push(await check(objectId, "completed"));
      идущий = await check(objectId, "running");

      const run = async (input: {
        checkId: string;
        agentId: string;
        status: string;
        verdict?: string;
        threadId?: string;
        finishedAt: string;
        findings?: unknown;
        questions?: unknown;
      }): Promise<void> => {
        await tx.agentRun.create({
          data: {
            tenantId: tenant,
            checkId: input.checkId,
            agentId: input.agentId,
            stage: "объектные агенты",
            subject: "объект",
            scope: "объект",
            status: input.status,
            ...(input.verdict === undefined ? {} : { verdict: input.verdict }),
            ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
            finishedAt: new Date(input.finishedAt),
            ...(input.findings === undefined ? {} : { findings: input.findings as never }),
            ...(input.questions === undefined ? {} : { questions: input.questions as never }),
          },
        });
      };

      // Редакция 1: обе роли высказались.
      await run({
        checkId: прогоны[0]!,
        agentId: "finance_model",
        status: "исполнен",
        verdict: "🔴 редакция 1 Ваныча",
        threadId: "тред-ваныча-1",
        finishedAt: "2026-09-01T10:00:00.000Z",
        findings: [{ severity: "critical", statement: "битум дороже сметы" }],
        questions: [{ question: "дата аванса", owner: "заказчик", dueBy: "2026-09-05" }],
      });
      await run({
        checkId: прогоны[0]!,
        agentId: "estimate_review",
        status: "исполнен",
        verdict: "🟡 редакция 1 Людмилы",
        threadId: "тред-людмилы-1",
        finishedAt: "2026-09-01T10:05:00.000Z",
      });

      // Редакция 2: Ваныч высказался снова, Людмила ОТКАЗАЛА.
      await run({
        checkId: прогоны[1]!,
        agentId: "finance_model",
        status: "исполнен",
        verdict: "🟡 редакция 2 Ваныча",
        threadId: "тред-ваныча-2",
        finishedAt: "2026-09-04T10:00:00.000Z",
        findings: [{ severity: "critical", statement: "битум дороже сметы" }],
        questions: [{ question: "дата аванса", owner: "заказчик", dueBy: "2026-09-05" }],
      });
      await run({
        checkId: прогоны[1]!,
        agentId: "estimate_review",
        status: "отказ",
        verdict: "не отвечать",
        threadId: "тред-людмилы-2",
        finishedAt: "2026-09-04T10:05:00.000Z",
      });

      // Идущий прогон: Ваныч уже что-то сказал минуту назад.
      await run({
        checkId: идущий,
        agentId: "finance_model",
        status: "исполнен",
        verdict: "сам себе редакция",
        threadId: "тред-идущий",
        finishedAt: "2026-09-08T10:00:00.000Z",
      });

      // Соседний объект того же арендатора.
      const чужой = await check(другойОбъект, "completed");
      await run({
        checkId: чужой,
        agentId: "object_verdict",
        status: "исполнен",
        verdict: "чужой объект",
        finishedAt: "2026-09-06T10:00:00.000Z",
      });
    });
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: tenant } });
    await db.$disconnect();
  });

  it("роль получает ПОСЛЕДНЕЕ своё заключение, а идущий прогон исключён", async () => {
    const editions = await loadPreviousEditions({ db, tenantId: tenant, objectId, exceptCheckId: идущий });
    const ваныч = editions.roles.find((r) => r.capability === "finance_model");

    expect(ваныч?.verdict).toBe("🟡 редакция 2 Ваныча");
    expect(ваныч?.threadId).toBe("тред-ваныча-2");
  });

  it("отказ прошлого прогона не стирает память: берётся редакция до него", async () => {
    const editions = await loadPreviousEditions({ db, tenantId: tenant, objectId, exceptCheckId: идущий });
    const людмила = editions.roles.find((r) => r.capability === "estimate_review");

    // Строка отказа свежее, но это не заключение — последнее СКАЗАННОЕ лежит
    // в редакции 1, и продолжать надо её тред.
    expect(людмила?.verdict).toBe("🟡 редакция 1 Людмилы");
    expect(людмила?.threadId).toBe("тред-людмилы-1");
  });

  it("находки и вопросы прежней редакции переносятся строками", async () => {
    const editions = await loadPreviousEditions({ db, tenantId: tenant, objectId, exceptCheckId: идущий });
    const ваныч = editions.roles.find((r) => r.capability === "finance_model");

    expect(ваныч?.findings).toEqual(["critical · битум дороже сметы"]);
    expect(ваныч?.questions).toEqual(["дата аванса · с кого: заказчик · срок: 2026-09-05"]);
  });

  it("номер редакции считает завершённые прогоны этого объекта", async () => {
    const editions = await loadPreviousEditions({ db, tenantId: tenant, objectId, exceptCheckId: идущий });

    // Два завершённых прогона позади — идущий третий.
    expect(editions.edition).toBe(3);
  });

  it("соседний объект в редакцию не попадает", async () => {
    const editions = await loadPreviousEditions({ db, tenantId: tenant, objectId, exceptCheckId: идущий });

    expect(editions.roles.map((r) => r.capability)).not.toContain("object_verdict");
  });

  it("объект без прошлого — первая редакция и пустой список", async () => {
    const свежий = await withTenant(db, tenant, (tx) =>
      tx.projectObject.create({ data: { tenantId: tenant, code: `${objectCode}-N`, name: "Впервые" } }),
    );

    const editions = await loadPreviousEditions({
      db,
      tenantId: tenant,
      objectId: свежий.id,
      exceptCheckId: randomUUID(),
    });

    expect(editions.edition).toBe(1);
    expect(editions.roles).toEqual([]);
  });
});
