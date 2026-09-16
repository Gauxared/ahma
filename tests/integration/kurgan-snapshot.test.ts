/**
 * Воспроизводимость Проверки на настоящем объекте (ADR-R-024, ADR-R-027).
 *
 * Утверждение «повтор прогона разрешает те же хэши и даёт тот же ответ»
 * проверяется здесь на реальных файлах, а не на выдуманных хэшах: снапшот
 * строится дважды из настоящей сборки и настоящей папки.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { bootstrap } from "@platform/bootstrap.js";
import { buildSnapshot, snapshotDigest } from "@modules/workflow/snapshot.js";
import { classifyDocument } from "@modules/workflow/classify-document.js";
import { fileContentHash } from "@platform/storage/xlsx-reader.js";

import { kurganAvailable, KURGAN_INPUT } from "../fixtures/kurgan.js";

const describeKurgan = kurganAvailable() ? describe : describe.skip;

async function snapshotOf(extra: { degraded?: boolean } = {}) {
  const platform = bootstrap();
  const names = await readdir(KURGAN_INPUT);

  const documents = [];
  for (const name of names.filter((candidate) => classifyDocument(candidate) === "лср")) {
    documents.push({
      path: join(KURGAN_INPUT, name),
      contentHash: await fileContentHash(join(KURGAN_INPUT, name)),
    });
  }

  return buildSnapshot({
    objectPath: KURGAN_INPUT,
    producedAt: new Date().toISOString(),
    documents,
    configs: [...platform.configHashes].map(([path, contentHash]) => ({ path, contentHash })),
    operations: platform.operations
      .ids()
      .map((id) => ({ id, version: platform.operations.definition(id)?.version ?? 0 })),
    formulas: [{ id: "calculation.object-total", version: 1 }],
    prompts: [],
    models: [],
    knowledgeScope: platform.extensions.ids("knowledge-source"),
    degradations: extra.degraded === true ? [{ capability: "x", reason: "y" }] : [],
  });
}

describeKurgan("воспроизводимость Проверки курганского объекта", () => {
  it("два снапшота одного объекта дают один отпечаток", async () => {
    const первый = await snapshotOf();
    const второй = await snapshotOf();

    expect(snapshotDigest(первый)).toBe(snapshotDigest(второй));
  });

  it("отпечаток не зависит от времени прогона", async () => {
    const первый = await snapshotOf();
    const второй = await snapshotOf();

    // Времена заведомо разные — снапшоты строились последовательно.
    expect(первый.producedAt).not.toBe(второй.producedAt);
    expect(snapshotDigest(первый)).toBe(snapshotDigest(второй));
  });

  it("деградация меняет отпечаток: это другой прогон", async () => {
    expect(snapshotDigest(await snapshotOf({ degraded: true }))).not.toBe(
      snapshotDigest(await snapshotOf()),
    );
  });

  it("хэши документов — настоящие хэши содержимого файлов", async () => {
    const snapshot = await snapshotOf();

    expect(snapshot.documents).toHaveLength(4);

    const первый = snapshot.documents[0]!;
    const ожидаемый = createHash("sha256")
      .update(readFileSync(первый.path))
      .digest("hex");

    expect(первый.contentHash).toBe(ожидаемый);
  });

  it("записывает конфигурацию, на которой шёл прогон", async () => {
    const snapshot = await snapshotOf();
    const пути = snapshot.configs.map((config) => config.path);

    expect(пути.some((path) => path.includes("routing.json"))).toBe(true);
    expect(пути.some((path) => path.includes("full-check.json"))).toBe(true);
  });
});
