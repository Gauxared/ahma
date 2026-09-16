/**
 * Устойчивость на объёме — веха Д5 плана демо.
 *
 * ТИПОВОЙ ВХОД КЛИЕНТА ПО УСЛОВИЮ ЗАДАЧИ — СТО ФАЙЛОВ ОДНИМ АРХИВОМ, а замеры
 * сделаны на семи. Разница не в скорости: на семи файлах `Promise.all` давал
 * четырнадцать одновременных обращений к модели и это работало, на ста дал бы
 * двести — столько не держит ни провайдер, ни память воркера с потолком кучи
 * 1 ГБ.
 *
 * ПРОВЕРЯЕТСЯ МЕХАНИЗМ, А НЕ ДАННЫЕ. Набор, гоняющий сто настоящих смет, шёл бы
 * часы и требовал модели — то есть его бы не запускали, а гейт, который не
 * гоняют, не гейт. Поэтому здесь считается ОДНОВРЕМЕННОСТЬ: сколько задач
 * держится в воздухе, и правда ли, что упавшая одна не уносит остальные.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AGENT_CONCURRENCY, checkObject } from "@modules/workflow/check-object";
import type { CheckObjectPorts, DiscoveredDocument } from "@modules/workflow/check-object";
import { описатьНайденное, потолокОбхода } from "@platform/execution/check-ports";
import { readSheetOf, SHEET_BYTES_LIMIT } from "@platform/storage/sheet-reader";

/** Сто смет — тот объём, на котором ломается всё, что работает на семи. */
const СМЕТ = 100;

function документы(сколько: number): readonly DiscoveredDocument[] {
  return Array.from({ length: сколько }, (_, index) => ({
    path: `объект/ЛСР-${String(index + 1).padStart(3, "0")}.xlsx`,
    kind: "лср" as const,
  }));
}

function порты(overrides: Partial<CheckObjectPorts> = {}): CheckObjectPorts {
  return {
    discover: async () => документы(СМЕТ),
    checkDocument: async (document) => ({
      path: document.path,
      positions: 10,
      byCode: 10,
      unmatched: 0,
      converged: true,
      delta: "0.00",
      documentTotal: "1000.00",
    }),
    ...overrides,
  };
}

/** Счётчик одновременности: сколько задач держалось в воздухе одновременно. */
function счётчик(): {
  readonly обёртка: <T>(work: () => Promise<T>) => Promise<T>;
  пик: () => number;
} {
  let сейчас = 0;
  let пик = 0;

  return {
    обёртка: async (work) => {
      сейчас += 1;
      пик = Math.max(пик, сейчас);

      try {
        // Уступка цикла событий обязательна: без неё задача завершается синхронно
        // и одновременности не возникает вовсе — счётчик показал бы единицу на
        // любом коде, то есть гейт был бы зелёным всегда.
        await new Promise((resolve) => setImmediate(resolve));
        return await work();
      } finally {
        сейчас -= 1;
      }
    },
    пик: () => пик,
  };
}

