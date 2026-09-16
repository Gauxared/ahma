/**
 * Тесты написаны до реализации. Сохранение разбора — ТЗ §5.5, ADR-R-019,
 * ADR-R-015.
 *
 * ЧТО ЭТО ЗАКРЫВАЕТ
 *
 * Три запроса фронтового трека, каждый из которых блокировал экран §5.5
 * «загрузка и разбор»:
 *
 *  · `Document` и `DocumentVersion` существовали в схеме и НЕ ЗАПОЛНЯЛИСЬ:
 *    `storagePath` не писал никто;
 *  · извлечённые позиции жили только внутри артефакта Проверки, и то
 *    счётчиками («позиций 101, по шифру 98») — таблицу строк построить не из
 *    чего;
 *  · `ExtractionLedger` вёл ревизии В ПАМЯТИ и терял их на выходе процесса.
 *
 * ПОЧЕМУ ПОЗИЦИИ ПРИНАДЛЕЖАТ ВЕРСИИ, А НЕ ДОКУМЕНТУ
 *
 * Правка исходного файла — это новая версия и новый разбор, а не мутация строк.
 * Сравнить два разбора можно только если сохранены оба; привязка к документу
 * означала бы, что второй разбор затирает первый и спорить не с чем.
 *
 * ПОЧЕМУ ПОВТОРНЫЙ РАЗБОР ТОГО ЖЕ ФАЙЛА НЕ ПЛОДИТ ВЕРСИИ
 *
 * Версия адресуется хэшем содержимого. Тот же файл — та же версия, и позиции
 * переписываются, а не удваиваются. Иначе каждая перепроверка объекта удваивала
 * бы таблицу позиций, и «позиций 202» стало бы правдой базы и ложью о смете.
 */
import { randomUUID } from "node:crypto";

import { beforeAll, afterAll, describe, expect, it } from "vitest";

import { ExtractionRepository, positionSubject } from "./extraction-repository.js";
import { createPrismaClient, withTenant } from "./prisma.js";

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL === undefined || DATABASE_URL === "" ? describe.skip : describe;

const db = createPrismaClient(DATABASE_URL);

const ХЭШ_A = "a".repeat(64);
const ХЭШ_B = "b".repeat(64);

let tenantId: string;
let objectId: string;

function позиции(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    ordinal: String(index + 1),
    section: "1",
    sourceName: `позиция ${index + 1}`,
    basis: "ГЭСНм20-03-035-01",
    unit: "м",
    quantity: "120",
    amount: "1000.00",
    sourceRow: 40 + index,
  }));
}

const ДОКУМЕНТ = {
  objectPath: "/data/objects/КРГ-1/смета.xlsx",
  fileName: "смета.xlsx",
  kind: "лср",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  byteSize: 12345,
};

// Подготовка на уровне ФАЙЛА, а не блока: `afterAll` внутри первого describe
// удалял арендатора и рвал соединение до того, как отработает второй, и второй
// падал на пустом месте.
beforeAll(async () => {
  if (DATABASE_URL === undefined || DATABASE_URL === "") return;

  tenantId = randomUUID();
  objectId = randomUUID();

  await db.tenant.create({
    data: { id: tenantId, slug: `t-${tenantId.slice(0, 8)}`, displayName: "арендатор теста" },
  });

  await withTenant(db, tenantId, (tx) =>
    tx.projectObject.create({
      data: { id: objectId, tenantId, code: `КРГ-${objectId.slice(0, 4)}`, name: "объект теста" },
    }),
  );
});

afterAll(async () => {
  if (DATABASE_URL === undefined || DATABASE_URL === "") return;

  await db.tenant.delete({ where: { id: tenantId } });
  await db.$disconnect();
});

