/**
 * Приём курганского объекта против настоящей таблицы маршрута.
 *
 * Сверка не с самим собой: известно, как объект прогонялся НА САМОМ ДЕЛЕ —
 * `reference-system/output-1/` содержит десять документов от девяти агентов,
 * то есть конфигурацию C «Оркестр 9». Маршрутизатор обязан прийти к тому же.
 */
import { readdir } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { bootstrap } from "@platform/bootstrap.js";
import { buildPassport } from "@modules/intake/passport.js";
import { route } from "@modules/intake/routing.js";
import { classifyDocument } from "@modules/workflow/classify-document.js";

import { kurganAvailable, KURGAN_INPUT } from "../fixtures/kurgan.js";

const describeKurgan = kurganAvailable() ? describe : describe.skip;

async function passport(declared: Parameters<typeof buildPassport>[0]["declared"]) {
  const names = await readdir(KURGAN_INPUT);
  return buildPassport({
    documents: names.map((name) => ({ name, kind: classifyDocument(name) })),
    declared,
  });
}

describeKurgan("приём курганского объекта", () => {
  it("считает состав пакета по настоящей папке", async () => {
    const p = await passport({});

    expect(p.composition.volumes).toBe(2);
    expect(p.composition.estimates).toBe(4);
    expect(p.composition.hasSummary).toBe(true);
    expect(p.stage).toBe("рд-и-сметы");
  });

  it("без объявленных полей маршрут не выдаётся", async () => {
    const platform = bootstrap();
    const result = route(await passport({}), platform.routing!);

    expect(result.kind).toBe("gate");
  });

  it("при полном сопровождении ведёт в Оркестр 9 — как было в реальности", async () => {
    // В output-1 десять документов от девяти агентов: объект вели Классиком C,
    // хотя домен у него профильный. Критерий 1 легаси («тип задачи») стоит
    // выше домена именно поэтому.
    const platform = bootstrap();
    const result = route(
      await passport({ domain: "сети", side: "подрядчик", goal: "полное сопровождение" }),
      platform.routing!,
    );

    expect(result.kind).toBe("route");
    if (result.kind !== "route") return;

    expect(result.configuration).toBe("C");
    expect(result.agent).toBe("артемий");
    expect(result.criterion).toContain("1) Тип задачи");
  });

  it("тот же пакет со стороны заказчика читается другой линзой", async () => {
    const platform = bootstrap();
    const result = route(
      await passport({ domain: "сети", side: "заказчик", goal: "вердикт брать/не брать" }),
      platform.routing!,
    );

    if (result.kind !== "route") throw new Error("ожидался маршрут");
    expect(result.agent).toBe("матвеич");
  });
});
