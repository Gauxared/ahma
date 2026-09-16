/**
 * В РЕЕСТР ПОПАДАЕТ ВЕСЬ КОМПЛЕКТ, А НЕ ТОЛЬКО РАЗОБРАННЫЕ СМЕТЫ.
 *
 * ЧТО ЗДЕСЬ ЗАЩИЩАЕТСЯ
 *
 * Замерено на эталонном входе `reference-system/input-1`: загружено семь
 * файлов, а на экране «Документы» их четыре. Дескриптор — единственное, из чего
 * заводится строка реестра, — создавался ровно там, где разбирается ЛСР.
 * Сводный сметный расчёт, два тома рабочей документации в PDF и всё
 * неразобранное до реестра не доходили вовсе.
 *
 * Это тот же класс, что «принято и молча потеряно», только на шаг позже: дверь
 * файл приняла, обход его прочитал, а экран, на который клиент смотрит первым
 * делом — «вы вообще получили мои файлы?» — про него молчит. На встрече это
 * читается как потерянные документы.
 *
 * ПОЧЕМУ ОБХОД, А НЕ ПОЛНЫЙ ПРОГОН
 *
 * Предмет проверки — состав реестра, и он определяется обходом. Полный прогон
 * добавил бы к нему девять агентов, шесть минут и две сотни обращений к модели,
 * не сказав об этом составе ничего нового.
 */
import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { bootstrap } from "@platform/bootstrap.js";
import { buildCheckPorts } from "@platform/execution/check-ports.js";

/** Эталонный вход заказчика: семь файлов пяти видов. */
const ВХОД = "reference-system/input-1";

const описанный = existsSync(ВХОД) ? describe : describe.skip;

описанный("реестр покрывает весь комплект", () => {
  it("семь файлов на входе — семь строк реестра", async () => {
    const platform = bootstrap();
    const { ports, collected } = buildCheckPorts({
      platform,
      tenantId: "11111111-1111-1111-1111-111111111111",
      now: new Date().toISOString(),
    });

    // `discover` и обходит, и описывает: отдельного порта описания нет.
    const найдено = await ports.discover(ВХОД);

    const пути = collected.descriptors.map((d) => d.fileName).sort((a, b) => a.localeCompare(b, "ru"));

    expect(
      collected.descriptors.length,
      `обход нашёл ${найдено.length} файлов, а в реестр завёл ${collected.descriptors.length}: ${пути.join(", ")}`,
    ).toBe(найдено.length);
  });

  it("подшивки PDF и сводный расчёт названы своим видом, а не пропущены", async () => {
    const platform = bootstrap();
    const { ports, collected } = buildCheckPorts({
      platform,
      tenantId: "11111111-1111-1111-1111-111111111111",
      now: new Date().toISOString(),
    });

    await ports.discover(ВХОД);

    const виды = new Map(collected.descriptors.map((d) => [d.fileName, d.kind]));

    // Именно эти три и терялись: реестр показывал только четыре ЛСР.
    const pdf = [...виды].filter(([имя]) => имя.toLowerCase().endsWith(".pdf"));
    expect(pdf.length, "подшивки PDF не дошли до реестра").toBe(2);
    for (const [имя, вид] of pdf) {
      expect(вид, `${имя} попал в реестр без вида`).toBe("рабочая-документация");
    }

    const сводный = [...виды].find(([имя]) => /сводный/i.test(имя));
    expect(сводный, "сводный сметный расчёт не дошёл до реестра").toBeDefined();
  });

  it("у каждой строки реестра есть отпечаток файла", async () => {
    // Без отпечатка строка реестра не отвечает на вопрос «та ли это версия»,
    // а именно им переход «откуда взято» находит проверенную ревизию.
    const platform = bootstrap();
    const { ports, collected } = buildCheckPorts({
      platform,
      tenantId: "11111111-1111-1111-1111-111111111111",
      now: new Date().toISOString(),
    });

    await ports.discover(ВХОД);

    const безОтпечатка = collected.descriptors.filter((d) => !/^[0-9a-f]{64}$/.test(d.contentHash));

    expect(безОтпечатка.map((d) => d.fileName), "строки реестра без отпечатка").toEqual([]);
  });
});
