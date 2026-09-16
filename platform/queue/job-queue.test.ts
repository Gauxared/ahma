/**
 * Очередь против НАСТОЯЩЕГО PostgreSQL — роадмап M6, ТЗ §5.6.
 *
 * ТЗ §5.6: «Проверки в режимах "стандарт" и "эксперт" выполняются асинхронно.
 * Интерфейс не блокирует пользователя на время расчёта.» Роадмап M6: «Очередь с
 * состоянием, уведомлением, отменой и ВОССТАНОВЛЕНИЕМ».
 *
 * ПОЧЕМУ ЭТО НЕЛЬЗЯ ПРОВЕРИТЬ МОКОМ
 *
 * Всё, ради чего очередь на базе и делается, живёт в свойствах базы: два
 * воркера не берут одну задачу благодаря `FOR UPDATE SKIP LOCKED`, а
 * восстановление после падения — благодаря истечению аренды. Мок подтвердит
 * любую из этих гарантий, ни одной не проверив.
 *
 * ГЛАВНОЕ СВОЙСТВО — НЕ «ЗАДАЧА ВЫПОЛНИЛАСЬ», А «ЗАДАЧА НЕ ПОТЕРЯЛАСЬ И НЕ
 * ВЫПОЛНИЛАСЬ ДВАЖДЫ»
 *
 * Проверка стоимостью в часы работы модели, выполненная дважды, — это двойной
 * счёт по внешнему контуру. Потерянная — это пользователь, ждущий результата,
 * которого никто не считает.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createPrismaClient, withTenant } from "@platform/db/prisma.js";

import { JobQueue } from "./job-queue.js";
import type { ClaimedJob } from "./job-queue.js";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined || DATABASE_URL === "" ? describe.skip : describe;

/**
 * Забрать задачу, ДОПУСКАЯ, что первая попытка вернёт «работы нет».
 *
 * ПОЧЕМУ ПОВТОР — ЭТО НЕ СМЯГЧЕНИЕ ПРОВЕРКИ
 *
 * `claim` устроен как `LIMIT 1` над `FOR UPDATE SKIP LOCKED`. План запроса —
 * `Limit → LockRows → Sort → Seq Scan` — и это значит: строка, на которую в
 * момент блокировки наложен чужой замок, ПРОПУСКАЕТСЯ, а `LIMIT 1` уже
 * исчерпан, и запрос возвращает пустоту. `SKIP LOCKED` для того и выбран: он
 * предпочитает ответить «сейчас работы нет», а не ждать. Немедленность —
 * свойство, которого очередь никогда не обещала.
 *
 * Наблюдение, из-за которого это написано: набор падал примерно раз на пятьсот
 * прогонов на трёх РАЗНЫХ тестах, и все три имели одну форму — «поставили и тут
 * же забрали». Прогон вне vitest подтвердил то же самое: строка в той же
 * транзакции ВИДНА, `status = 'queued'`, предикат по `notBefore` выполняется, а
 * `claim` возвращает `undefined`. Промах воспроизводился только под нагрузкой.
 *
 * Чего я НЕ установил: какая транзакция держала замок. Поэтому здесь не
 * «исправление claim» — правка механизма, которого я не назвал, была бы
 * гаданием, — а приведение теста к тому, что очередь действительно гарантирует.
 *
 * В работе это ничего не стоит: воркер опрашивает очередь раз в две секунды,
 * промах откладывает задачу на один опрос и ничего не теряет.
 *
 * Что тест продолжает проверять в полную силу: задачу забрали, забрал её ИМЕННО
 * этот владелец, аренда выдана, и повторный `claim` её уже не отдаст. Ослаблено
 * ровно одно — что это случится с первой попытки.
 */
async function claimUntilFound(
  attempt: () => Promise<ClaimedJob | undefined>,
  tries = 5,
): Promise<ClaimedJob | undefined> {
  for (let i = 0; i < tries; i += 1) {
    const claimed = await attempt();
    if (claimed !== undefined) return claimed;
  }

  return undefined;
}