describe("обход папки", () => {
  it("описывает файлы С ПОТОЛКОМ, а не открывает двести разом", async () => {
    /**
     * ЗДЕСЬ СТОЯЛ `Promise.all` ПО ВСЕМУ СПИСКУ, и это было незаметно ровно до
     * той партии, ради которой веха Д5 существует.
     *
     * `describeDocument` читает PDF, docx, txt и XML ЦЕЛИКОМ: отличить чертёж
     * от скана по восьми килобайтам нельзя. Двести чертежей курганского
     * размера — около 860 МБ в одних только буферах, до всякого разбора, при
     * потолке кучи воркера в 1 ГБ.
     *
     * Замерено на настоящей партии в 200 файлов: пик RSS воркера 1087 МБ.
     * Прогон выжил, но запас был отрицательным, а дверь пускает до трёхсот.
     *
     * Потолок агентов (ниже) этого не закрывал: он про обращения к модели, а
     * обход идёт до них.
     */
    const счёт = счётчик();
    const файлы = Array.from({ length: 200 }, (_, index) => ({ path: `объект/файл-${index}.pdf` }));

    const описано = await описатьНайденное(файлы, async (entry) =>
      счёт.обёртка(async () => entry.path),
    );

    expect(описано.length, "описаны не все файлы: часть партии потерялась").toBe(файлы.length);
    expect(счёт.пик(), "обход открывает файлы без потолка").toBeLessThanOrEqual(потолокОбхода());
    // И потолок ДЕЙСТВИТЕЛЬНО достигается: обход по одному файлу за раз на
    // трёхстах файлах стоил бы минут, и гейт этого не заметил бы.
    expect(счёт.пик(), "обход идёт по одному файлу — потолок не работает").toBeGreaterThan(1);
  });

  it("порядок описания сохраняется — иначе отчёты двух прогонов не сравнить", async () => {
    const файлы = Array.from({ length: 50 }, (_, index) => ({ path: `файл-${index}` }));

    const описано = await описатьНайденное(файлы, async (entry) => {
      // Разное время работы: при сборе «в порядке завершения» список
      // перемешался бы, и это самый частый способ сломать порядок.
      await new Promise((resolve) => setTimeout(resolve, (Number(entry.path.split("-")[1]) % 5) * 2));
      return entry.path;
    });

    expect(описано).toEqual(файлы.map((f) => f.path));
  });
});

describe("сто смет одним объектом", () => {
  it("держит потолок одновременности агентов, а не запускает двести обращений", async () => {
    const счёт = счётчик();

    const body = await checkObject(
      "объект",
      порты({
        reviewers: [
          {
            capability: "estimate_review",
            review: async () => счёт.обёртка(async () => ({ verdict: "пригодна", findings: [] })),
          },
          {
            capability: "tech_opinion",
            review: async () => счёт.обёртка(async () => ({ verdict: "замечаний нет", findings: [] })),
          },
        ],
      }),
    );

    // Двести задач поставлено, но в воздухе не больше потолка.
    expect(body.review?.documents.length).toBe(СМЕТ * 2);
    expect(счёт.пик()).toBeLessThanOrEqual(AGENT_CONCURRENCY);
    // И потолок ДЕЙСТВИТЕЛЬНО достигается: если бы агенты шли по одному,
    // сто смет заняли бы часы, а гейт этого не заметил бы.
    expect(счёт.пик()).toBeGreaterThan(1);
  });

  it("потолок задаётся портом: владелец вправе назначить свой", async () => {
    const счёт = счётчик();

    await checkObject(
      "объект",
      порты({
        concurrency: 2,
        reviewers: [
          {
            capability: "estimate_review",
            review: async () => счёт.обёртка(async () => ({ verdict: "пригодна", findings: [] })),
          },
        ],
      }),
    );

    expect(счёт.пик()).toBeLessThanOrEqual(2);
  });

  it("порядок замечаний не зависит от порядка завершения агентов", async () => {
    // Отчёт, меняющий порядок от прогона к прогону, нельзя сравнить с
    // предыдущим. Потолок одновременности сам по себе порядок не гарантирует —
    // гарантирует раскладка результатов по индексу задачи.
    const body = await checkObject(
      "объект",
      порты({
        discover: async () => документы(8),
        reviewers: [
          {
            capability: "estimate_review",
            review: async (document) => {
              // Чем позже документ по счёту, тем быстрее отвечает агент: при
              // раскладке «в порядке завершения» список вышел бы обратным.
              const место = Number.parseInt(document.path.slice(-8, -5), 10);
              await new Promise((resolve) => setTimeout(resolve, Math.max(0, 8 - место)));
              return { verdict: "пригодна", findings: [] };
            },
          },
        ],
      }),
    );

    expect(body.review?.documents.map((outcome) => outcome.path)).toEqual(
      документы(8).map((document) => document.path),
    );
  });

  it("отказ на одной смете доводит остальные и называет причину", async () => {
    // Гейт вехи дословно: «прогон, упавший на одном файле, обязан довести
    // остальные и назвать отказ, а не обнулить обход».
    const битая = "объект/ЛСР-042.xlsx";

    const body = await checkObject(
      "объект",
      порты({
        checkDocument: async (document) => {
          if (document.path === битая) {
            throw new Error("книга повреждена: центральный каталог ZIP не найден");
          }

          return {
            path: document.path,
            positions: 10,
            byCode: 10,
            unmatched: 0,
            converged: true,
            delta: "0.00",
            documentTotal: "1000.00",
          };
        },
      }),
    );

    // Остальные девяносто девять проверены — обход не обнулился.
    expect(body.totals.checked).toBe(СМЕТ - 1);
    expect(body.totals.positions).toBe((СМЕТ - 1) * 10);

    // А отказ назван поимённо и с причиной, и он валит гейт обхода: смета,
    // которую не прочитали, — это неполный обход, а не мелочь.
    const отказ = body.documents.find((document) => document.path === битая);
    expect(отказ?.status).toBe("отказ");
    expect(отказ?.reason).toContain("центральный каталог");

    const гейт = body.gates.find((candidate) => candidate.id === "обход");
    expect(гейт?.passed).toBe(false);
    // В пояснении — имя файла, а не путь: на объекте в сто смет десять путей
    // подряд занимали треть экрана, пряча имена внутри общих префиксов.
    expect(гейт?.detail).toContain("ЛСР-042.xlsx");
    expect(гейт?.detail, "в пояснении гейта остался путь файловой системы").not.toContain("/");
    expect(body.verdict).toBe("не принято");
  });

  it("отказ агента на одной смете не уносит ни остальные сметы, ни остальных агентов", async () => {
    const битая = "объект/ЛСР-007.xlsx";

    const body = await checkObject(
      "объект",
      порты({
        discover: async () => документы(10),
        reviewers: [
          {
            capability: "estimate_review",
            review: async (document) => {
              if (document.path === битая) throw new Error("модель не ответила за отведённое время");
              return { verdict: "пригодна", findings: [] };
            },
          },
          { capability: "tech_opinion", review: async () => ({ verdict: "замечаний нет", findings: [] }) },
        ],
      }),
    );

    const отказы = (body.review?.documents ?? []).filter((outcome) => outcome.error !== undefined);

    expect(отказы).toHaveLength(1);
    expect(отказы[0]?.path).toBe(битая);
    expect(отказы[0]?.error).toContain("не ответила");
    // Девятнадцать оставшихся мнений на месте: десять смет на двух агентов
    // минус один отказ.
    expect(body.review?.documents.length).toBe(20);
    expect(body.review?.failed).toBe(1);
  });
});

