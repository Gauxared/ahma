/**
 * Журнал обращений к моделям — ТЗ §12.1л, ADR-R-020.
 *
 * ЧТО ЭТО ЗАКРЫВАЕТ
 *
 * ТЗ: «обращение к внешним моделям происходит только по процессам Регламента и
 * только после анонимизации, ЧТО ПОДТВЕРЖДАЕТСЯ ЗАПИСЯМИ ЖУРНАЛА». Таблица
 * `model_call` существовала с M0 и не заполнялась — подтверждать было нечем.
 *
 * Записи egress-шлюза в `audit_event` отвечают на вопрос «куда ходили»: имя
 * хоста и причина. Регламент спрашивает другое — какой процесс, какие классы
 * данных, было ли обезличивание, сколько токенов.
 *
 * ПОЧЕМУ СВОДКА ИЗ ТАБЛИЦЫ, А НЕ ИЗ ПАМЯТИ
 *
 * Прежний `InMemoryCallJournal` знал только текущий процесс. Сводка для
 * Регламента строится по всей истории: перезапущенный воркер отчитывался бы за
 * неполный период и выглядел бы при этом исправным.
 */
import { randomUUID } from "node:crypto";

import { beforeAll, afterAll, describe, expect, it } from "vitest";

import { ModelCallRepository } from "./model-call-repository.js";
import { createPrismaClient, withTenant } from "./prisma.js";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined || DATABASE_URL === "" ? describe.skip : describe;

const db = createPrismaClient(DATABASE_URL);

let tenantId: string;

function обращение(overrides: Record<string, unknown> = {}) {
  return {
    at: new Date().toISOString(),
    process: "run-estimate-review",
    operationId: "run-estimate-review",
    contour: "external" as const,
    provider: "openai-compatible",
    model: "м-1",
    dataClasses: ["positions" as const],
    anonymized: true,
    inputTokens: 1000,
    outputTokens: 200,
    ...overrides,
  };
}

beforeAll(async () => {
  if (DATABASE_URL === undefined || DATABASE_URL === "") return;

  tenantId = randomUUID();
  await db.tenant.create({
    data: { id: tenantId, slug: `m-${tenantId.slice(0, 8)}`, displayName: "арендатор журнала" },
  });
});

afterAll(async () => {
  if (DATABASE_URL === undefined || DATABASE_URL === "") return;

  await db.tenant.delete({ where: { id: tenantId } });
  await db.$disconnect();
});

describeDb("запись обращения", () => {
  const repository = new ModelCallRepository();

  it("сохраняет то, о чём спрашивает Регламент", async () => {
    // Процесс, классы данных, обезличивание и токены. Имени хоста здесь нет —
    // на него отвечают записи шлюза, это другой вопрос.
    const saved = await withTenant(db, tenantId, (tx) =>
      repository.record(tx, tenantId, обращение()),
    );

    const row = await withTenant(db, tenantId, (tx) =>
      tx.modelCall.findUnique({ where: { id: saved.id } }),
    );

    expect(row?.process).toBe("run-estimate-review");
    expect(row?.dataClasses).toEqual(["positions"]);
    expect(row?.anonymized).toBe(true);
    expect(row?.inputTokens).toBe(1000);
  });

  it("ОТКАЗЫВАЕТ записать тайну, ушедшую наружу без обезличивания", async () => {
    // Шлюз такого не пропускает. Если запись всё же дошла до журнала, то либо у
    // шлюза дефект, либо обращение прошло мимо него. Молча записать значило бы
    // задокументировать нарушение и не заметить его.
    await expect(
      withTenant(db, tenantId, (tx) =>
        repository.record(
          tx,
          tenantId,
          обращение({ dataClasses: ["commercial_secret"], anonymized: false }),
        ),
      ),
    ).rejects.toThrow(/§12.1л/u);
  });

  it("объясняет, где искать причину отказа", async () => {
    // «Отклонено» без указания на шлюз оставляет разбираться с нуля.
    await expect(
      withTenant(db, tenantId, (tx) =>
        repository.record(
          tx,
          tenantId,
          обращение({ dataClasses: ["customer_identity"], anonymized: false }),
        ),
      ),
    ).rejects.toThrow(/шлюз/iu);
  });

  it("НЕ ограничивает внутренний контур", async () => {
    // Данные, не покидающие контур, обезличивать не нужно: §12.1л о выходе.
    const saved = await withTenant(db, tenantId, (tx) =>
      repository.record(
        tx,
        tenantId,
        обращение({ contour: "internal", dataClasses: ["commercial_secret"], anonymized: false }),
      ),
    );

    expect(saved.id).toBeTruthy();
  });
});

describeDb("сводка для Регламента передачи данных", () => {
  const repository = new ModelCallRepository();

  it("сводит обращения по процессам и не считает внутренние", async () => {
    // Внутренние вызовы раздули бы отчёт обращениями к локальной модели,
    // которые наружу ничего не передают.
    const свой = randomUUID();
    await db.tenant.create({
      data: { id: свой, slug: `s-${свой.slice(0, 8)}`, displayName: "сводка" },
    });

    await withTenant(db, свой, async (tx) => {
      await repository.record(tx, свой, обращение({ process: "обзор", dataClasses: ["positions"] }));
      await repository.record(
        tx,
        свой,
        обращение({ process: "обзор", dataClasses: ["prices"], inputTokens: 500 }),
      );
      await repository.record(
        tx,
        свой,
        обращение({ process: "техзаключение", contour: "internal", anonymized: false }),
      );
    });

    const summary = await withTenant(db, свой, (tx) => repository.externalProcesses(tx));

    expect(summary).toHaveLength(1);
    expect(summary[0]!.process).toBe("обзор");
    expect(summary[0]!.calls).toBe(2);
    expect(summary[0]!.dataClasses).toEqual(["positions", "prices"]);
    expect(summary[0]!.inputTokens).toBe(1500);
    // Обязано быть нулём: иначе §12.1л нарушен, и это видно в сводке.
    expect(summary[0]!.withoutAnonymization).toBe(0);

    await db.tenant.delete({ where: { id: свой } });
  });
});