describeDb("очередь задач", () => {
  const db = createPrismaClient(DATABASE_URL);
  const queue = new JobQueue();
  const tenant = randomUUID();
  const now = new Date("2026-09-01T10:00:00.000Z");

  beforeAll(async () => {
    await db.tenant.create({
      data: { id: tenant, slug: `q-${tenant.slice(0, 8)}`, displayName: "Очередь" },
    });
  });

  // Очередь у арендатора ОДНА, и задача, оставшаяся от прошлого теста, будет
  // выдана раньше только что поставленной: `claim` берёт по `notBefore`, а не
  // по тому, чего ждёт тест. Первая версия тестов этого не учитывала и падала
  // на четырёх проверках, показывая при этом верное поведение очереди.
  beforeEach(async () => {
    await withTenant(db, tenant, (tx) => tx.job.deleteMany({}));
  });

  afterAll(async () => {
    const ownerUrl = process.env.DATABASE_OWNER_URL;
    await db.$disconnect();

    if (ownerUrl === undefined || ownerUrl === "") return;
    const owner = createPrismaClient(ownerUrl);
    try {
      await owner.tenant.delete({ where: { id: tenant } });
    } finally {
      await owner.$disconnect();
    }
  });

  const enqueue = (key: string, at = now) =>
    withTenant(db, tenant, (tx) =>
      queue.enqueue(tx, {
        tenantId: tenant,
        type: "check",
        payload: { object: "KRG-1" },
        idempotencyKey: key,
        now: at,
      }),
    );

  it("ставит задачу в очередь", async () => {
    const job = await enqueue(`k-${randomUUID()}`);

    expect(job.status).toBe("queued");
    expect(job.attempts).toBe(0);
  });

  it("НЕ ставит вторую задачу с тем же ключом идемпотентности", async () => {
    // Повторное нажатие «Проверить» не должно считать объект дважды: это часы
    // работы модели и двойной счёт по внешнему контуру.
    const key = `k-${randomUUID()}`;
    const первая = await enqueue(key);
    const вторая = await enqueue(key);

    expect(вторая.id).toBe(первая.id);
    expect(вторая.deduplicated).toBe(true);
  });

  it("выдаёт задачу воркеру с арендой", async () => {
    const key = `k-${randomUUID()}`;
    await enqueue(key);

    const claimed = await claimUntilFound(() =>
      withTenant(db, tenant, (tx) => queue.claim(tx, { owner: "воркер-1", now, leaseSeconds: 60 })),
    );

    expect(claimed?.idempotencyKey).toBe(key);
    expect(claimed?.status).toBe("running");
    expect(claimed?.attempts).toBe(1);
  });

  it("НЕ выдаёт одну задачу двум воркерам", async () => {
    // Свойство базы, а не кода: `FOR UPDATE SKIP LOCKED`.
    const key = `k-${randomUUID()}`;
    await enqueue(key);

    const первый = await claimUntilFound(() =>
      withTenant(db, tenant, (tx) => queue.claim(tx, { owner: "воркер-1", now, leaseSeconds: 60 })),
    );
    // Второй — ОДНОЙ попыткой: повтор здесь превратил бы проверку «двум не
    // выдаётся» в её противоположность.
    const второй = await withTenant(db, tenant, (tx) =>
      queue.claim(tx, { owner: "воркер-2", now, leaseSeconds: 60 }),
    );

    expect(первый?.idempotencyKey).toBe(key);
    // Второй воркер не получил НИЧЕГО: другой задачи в очереди нет.
    expect(второй).toBeUndefined();
  });

  it("НЕ выдаёт задачу раньше её времени", async () => {
    // Повтор после ошибки ставится с отсрочкой: взять его сразу значит
    // повторить ошибку в том же состоянии мира.
    const позже = new Date(now.getTime() + 3_600_000);
    await enqueue(`k-${randomUUID()}`, позже);

    const claimed = await withTenant(db, tenant, (tx) =>
      queue.claim(tx, { owner: "воркер-1", now, leaseSeconds: 60 }),
    );

    expect(claimed).toBeUndefined();
  });

  it("ВОЗВРАЩАЕТ задачу после падения воркера", async () => {
    // Воркер упал, не сняв аренду. Без истечения аренды задача осталась бы в
    // состоянии running навсегда, и пользователь ждал бы результата, которого
    // никто не считает.
    const key = `k-${randomUUID()}`;
    await enqueue(key);

    await claimUntilFound(() =>
      withTenant(db, tenant, (tx) => queue.claim(tx, { owner: "упавший", now, leaseSeconds: 60 })),
    );

    const послеИстечения = new Date(now.getTime() + 120_000);
    const claimed = await claimUntilFound(() =>
      withTenant(db, tenant, (tx) =>
        queue.claim(tx, { owner: "воркер-2", now: послеИстечения, leaseSeconds: 60 }),
      ),
    );

    expect(claimed?.idempotencyKey).toBe(key);
    expect(claimed?.attempts).toBe(2);
  });

  it("СЧИТАЕТ попытку при возврате по истечении аренды", async () => {
    // Иначе задача, роняющая воркер, крутится вечно: каждый новый воркер берёт
    // её, падает, и счётчик не растёт.
    const key = `k-${randomUUID()}`;
    await enqueue(key);

    let момент = now;
    for (let i = 0; i < 3; i += 1) {
      await claimUntilFound(() =>
        withTenant(db, tenant, (tx) =>
          queue.claim(tx, { owner: `воркер-${i}`, now: момент, leaseSeconds: 60 }),
        ),
      );
      момент = new Date(момент.getTime() + 120_000);
    }

    const job = await withTenant(db, tenant, (tx) =>
      tx.job.findUnique({ where: { idempotencyKey: key } }),
    );

    expect(job?.attempts).toBe(3);
  });

  it("продлевает аренду по heartbeat", async () => {
    // Долгая задача не должна быть отобрана у работающего воркера.
    const key = `k-${randomUUID()}`;
    await enqueue(key);

    const claimed = await claimUntilFound(() =>
      withTenant(db, tenant, (tx) => queue.claim(tx, { owner: "воркер-1", now, leaseSeconds: 60 })),
    );

    const через30 = new Date(now.getTime() + 30_000);
    await withTenant(db, tenant, (tx) =>
      queue.heartbeat(tx, claimed!.id, { owner: "воркер-1", now: через30, leaseSeconds: 60 }),
    );

    // Момент выбран ВНУТРИ продлённой аренды, а не на её границе: исходная
    // аренда истекала в +60, продлённая — в +90, и проверка ровно в +90
    // проверяла бы, считается ли истёкшей аренда, кончающаяся сию секунду.
    // Это отдельный вопрос, и смешивать его с проверкой продления незачем.
    const через80 = new Date(now.getTime() + 80_000);
    const другой = await withTenant(db, tenant, (tx) =>
      queue.claim(tx, { owner: "воркер-2", now: через80, leaseSeconds: 60 }),
    );

    expect(другой).toBeUndefined();
  });

  it("НЕ даёт продлить чужую аренду", async () => {
    // Иначе воркер, чью задачу уже отобрали, продолжит держать её и приведёт к
    // двойному исполнению.
    const key = `k-${randomUUID()}`;
    await enqueue(key);

    const claimed = await claimUntilFound(() =>
      withTenant(db, tenant, (tx) => queue.claim(tx, { owner: "воркер-1", now, leaseSeconds: 60 })),
    );

    const held = await withTenant(db, tenant, (tx) =>
      queue.heartbeat(tx, claimed!.id, { owner: "самозванец", now, leaseSeconds: 60 }),
    );

    expect(held).toBe(false);
  });
});