describeDb("сохранение разбора", () => {
  it("заводит документ, версию и позиции", async () => {
    const saved = await withTenant(db, tenantId, (tx) =>
      new ExtractionRepository().saveExtraction(tx, {
        tenantId,
        objectId,
        document: ДОКУМЕНТ,
        contentHash: ХЭШ_A,
        positions: позиции(3),
      }),
    );

    expect(saved.positions).toBe(3);
    expect(saved.revision).toBe(1);

    const rows = await withTenant(db, tenantId, (tx) =>
      tx.position.findMany({ where: { documentVersionId: saved.documentVersionId } }),
    );

    expect(rows).toHaveLength(3);
  });

  it("пишет путь файла: без него загруженный документ негде взять", async () => {
    const saved = await withTenant(db, tenantId, (tx) =>
      new ExtractionRepository().saveExtraction(tx, {
        tenantId,
        objectId,
        document: ДОКУМЕНТ,
        contentHash: ХЭШ_A,
        positions: позиции(1),
      }),
    );

    const version = await withTenant(db, tenantId, (tx) =>
      tx.documentVersion.findUnique({ where: { id: saved.documentVersionId } }),
    );

    expect(version?.storagePath).toBe(ДОКУМЕНТ.objectPath);
  });

  it("ПОВТОРНЫЙ разбор того же файла не плодит версию и не удваивает позиции", async () => {
    // Иначе каждая перепроверка объекта удваивала бы таблицу: «позиций 202»
    // стало бы правдой базы и ложью о смете.
    const first = await withTenant(db, tenantId, (tx) =>
      new ExtractionRepository().saveExtraction(tx, {
        tenantId,
        objectId,
        document: ДОКУМЕНТ,
        contentHash: ХЭШ_A,
        positions: позиции(3),
      }),
    );

    const second = await withTenant(db, tenantId, (tx) =>
      new ExtractionRepository().saveExtraction(tx, {
        tenantId,
        objectId,
        document: ДОКУМЕНТ,
        contentHash: ХЭШ_A,
        positions: позиции(3),
      }),
    );

    expect(second.documentVersionId).toBe(first.documentVersionId);
    expect(second.revision).toBe(1);

    const rows = await withTenant(db, tenantId, (tx) =>
      tx.position.count({ where: { documentVersionId: first.documentVersionId } }),
    );

    expect(rows).toBe(3);
  });

  it("ДРУГОЕ содержимое даёт НОВУЮ версию, а прежняя остаётся", async () => {
    // Правка файла — новая версия, а не мутация. Сравнить два разбора можно
    // только если сохранены оба.
    const first = await withTenant(db, tenantId, (tx) =>
      new ExtractionRepository().saveExtraction(tx, {
        tenantId,
        objectId,
        document: ДОКУМЕНТ,
        contentHash: ХЭШ_A,
        positions: позиции(3),
      }),
    );

    const second = await withTenant(db, tenantId, (tx) =>
      new ExtractionRepository().saveExtraction(tx, {
        tenantId,
        objectId,
        document: ДОКУМЕНТ,
        contentHash: ХЭШ_B,
        positions: позиции(5),
      }),
    );

    expect(second.documentVersionId).not.toBe(first.documentVersionId);
    expect(second.revision).toBe(2);

    // Прежняя версия и её позиции НА МЕСТЕ.
    const было = await withTenant(db, tenantId, (tx) =>
      tx.position.count({ where: { documentVersionId: first.documentVersionId } }),
    );

    expect(было).toBe(3);
  });
});

describeDb("ревизии извлечения переживают перезапуск", () => {
  it("сохраняет ревизию с хэшем, к которому привязано подтверждение", async () => {
    const repository = new ExtractionRepository();

    const saved = await withTenant(db, tenantId, (tx) =>
      repository.saveRevision(tx, {
        tenantId,
        subject: "позиция-14/количество",
        value: "1110",
        unit: "м3",
        sourceDocument: ДОКУМЕНТ.objectPath,
        sourceLocator: "ЛСР!C41",
        origin: "разбор",
        critical: true,
        contentHash: ХЭШ_A,
      }),
    );

    const row = await withTenant(db, tenantId, (tx) =>
      tx.extractionRevision.findUnique({ where: { id: saved.id } }),
    );

    expect(row?.contentHash).toBe(ХЭШ_A);
    expect(row?.critical).toBe(true);
    // Не подтверждено — значит поле пустое, а не «подтверждено пустым».
    expect(row?.confirmedBy).toBeNull();
  });

  it("правка НЕ затирает разбор, а ссылается на него", async () => {
    // История извлечения — это то, чем защищают число перед подрядчиком.
    const repository = new ExtractionRepository();
    const subject = `позиция-${randomUUID().slice(0, 8)}/количество`;

    const разбор = await withTenant(db, tenantId, (tx) =>
      repository.saveRevision(tx, {
        tenantId,
        subject,
        value: "1110",
        sourceDocument: ДОКУМЕНТ.objectPath,
        sourceLocator: "ЛСР!C41",
        origin: "разбор",
        critical: true,
        contentHash: ХЭШ_A,
      }),
    );

    await withTenant(db, tenantId, (tx) =>
      repository.saveRevision(tx, {
        tenantId,
        subject,
        value: "1150",
        sourceDocument: ДОКУМЕНТ.objectPath,
        sourceLocator: "ЛСР!C41",
        origin: "правка",
        critical: true,
        contentHash: ХЭШ_B,
        previousId: разбор.id,
        author: "сметчик АПРИ",
        reason: "уточнено по РД",
      }),
    );

    const history = await withTenant(db, tenantId, (tx) =>
      repository.historyOf(tx, subject),
    );

    expect(history).toHaveLength(2);
    expect(history[0]!.origin).toBe("разбор");
    expect(history[1]!.previousId).toBe(разбор.id);
  });
});

