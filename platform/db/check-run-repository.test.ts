/**
 * Тесты написаны до реализации. M2, §5.6: воркер переживает рестарт.
 *
 * Проверяется утверждение, ради которого состояние вообще пишется в базу:
 * прерванный прогон продолжается с того места, где остановился, и даёт тот же
 * результат, что непрерывный. Пока это не проверено, «переживает рестарт» —
 * обещание, а не свойство.
 *
 * Тесты идут против НАСТОЯЩЕГО PostgreSQL: изоляция арендатора и уникальность
 * предмета в прогоне — свойства схемы, и подделка их в памяти ничего бы не
 * доказала.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrismaClient, withTenant } from "./prisma.js";
import { CheckRunRepository } from "./check-run-repository.js";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL === undefined || DATABASE_URL === "" ? describe.skip : describe;

const tenantA = randomUUID();
const tenantB = randomUUID();
const userA = randomUUID();
const objectA = randomUUID();
const objectB = randomUUID();

describeDb("состояние прогона Проверки", () => {
  // Свой клиент на файл: общий синглтон рвётся чужим disconnect().
  const db = createPrismaClient(DATABASE_URL);
  const repository = new CheckRunRepository();

  const start = () =>
    withTenant(db, tenantA, (tx) =>
      repository.start(tx, {
        tenantId: tenantA,
        objectId: objectA,
        workflowId: "full-check",
        createdBy: userA,
      }),
    );

  beforeAll(async () => {
    await db.tenant.createMany({
      data: [
        { id: tenantA, slug: `run-a-${tenantA.slice(0, 8)}`, displayName: "А" },
        { id: tenantB, slug: `run-b-${tenantB.slice(0, 8)}`, displayName: "Б" },
      ],
    });

    // Пользователи и объекты живут под RLS, поэтому сеются в контексте своего
    // арендатора. Таблица арендаторов политике не подчиняется — она и есть
    // то, по чему политика различает строки.
    await withTenant(db, tenantA, async (tx) => {
      await tx.user.create({
        data: { id: userA, tenantId: tenantA, email: `a-${userA.slice(0, 8)}@x`, displayName: "А" },
      });
      await tx.projectObject.create({
        data: { id: objectA, tenantId: tenantA, code: `A-${objectA.slice(0, 8)}`, name: "Объект А" },
      });
    });

    await withTenant(db, tenantB, async (tx) => {
      await tx.projectObject.create({
        data: { id: objectB, tenantId: tenantB, code: `B-${objectB.slice(0, 8)}`, name: "Объект Б" },
      });
    });
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await db.$disconnect();
  });

  it("заводит прогон и отдаёт его идентификатор", async () => {
    const run = await start();

    expect(run.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(run.status).toBe("running");
  });

  it("сохраняет состояние предметов и возвращает его при возобновлении", async () => {
    const run = await start();

    await withTenant(db, tenantA, (tx) =>
      repository.saveSubjects(tx, tenantA, run.id, [
        { id: "вор-геометрия", status: "approved", returnedCount: 0 },
        { id: "вор", status: "returned", returnedCount: 1 },
      ]),
    );

    const resumed = await withTenant(db, tenantA, (tx) => repository.resume(tx, run.id));

    expect(resumed?.subjects.get("вор-геометрия")?.status).toBe("approved");
    expect(resumed?.subjects.get("вор")?.status).toBe("returned");
    expect(resumed?.subjects.get("вор")?.returnedCount).toBe(1);
  });

  it("обновляет предмет, а не плодит его копии", async () => {
    // Предмет один на прогон: два ВОР в одном прогоне — это потерянная
    // история возвратов и неизвестно какой из них действующий.
    const run = await start();

    await withTenant(db, tenantA, (tx) => repository.saveSubjects(tx, tenantA, run.id, [{ id: "вор", status: "draft", returnedCount: 0 }]));
    await withTenant(db, tenantA, (tx) => repository.saveSubjects(tx, tenantA, run.id, [{ id: "вор", status: "returned", returnedCount: 1 }]));
    await withTenant(db, tenantA, (tx) => repository.saveSubjects(tx, tenantA, run.id, [{ id: "вор", status: "approved", returnedCount: 1 }]));

    const resumed = await withTenant(db, tenantA, (tx) => repository.resume(tx, run.id));

    expect(resumed?.subjects.size).toBe(1);
    expect(resumed?.subjects.get("вор")?.status).toBe("approved");
    expect(resumed?.subjects.get("вор")?.returnedCount).toBe(1);
  });

  it("помнит, какие шаги уже исполнены, чтобы не делать их дважды", async () => {
    // «Переживает рестарт БЕЗ повторной загрузки» (§5.6): исполненный шаг не
    // должен исполняться заново, иначе рестарт стоит столько же, сколько
    // прогон с нуля.
    const run = await start();

    await withTenant(db, tenantA, (tx) => repository.markStepDone(tx, tenantA, run.id, "такт-0", "настенька"));
    await withTenant(db, tenantA, (tx) => repository.markStepDone(tx, tenantA, run.id, "такт-1", "денчик"));

    const resumed = await withTenant(db, tenantA, (tx) => repository.resume(tx, run.id));

    expect(resumed?.completedSteps).toContain("такт-0/настенька");
    expect(resumed?.completedSteps).toContain("такт-1/денчик");
    expect(resumed?.completedSteps).not.toContain("такт-1/людмила");
  });

  it("не отдаёт прогон чужому арендатору", async () => {
    // Изоляция арендатора — свойство запроса, а не надежда на то, что
    // идентификатор никто не подберёт.
    const run = await start();

    expect(await withTenant(db, tenantB, (tx) => repository.resume(tx, run.id))).toBeUndefined();
  });

  it("не даёт чужому арендатору дописать предметы в прогон", async () => {
    // Одного RLS здесь мало: проверка внешнего ключа идёт в обход политики,
    // поэтому арендатор Б смог бы привязать свой предмет к чужому прогону.
    // Владение проверяется в коде — это первый рубеж по ADR-R-016.
    const run = await start();

    await expect(
      withTenant(db, tenantB, (tx) =>
        repository.saveSubjects(tx, tenantB, run.id, [
          { id: "вор", status: "approved", returnedCount: 0 },
        ]),
      ),
    ).rejects.toThrow();
  });

  it("завершённый прогон помечается завершённым и больше не возобновляется", async () => {
    const run = await start();

    await withTenant(db, tenantA, (tx) => repository.finish(tx, run.id, "completed"));
    const resumed = await withTenant(db, tenantA, (tx) => repository.resume(tx, run.id));

    expect(resumed).toBeUndefined();
  });

  it("прогон, ждущий человека, возобновляем: эскалация — не конец", async () => {
    // Цикл возврата исчерпан, нужен человек. Это пауза, а не провал:
    // после решения человека прогон обязан продолжиться, а не начаться заново.
    const run = await start();

    await withTenant(db, tenantA, (tx) => repository.finish(tx, run.id, "awaiting_human"));
    const resumed = await withTenant(db, tenantA, (tx) => repository.resume(tx, run.id));

    expect(resumed).toBeDefined();
    expect(resumed?.status).toBe("awaiting_human");
  });
});