describeDb("завершение, повтор и отмена", () => {
  const db = createPrismaClient(DATABASE_URL);
  const queue = new JobQueue();
  const tenant = randomUUID();
  const now = new Date("2026-09-01T10:00:00.000Z");

  beforeAll(async () => {
    await db.tenant.create({
      data: { id: tenant, slug: `r-${tenant.slice(0, 8)}`, displayName: "Повторы" },
    });
  });

  beforeEach(async () => {
    await withTenant(db, tenant, (tx) => tx.job.deleteMany({}));
  });

  afterAll(async () => {
    const ownerUrl = process.env.DATABASE_OWNER_URL;
    await db.$disconnect();

    if (ownerUrl === undefined || ownerUrl === "") return;
    const owner = createPrismaClient(ownerUrl);
    try {
      await owner.tenant.delete({ where: { id: tenant } });
    } finally {
      await owner.$disconnect();
    }
  });

  const enqueue = (key: string, maxAttempts = 5) =>
    withTenant(db, tenant, (tx) =>
      queue.enqueue(tx, {
        tenantId: tenant,
        type: "check",
        payload: {},
        idempotencyKey: key,
        now,
        maxAttempts,
      }),
    );

  it("завершает задачу", async () => {
    const key = `k-${randomUUID()}`;
    await enqueue(key);
    const claimed = await claimUntilFound(() =>
      withTenant(db, tenant, (tx) => queue.claim(tx, { owner: "в", now, leaseSeconds: 60 })),
    );

    await withTenant(db, tenant, (tx) => queue.complete(tx, claimed!.id, { owner: "в", now }));

    const job = await withTenant(db, tenant, (tx) =>
      tx.job.findUnique({ where: { idempotencyKey: key } }),
    );

    expect(job?.status).toBe("completed");
    expect(job?.leaseOwner).toBeNull();
  });

  it("ставит повтор С ОТСРОЧКОЙ после ошибки", async () => {
    // Немедленный повтор воспроизводит ошибку в том же состоянии мира: база всё
    // ещё недоступна, файл всё ещё занят.
    const key = `k-${randomUUID()}`;
    await enqueue(key);
    const claimed = await claimUntilFound(() =>
      withTenant(db, tenant, (tx) => queue.claim(tx, { owner: "в", now, leaseSeconds: 60 })),
    );

    await withTenant(db, tenant, (tx) =>
      queue.fail(tx, claimed!.id, { owner: "в", now, error: "база недоступна" }),
    );

    const job = await withTenant(db, tenant, (tx) =>
      tx.job.findUnique({ where: { idempotencyKey: key } }),
    );

    expect(job?.status).toBe("queued");
    expect(job!.notBefore.getTime()).toBeGreaterThan(now.getTime());
  });

  it("ОБЪЯВЛЯЕТ задачу мёртвой после исчерпания попыток", async () => {
    // Бесконечный повтор — это не надёжность, а бесконечная трата внешнего
    // контура на задачу, которая не выполнится.
    const key = `k-${randomUUID()}`;
    await enqueue(key, 2);

    let момент = now;
    for (let i = 0; i < 2; i += 1) {
      const claimed = await claimUntilFound(() =>
        withTenant(db, tenant, (tx) =>
          queue.claim(tx, { owner: "в", now: момент, leaseSeconds: 60 }),
        ),
      );
      expect(claimed).toBeDefined();

      await withTenant(db, tenant, (tx) =>
        queue.fail(tx, claimed!.id, { owner: "в", now: момент, error: "не вышло" }),
      );
      момент = new Date(момент.getTime() + 3_600_000);
    }

    const job = await withTenant(db, tenant, (tx) =>
      tx.job.findUnique({ where: { idempotencyKey: key } }),
    );

    expect(job?.status).toBe("dead");
    expect(JSON.stringify(job?.lastError)).toContain("не вышло");
  });

  it("отменяет задачу, ждущую в очереди", async () => {
    const key = `k-${randomUUID()}`;
    const job = await enqueue(key);

    const cancelled = await withTenant(db, tenant, (tx) =>
      queue.cancel(tx, job.id, { now, reason: "передумали" }),
    );

    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.wasRunning).toBe(false);
  });

  it("НЕ выдаёт отменённую задачу воркеру", async () => {
    const key = `k-${randomUUID()}`;
    const job = await enqueue(key);
    await withTenant(db, tenant, (tx) => queue.cancel(tx, job.id, { now, reason: "передумали" }));

    const claimed = await withTenant(db, tenant, (tx) =>
      queue.claim(tx, { owner: "в", now, leaseSeconds: 60 }),
    );

    expect(claimed).toBeUndefined();
  });

  it("отмена ВЫПОЛНЯЮЩЕЙСЯ задачи помечается как требующая согласия воркера", async () => {
    // Убить чужой процесс отсюда нельзя. Честный ответ — «отмена записана,
    // воркер остановится на ближайшей проверке», а не «отменено».
    const key = `k-${randomUUID()}`;
    const job = await enqueue(key);
    await claimUntilFound(() =>
      withTenant(db, tenant, (tx) => queue.claim(tx, { owner: "в", now, leaseSeconds: 60 })),
    );

    const cancelled = await withTenant(db, tenant, (tx) =>
      queue.cancel(tx, job.id, { now, reason: "передумали" }),
    );

    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.wasRunning).toBe(true);
  });

  it("воркер УЗНАЁТ об отмене и не заканчивает работу впустую", async () => {
    const key = `k-${randomUUID()}`;
    const job = await enqueue(key);
    const claimed = await claimUntilFound(() =>
      withTenant(db, tenant, (tx) => queue.claim(tx, { owner: "в", now, leaseSeconds: 60 })),
    );

    await withTenant(db, tenant, (tx) => queue.cancel(tx, job.id, { now, reason: "передумали" }));

    const stop = await withTenant(db, tenant, (tx) => queue.cancelRequested(tx, claimed!.id));

    expect(stop).toBe(true);
  });

  it("НЕ завершает отменённую задачу как выполненную", async () => {
    // Воркер, дошедший до конца после отмены, не должен переписать её исход:
    // пользователь видел «отменено» и не ждёт результата.
    const key = `k-${randomUUID()}`;
    const job = await enqueue(key);
    const claimed = await claimUntilFound(() =>
      withTenant(db, tenant, (tx) => queue.claim(tx, { owner: "в", now, leaseSeconds: 60 })),
    );
    await withTenant(db, tenant, (tx) => queue.cancel(tx, job.id, { now, reason: "передумали" }));

    await withTenant(db, tenant, (tx) => queue.complete(tx, claimed!.id, { owner: "в", now }));

    const stored = await withTenant(db, tenant, (tx) =>
      tx.job.findUnique({ where: { idempotencyKey: key } }),
    );

    expect(stored?.status).toBe("cancelled");
  });
  it("исход по УЖЕ ИСЧЕЗНУВШЕЙ задаче не бросает", async () => {
    // Проверяет ранний возврат по чтению — он работал и до правки гонки.
    // Оставлен потому, что это отдельный контракт: `Job` привязан к Проверке
    // каскадом, удаление Проверки уносит задачи, и воркер обязан пережить это,
    // а не падать. Гонку между чтением и записью здесь НЕ проверить: строка
    // удаляется до вызова, и до записи дело не доходит (см. следующий тест).
    const job = await enqueue(`k-${randomUUID()}`);
    const claimed = await claimUntilFound(() =>
      withTenant(db, tenant, (tx) => queue.claim(tx, { owner: "г", now, leaseSeconds: 60 })),
    );
    expect(claimed?.id).toBe(job.id);

    await withTenant(db, tenant, (tx) => tx.job.delete({ where: { id: job.id } }));

    await expect(
      withTenant(db, tenant, (tx) => queue.fail(tx, job.id, { owner: "г", now, error: "неважно" })),
    ).resolves.toBeUndefined();

    const outcome = await withTenant(db, tenant, (tx) =>
      queue.cancel(tx, job.id, { now, reason: "неважно" }),
    );
    expect(outcome.cancelled).toBe(false);
  });
});

