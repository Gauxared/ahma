/**
 * Read-модель рабочего экрана Проверки против НАСТОЯЩЕЙ базы.
 *
 * ЧТО ИМЕННО ПРОВЕРЯЕТСЯ
 *
 * Не «страница открывается», а два утверждения, на которых экран стоит:
 *
 * 1. Исполненный шаг ПРОЧИТАН из базы и помечен `derived: false`.
 * 2. Нестартовавший шаг с непройденным предусловием ВЫЧИСЛЕН тем же
 *    предикатом, что у протокола, помечен `derived: true` и несёт последствие
 *    нарушения.
 *
 * Второе важнее первого. Экран показывает блокировки, которых в базе нет, и без
 * этого теста расхождение между «что показано» и «что было» обнаружилось бы
 * только глазами человека, знающего протокол наизусть.
 *
 * Плюс граница арендатора: проверка ищется ВМЕСТЕ с объектом, поэтому чужая
 * проверка не открывается ни по прямой ссылке, ни подстановкой чужого шифра.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, withTenant } from "@platform/db/prisma";

import { readCheck } from "./check-read-model";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined || DATABASE_URL === "" ? describe.skip : describe;

describeDb("рабочий экран Проверки", () => {
  const db = createPrismaClient(DATABASE_URL);
  const свой = randomUUID();
  const чужой = randomUUID();
  let checkId = "";
  let чужаяПроверка = "";

  beforeAll(async () => {
    await db.tenant.createMany({
      data: [
        { id: свой, slug: `chk-own-${свой.slice(0, 8)}`, displayName: "Свой" },
        { id: чужой, slug: `chk-other-${чужой.slice(0, 8)}`, displayName: "Чужой" },
      ],
    });

    for (const [tenant, code, target] of [
      [свой, "CHK-OWN", "свой"],
      [чужой, "CHK-OTHER", "чужой"],
    ] as const) {
      await withTenant(db, tenant, async (tx) => {
        const object = await tx.projectObject.create({ data: { tenantId: tenant, code, name: `Объект ${code}` } });
        const check = await tx.check.create({
          data: {
            tenantId: tenant,
            objectId: object.id,
            workflowId: "full-check",
            mode: "standard",
            createdBy: randomUUID(),
            status: "awaiting_human",
          },
        });

        if (target === "свой") {
          checkId = check.id;

          // Такт 0 исполнен, его предметы подтверждены.
          await tx.checkStep.create({
            data: { tenantId: tenant, checkId: check.id, stage: "такт-0", agent: "настенька", status: "исполнен" },
          });
          await tx.gateSubject.createMany({
            data: [
              { tenantId: tenant, checkId: check.id, subjectId: "паспорт-объекта", status: "approved" },
              { tenantId: tenant, checkId: check.id, subjectId: "реестр-поручений", status: "approved" },
              // ВОР возвращён — ровно тот случай, ради которого гейт и заведён.
              { tenantId: tenant, checkId: check.id, subjectId: "вор-геометрия", status: "returned", returnedCount: 1 },
            ],
          });

          // Виктор отработал, но записи ШАГА у него нет — ровно то положение,
          // в котором живёт весь путь клиента: `CheckRunRepository` зовёт
          // только командная строка, а воркер пишет прогоны агентов.
          await tx.agentRun.create({
            data: {
              tenantId: tenant,
              checkId: check.id,
              agentId: "contract_audit",
              stage: "агенты по сметам",
              status: "исполнен",
              scope: "объект",
              subject: "объект",
            },
          });
        } else {
          чужаяПроверка = check.id;
        }
      });
    }
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: { in: [свой, чужой] } } });
    await db.$disconnect();
  });

  it("исполненный шаг прочитан из базы, а не вычислен", async () => {
    const card = await readCheck(свой, "CHK-OWN", checkId);
    const шаг = card?.stages.flatMap((stage) => stage.steps).find((step) => step.agent === "настенька");

    expect(шаг?.status).toBe("исполнен");
    expect(шаг?.derived).toBe(false);
    expect(шаг?.doneAt).not.toBeNull();
  });

  it("шаг, чей агент ОТРАБОТАЛ, исполнен — даже без записи шага", async () => {
    /**
     * Записи шагов пишет `CheckRunRepository`, а его зовёт только командная
     * строка. На пути клиента — веб и воркер — шагов в базе нет вовсе, и доска
     * показывала «настенька не выполнялся» ровно тогда, когда Настенька
     * отработала и дала девять замечаний.
     *
     * Ложное утверждение об уже сделанной работе. На встрече читается как
     * «конвейер не пошёл».
     */
    const card = await readCheck(свой, "CHK-OWN", checkId);
    const шаг = card?.stages.flatMap((stage) => stage.steps).find((step) => step.agent === "виктор");

    expect(шаг?.status, "агент отработал, а доска говорит, что шага не было").toBe("исполнен");
    // Но ВЫВЕДЕН, а не прочитан: возвраты и попытки отсюда не восстановить, и
    // выдавать вывод за запись нельзя.
    expect(шаг?.derived).toBe(true);
  });

  it("шаг с возвращённым предметом заблокирован, вычислен и назвал последствие", async () => {
    const card = await readCheck(свой, "CHK-OWN", checkId);
    const шаг = card?.stages.flatMap((stage) => stage.steps).find((step) => step.agent === "людмила");

    expect(шаг?.status).toBe("заблокирован");
    expect(шаг?.derived).toBe(true);

    const блок = шаг?.blocks.find((block) => block.subject === "вор-геометрия");
    expect(блок?.actual).toBe("returned");
    // Отказ без цены ошибки человек обходит; проверяем, что цена есть.
    expect(блок?.consequence).toBeTruthy();
  });

  it("состояние предметов отдаётся целиком, вместе со счётчиком возвратов", async () => {
    const card = await readCheck(свой, "CHK-OWN", checkId);
    const вор = card?.subjects.find((subject) => subject.id === "вор-геометрия");

    expect(вор?.status).toBe("returned");
    expect(вор?.returnedCount).toBe(1);
  });

  it("чужая проверка не открывается по прямой ссылке", async () => {
    expect(await readCheck(свой, "CHK-OTHER", чужаяПроверка)).toBeUndefined();
    // И подстановка своего шифра к чужому идентификатору тоже не открывает.
    expect(await readCheck(свой, "CHK-OWN", чужаяПроверка)).toBeUndefined();
  });

  it("без арендатора данные не отдаются вовсе", async () => {
    await expect(readCheck("", "CHK-OWN", checkId)).rejects.toThrow(/Арендатор не задан/);
  });
});
