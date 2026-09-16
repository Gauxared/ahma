/**
 * Запись хода прогона против НАСТОЯЩЕЙ базы — веха Д2 плана демо.
 *
 * ПОЧЕМУ НЕ НА ЗАГЛУШКЕ. Проверять здесь надо ровно то, чего заглушка не
 * покажет: что событие доезжает до строки в базе СВОЕЙ транзакцией. Вся
 * ценность механизма в этом — прогон идёт тридцать шесть минут вне транзакции,
 * и запись, сделанная вместе с итогом, стала бы видна тогда же, когда итог, то
 * есть была бы бесполезной.
 *
 * Плюс два свойства, которые ломаются молча:
 *
 *  · повторное «начал» по той же паре «агент + предмет» не заводит вторую
 *    строку — иначе доска покажет двух Людмил, и обе будут «правдой»;
 *  · переигранная попытка стирает замечания прошлой, а не показывает их
 *    рядом с новыми.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, withTenant } from "../db/prisma.js";

import { buildProgressReporter } from "./check-progress.js";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined || DATABASE_URL === "" ? describe.skip : describe;

describeDb("ход прогона в базе", () => {
  const db = createPrismaClient(DATABASE_URL);
  const tenant = randomUUID();
  let checkId = "";

  beforeAll(async () => {
    await db.tenant.create({
      data: { id: tenant, slug: `progress-${tenant.slice(0, 8)}`, displayName: "Ход прогона" },
    });

    await withTenant(db, tenant, async (tx) => {
      const object = await tx.projectObject.create({
        data: { tenantId: tenant, code: "PRG-1", name: "Объект хода" },
      });

      const check = await tx.check.create({
        data: {
          tenantId: tenant,
          objectId: object.id,
          workflowId: "full-check",
          mode: "standard",
          createdBy: randomUUID(),
          status: "running",
        },
      });

      checkId = check.id;
    });
  });

  afterAll(async () => {
    await db.tenant.delete({ where: { id: tenant } });
    await db.$disconnect();
  });

  it("этап и счёт документов доходят до Проверки, а не остаются в памяти воркера", async () => {
    const report = buildProgressReporter({ db, tenantId: tenant, checkId });

    await report({ kind: "этап", phase: "обход папки" });
    await report({ kind: "обход", documents: 4 });
    await report({ kind: "документ", path: "объект/ЛСР-1.xlsx", status: "проверен", done: 1, total: 4 });

    const check = await withTenant(db, tenant, (tx) =>
      tx.check.findUniqueOrThrow({ where: { id: checkId } }),
    );

    expect(check.phase).toBe("обход папки");
    expect(check.documentsTotal).toBe(4);
    expect(check.documentsDone).toBe(1);
  });

  it("высказавшийся агент появляется строкой со своими замечаниями", async () => {
    const report = buildProgressReporter({ db, tenantId: tenant, checkId });

    await report({
      kind: "агент-начал",
      capability: "estimate_review",
      subject: "объект/ЛСР-1.xlsx",
      scope: "документ",
    });

    const начатый = await withTenant(db, tenant, (tx) =>
      tx.agentRun.findFirstOrThrow({ where: { checkId, agentId: "estimate_review" } }),
    );

    expect(начатый.status).toBe("выполняется");
    expect(начатый.startedAt).not.toBeNull();
    expect(начатый.finishedAt).toBeNull();

    await report({
      kind: "агент-высказался",
      scope: "документ",
      outcome: {
        path: "объект/ЛСР-1.xlsx",
        capability: "estimate_review",
        verdict: "смета к работе пригодна",
        findings: [{ severity: "critical", statement: "расценка задвоена", basis: "позиции 12 и 48" }],
      },
    });

    const строки = await withTenant(db, tenant, (tx) =>
      tx.agentRun.findMany({ where: { checkId, agentId: "estimate_review" } }),
    );

    // Одна строка, а не две: «начал» и «высказался» — про один прогон агента.
    expect(строки).toHaveLength(1);
    expect(строки[0]?.status).toBe("исполнен");
    expect(строки[0]?.verdict).toBe("смета к работе пригодна");
    expect(JSON.stringify(строки[0]?.findings)).toContain("расценка задвоена");
  });

  it("отказ агента записан отказом с причиной, а не пустыми замечаниями", async () => {
    const report = buildProgressReporter({ db, tenantId: tenant, checkId });

    await report({
      kind: "агент-высказался",
      scope: "объект",
      outcome: {
        path: "объект",
        scope: "объект",
        capability: "finance_model",
        findings: [],
        error: "не хватает выручки из договора",
      },
    });

    const строка = await withTenant(db, tenant, (tx) =>
      tx.agentRun.findFirstOrThrow({ where: { checkId, agentId: "finance_model" } }),
    );

    expect(строка.status).toBe("отказ");
    expect(JSON.stringify(строка.error)).toContain("не хватает выручки");
  });

  it("переигранная попытка стирает замечания прошлой, а не кладёт их рядом", async () => {
    const report = buildProgressReporter({ db, tenantId: tenant, checkId });

    await report({
      kind: "агент-начал",
      capability: "estimate_review",
      subject: "объект/ЛСР-1.xlsx",
      scope: "документ",
    });

    const строка = await withTenant(db, tenant, (tx) =>
      tx.agentRun.findFirstOrThrow({ where: { checkId, agentId: "estimate_review" } }),
    );

    expect(строка.status).toBe("выполняется");
    expect(строка.findings).toBeNull();
    expect(строка.verdict).toBeNull();
    expect(строка.finishedAt).toBeNull();
  });

  it("сбой записи назван вслух и проброшен обходу, а не проглочен", async () => {
    const сказано: string[] = [];
    const report = buildProgressReporter({
      db,
      tenantId: tenant,
      // Прогона с таким идентификатором нет: строку обновлять нечему.
      checkId: randomUUID(),
      log: (message) => void сказано.push(message),
    });

    await expect(report({ kind: "этап", phase: "синтез" })).rejects.toThrow();
    expect(сказано.join(" ")).toContain("не записано");
  });
});