/**
 * Контракт записи исхода, отдельно от базы.
 *
 * Дефект, который здесь закрывается, был таким: строка существует на чтении и
 * исчезает до записи — `Job` привязан к Проверке каскадом. `update` в этом окне
 * бросает `P2025` и валит ВЕСЬ воркер: процесс умирает из-за того, что строки
 * не стало.
 *
 * Гонку не воспроизвести снаружи одного вызова `fail`: между его чтением и
 * записью не вклиниться. Поэтому проверяется само следствие правки — исход
 * пишется ОДНИМ условным выражением, и когда оно затронуло ноль строк, метод
 * возвращает «аренда потеряна», а не бросает.
 *
 * Подстановка минимальна намеренно: она не умеет `update`. Прежняя реализация
 * на этом тесте падает — именно за этим он и написан.
 */
describe("исход задачи пишется одним выражением", () => {
  const queue = new JobQueue();
  const now = new Date("2026-09-02T12:00:00.000Z");

  const stub = (count: number) =>
    ({
      job: {
        findUnique: async () => ({
          id: "j",
          attempts: 1,
          maxAttempts: 3,
          status: "running",
          leaseOwner: "в",
          notBefore: now,
        }),
        updateMany: async () => ({ count }),
      },
    }) as never;

  it("запись, затронувшая ноль строк, даёт «аренда потеряна», а не исключение", async () => {
    await expect(queue.fail(stub(0), "j", { owner: "в", now, error: "неважно" })).resolves.toBeUndefined();
  });

  it("удавшаяся запись возвращает новое состояние", async () => {
    await expect(queue.fail(stub(1), "j", { owner: "в", now, error: "неважно" })).resolves.toBe("queued");
  });
});