describe("книга крупнее потолка", () => {
  let каталог = "";

  beforeAll(async () => {
    каталог = await mkdtemp(join(tmpdir(), "объём-гейт-"));
  });

  afterAll(async () => {
    await rm(каталог, { recursive: true, force: true });
  });

  it("отказывается ДО открытия и называет замер, а не падает на середине", async () => {
    // Замер §7: книга 39 МБ забирает 4,6 ГБ. Воркер идёт с потолком кучи 1 ГБ,
    // то есть такой файл убивал бы его сигналом 137 — прогон исчезал бы, а
    // причина оставалась в журнале контейнера.
    const огромная = join(каталог, "смета-гигант.xlsx");
    await writeFile(огромная, Buffer.alloc(SHEET_BYTES_LIMIT + 1024, 0x50));

    await expect(readSheetOf(огромная)).rejects.toThrow(/превышает потолок разбора/);
    // Причина называет и число, и способ его поднять: отказ без этого читается
    // как «система не умеет».
    await expect(readSheetOf(огромная)).rejects.toThrow(/STROYINTELLECT_SHEET_MAX_MB/);
  });

  it("книга в пределах потолка читается, а не отвергается заодно", async () => {
    // Потолок, отвергающий и нормальные файлы, — это не потолок, а поломка.
    const нормальная = "reference-system/input-1/РИМ Курган_СОТВ_ испр. - ЛСР по Методике 2020 _РМ_.xlsx";
    const лист = await readSheetOf(нормальная);

    expect(лист.rows.size).toBeGreaterThan(100);
  });
});