describeDb("правка извлечённого значения", () => {
  const repository = new ExtractionRepository();

  function предмет(): string {
    return `позиция-${randomUUID().slice(0, 8)}/количество`;
  }

  it("заводит ревизию «разбор» ЛЕНИВО — в момент первой правки", async () => {
    // Заводить её на каждую позицию значило бы требовать подтверждения тысяч
    // строк: человек начал бы подтверждать не глядя, и подпись обесценилась бы.
    const subject = предмет();

    await withTenant(db, tenantId, (tx) =>
      repository.recordEdit(tx, {
        tenantId,
        subject,
        sourceDocument: ДОКУМЕНТ.objectPath,
        sourceLocator: "ЛСР!C41",
        unit: "м3",
        critical: true,
        parsedValue: "1110",
        newValue: "1150",
        author: "сметчик АПРИ",
        reason: "уточнено по РД",
      }),
    );

    const history = await withTenant(db, tenantId, (tx) => repository.historyOf(tx, subject));

    expect(history).toHaveLength(2);
    expect(history[0]!.origin).toBe("разбор");
    expect(history[1]!.origin).toBe("правка");
    expect(history[1]!.previousId).toBe(history[0]!.id);
  });

  it("ВТОРАЯ правка ссылается на первую, а не на разбор", async () => {
    // Иначе история разойдётся в две ветки, и «текущее значение» станет
    // вопросом порядка записи, а не решения человека.
    const subject = предмет();
    const правка = {
      tenantId,
      subject,
      sourceDocument: ДОКУМЕНТ.objectPath,
      sourceLocator: "ЛСР!C41",
      critical: true,
      parsedValue: "1110",
      author: "сметчик АПРИ",
      reason: "уточнено",
    };

    const first = await withTenant(db, tenantId, (tx) =>
      repository.recordEdit(tx, { ...правка, newValue: "1150" }),
    );
    const second = await withTenant(db, tenantId, (tx) =>
      repository.recordEdit(tx, { ...правка, newValue: "1160" }),
    );

    expect(second.previousId).toBe(first.id);

    const history = await withTenant(db, tenantId, (tx) => repository.historyOf(tx, subject));
    expect(history).toHaveLength(3);
  });

  it("ОТКАЗЫВАЕТ править без причины", async () => {
    // Значение без объяснения нечем защитить: спор упрётся в «так поправили»,
    // и правка станет слабее исходного разбора.
    await expect(
      withTenant(db, tenantId, (tx) =>
        repository.recordEdit(tx, {
          tenantId,
          subject: предмет(),
          sourceDocument: ДОКУМЕНТ.objectPath,
          sourceLocator: "ЛСР!C41",
          critical: true,
          parsedValue: "1110",
          newValue: "1150",
          author: "сметчик АПРИ",
          reason: "   ",
        }),
      ),
    ).rejects.toThrow(/причин/iu);
  });

  it("хэш правки ОТЛИЧАЕТСЯ от хэша разбора", async () => {
    // Подтверждение привязано к хэшу. Совпади они — подпись под разобранным
    // значением прикрыла бы правку, которой человек не видел.
    const subject = предмет();

    await withTenant(db, tenantId, (tx) =>
      repository.recordEdit(tx, {
        tenantId,
        subject,
        sourceDocument: ДОКУМЕНТ.objectPath,
        sourceLocator: "ЛСР!C41",
        critical: true,
        parsedValue: "1110",
        newValue: "1150",
        author: "сметчик АПРИ",
        reason: "уточнено",
      }),
    );

    const rows = await withTenant(db, tenantId, (tx) =>
      tx.extractionRevision.findMany({ where: { subject }, orderBy: { createdAt: "asc" } }),
    );

    expect(rows[0]!.contentHash).not.toBe(rows[1]!.contentHash);
  });
});

