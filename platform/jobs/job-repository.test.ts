/**
 * Очередь проверяется против настоящего PostgreSQL: SKIP LOCKED, аренда и
 * идемпотентность — это поведение СУБД, моками его не подтвердить.
 */
import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { JobRepository } from "./job-repository.js";

const OWNER_URL = process.env.DATABASE_OWNER_URL;
const describeDb = OWNER_URL === undefined || OWNER_URL === "" ? describe.skip : describe;

describeDb("очередь задач на PostgreSQL", () => {
  const client = new Client({ connectionString: OWNER_URL });
  const repository = new JobRepository(client);
  const tenantId = randomUUID();

  beforeAll(async () => {
    await client.connect();
    await client.query(
      `INSERT INTO tenant (id, slug, "displayName") VALUES ($1, $2, $3)`,
      [tenantId, `queue-${tenantId.slice(0, 8)}`, "Очередь"],
    );
    // Остатки прошлых прогонов не должны попадать в выборку claim().
    await client.query(`DELETE FROM job WHERE type = ANY($1::text[])`, [
      ["run-check", "export", "parse", "stale", "beat", "doomed", "retry"],
    ]);
  });

  afterAll(async () => {
    await client.query(`DELETE FROM tenant WHERE id = $1`, [tenantId]);
    await client.end();
  });

  it("ставит задачу и захватывает её с арендой", async () => {
    const enqueued = await repository.enqueue({ tenantId, type: "run-check", payload: { checkId: "c-1" } });
    expect(enqueued.created).toBe(true);

    const claimed = await repository.claim("worker-a", 60_000, ["run-check"]);

    expect(claimed?.id).toBe(enqueued.id);
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.payload).toEqual({ checkId: "c-1" });

    await repository.complete(enqueued.id, "worker-a");
  });

  it("не создаёт дубль при повторной постановке той же задачи", async () => {
    const key = `idem-${randomUUID()}`;
    const first = await repository.enqueue({ tenantId, type: "export", payload: { a: 1 }, idempotencyKey: key });
    const second = await repository.enqueue({ tenantId, type: "export", payload: { a: 1 }, idempotencyKey: key });

    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);

    await repository.cancel(first.id);
  });

  it("SKIP LOCKED: два воркера не берут одну задачу", async () => {
    const a = await repository.enqueue({ tenantId, type: "parse", payload: { n: 1 } });
    const b = await repository.enqueue({ tenantId, type: "parse", payload: { n: 2 } });

    const first = await repository.claim("worker-a", 60_000, ["parse"]);
    const second = await repository.claim("worker-b", 60_000, ["parse"]);

    expect(first?.id).not.toBe(second?.id);
    expect([a.id, b.id].sort()).toEqual([first?.id, second?.id].sort());

    await repository.complete(a.id, first?.id === a.id ? "worker-a" : "worker-b");
    await repository.complete(b.id, first?.id === b.id ? "worker-a" : "worker-b");
  });

  it("возвращает задачу в очередь, когда воркер умер и аренда истекла", async () => {
    const job = await repository.enqueue({ tenantId, type: "stale", payload: {} });

    // Воркер захватил и не вернулся: аренда уже истекла.
    await repository.claim("worker-dead", -1_000, ["stale"]);

    const recovered = await repository.claim("worker-alive", 60_000, ["stale"]);

    expect(recovered?.id).toBe(job.id);
    expect(recovered?.attempts).toBe(2);

    await repository.complete(job.id, "worker-alive");
  });

  it("heartbeat продлевает аренду только текущему владельцу", async () => {
    const job = await repository.enqueue({ tenantId, type: "beat", payload: {} });
    await repository.claim("worker-a", 60_000, ["beat"]);

    expect(await repository.heartbeat(job.id, "worker-a", 60_000)).toBe(true);
    expect(await repository.heartbeat(job.id, "worker-b", 60_000)).toBe(false);

    await repository.complete(job.id, "worker-a");
  });

  it("после исчерпания попыток уводит задачу в dead-letter, а не теряет", async () => {
    const job = await repository.enqueue({ tenantId, type: "doomed", payload: {}, maxAttempts: 1 });

    await repository.claim("worker-a", 60_000, ["doomed"]);
    const outcome = await repository.fail(job.id, "worker-a", new Error("разбор не удался"), 0);

    expect(outcome).toBe("dead");

    const row = await client.query<{ status: string; lastError: { message: string } }>(
      `SELECT status, "lastError" FROM job WHERE id = $1`,
      [job.id],
    );

    expect(row.rows[0]?.status).toBe("dead");
    expect(row.rows[0]?.lastError.message).toMatch(/разбор не удался/);
  });

  it("возвращает задачу на повтор, пока бюджет попыток не исчерпан", async () => {
    const job = await repository.enqueue({ tenantId, type: "retry", payload: {}, maxAttempts: 3 });

    await repository.claim("worker-a", 60_000, ["retry"]);
    expect(await repository.fail(job.id, "worker-a", new Error("временно"), 0)).toBe("retry");

    const again = await repository.claim("worker-a", 60_000, ["retry"]);
    expect(again?.id).toBe(job.id);

    await repository.cancel(job.id);
  });
});