describeDb("подтверждение ревизии человеком", () => {
  const repository = new ExtractionRepository();

  /**
   * Правка и её хэш — то, что увидел бы человек на экране.
   *
   * Возвращается именно правка, а не разбор: подтверждают вмешательство, а не
   * работу парсера (ADR-R-019).
   */
  async function правкаСХэшем(): Promise<{ id: string; contentHash: string; subject: string }> {
    const subject = `версия-${randomUUID()}/позиция-14/количество`;

    const { id } = await withTenant(db, tenantId, (tx) =>
      repository.recordEdit(tx, {
        tenantId,
        subject,
        sourceDocument: ДОКУМЕНТ.objectPath,
        sourceLocator: "ЛСР!C41",
        critical: true,
        parsedValue: "1110",
        newValue: "1150",
        author: "сметчик",
        reason: "уточнено по РД",
      }),
    );

    const row = await withTenant(db, tenantId, (tx) =>
      tx.extractionRevision.findUniqueOrThrow({ where: { id }, select: { contentHash: true } }),
    );

    return { id, contentHash: row.contentHash, subject };
  }

  it("ставит подпись и время — и они переживают перезапуск, потому что лежат в базе", async () => {
    const правка = await правкаСХэшем();

    const outcome = await withTenant(db, tenantId, (tx) =>
      repository.confirm(tx, {
        tenantId,
        revisionId: правка.id,
        contentHash: правка.contentHash,
        actor: "виктор@апри",
        now: new Date("2026-09-03T10:00:00.000Z"),
      }),
    );

    expect(outcome.confirmed).toBe(true);

    const row = await withTenant(db, tenantId, (tx) =>
      tx.extractionRevision.findUniqueOrThrow({ where: { id: правка.id } }),
    );

    expect(row.confirmedBy).toBe("виктор@апри");
    expect(row.confirmedAt).not.toBeNull();
  });

  it("ОТКАЗЫВАЕТ по устаревшему хэшу и называет повод", async () => {
    // Главное требование §12: подпись под значением, которого подтверждающий не
    // видел, хуже отсутствия подписи — отсутствие заметно, а ложное
    // подтверждение выглядит проверенным.
    const правка = await правкаСХэшем();

    const outcome = await withTenant(db, tenantId, (tx) =>
      repository.confirm(tx, {
        tenantId,
        revisionId: правка.id,
        contentHash: "0".repeat(64),
        actor: "виктор@апри",
        now: new Date(),
      }),
    );

    expect(outcome.confirmed).toBe(false);
    expect(outcome.confirmed === false ? outcome.reason : "").toContain("хэш предмета устарел");

    const row = await withTenant(db, tenantId, (tx) =>
      tx.extractionRevision.findUniqueOrThrow({ where: { id: правка.id } }),
    );

    expect(row.confirmedBy, "подпись поставлена по устаревшему хэшу").toBeNull();
  });

  it("ПОВТОРНОЕ подтверждение не переписывает первую подпись", async () => {
    const правка = await правкаСХэшем();

    await withTenant(db, tenantId, (tx) =>
      repository.confirm(tx, {
        tenantId,
        revisionId: правка.id,
        contentHash: правка.contentHash,
        actor: "первый",
        now: new Date("2026-09-03T10:00:00.000Z"),
      }),
    );

    const outcome = await withTenant(db, tenantId, (tx) =>
      repository.confirm(tx, {
        tenantId,
        revisionId: правка.id,
        contentHash: правка.contentHash,
        actor: "второй",
        now: new Date("2026-09-03T11:00:00.000Z"),
      }),
    );

    expect(outcome.confirmed).toBe(false);
    expect(outcome.confirmed === false ? outcome.reason : "").toContain("первый");

    const row = await withTenant(db, tenantId, (tx) =>
      tx.extractionRevision.findUniqueOrThrow({ where: { id: правка.id } }),
    );

    expect(row.confirmedBy, "вторая подпись затёрла первую").toBe("первый");
  });

  it("предмет позиции адресуется ВЕРСИЕЙ, иначе позиция 14 у двух смет — один предмет", () => {
    const первая = positionSubject("11111111-1111-1111-1111-111111111111", "14", "количество");
    const вторая = positionSubject("22222222-2222-2222-2222-222222222222", "14", "количество");

    expect(первая).not.toBe(вторая);
    expect(первая).toContain("позиция-14/количество");
  });
});
