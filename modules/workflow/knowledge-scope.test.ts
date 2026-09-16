/**
 * Тесты написаны до реализации по ADR-R-024 и ADR-R-026.
 *
 * `KnowledgeScope` — лёгкий фильтр «что разрешено в этом прогоне», а НЕ снимок
 * состава базы. Проверяется главное: выключение источника меняет результат
 * ВИДИМО — операция либо не стартует и называет недостающее, либо идёт с
 * записанной деградацией. Тишины быть не должно.
 */
import { describe, expect, it } from "vitest";

import { knowledgeScope, parseScope } from "./knowledge-scope.js";

describe("область знания", () => {
  it("по умолчанию разрешает всё: отсутствие ограничения — не ограничение", () => {
    // Прогон без явной области не должен вести себя как прогон с пустой
    // областью: «не ограничивали» и «запретили всё» — разные вещи.
    const scope = knowledgeScope(undefined);

    expect(scope.allows("reference-base")).toBe(true);
    expect(scope.allows("что-угодно")).toBe(true);
    expect(scope.unrestricted).toBe(true);
  });

  it("разрешает только перечисленные источники", () => {
    const scope = knowledgeScope(["reference-base"]);

    expect(scope.allows("reference-base")).toBe(true);
    expect(scope.allows("object-documents")).toBe(false);
    expect(scope.unrestricted).toBe(false);
  });

  it("пустой список — это запрет всего, а не отсутствие ограничения", () => {
    // Разница существенная: пустая область должна дать честный отказ
    // на первой же операции, а не молча пропустить прогон.
    const scope = knowledgeScope([]);

    expect(scope.allows("reference-base")).toBe(false);
    expect(scope.unrestricted).toBe(false);
  });

  it("перечисляет исключённое, а не только разрешённое", () => {
    // Список «что выключено» — это и есть объявленная деградация: без него
    // отсутствие результата выглядит свойством данных.
    const scope = knowledgeScope(["reference-base"]);

    expect(scope.excludedFrom(["reference-base", "object-documents", "иное"])).toEqual([
      "object-documents",
      "иное",
    ]);
  });

  it("не считает исключённым то, чего в сборке и не было", () => {
    const scope = knowledgeScope(["reference-base", "которого-нет"]);

    expect(scope.excludedFrom(["reference-base"])).toEqual([]);
  });
});

describe("разбор области из строки", () => {
  it("читает список через запятую", () => {
    expect(parseScope("reference-base,object-documents")).toEqual([
      "reference-base",
      "object-documents",
    ]);
  });

  it("терпит пробелы вокруг имён", () => {
    expect(parseScope(" reference-base , object-documents ")).toEqual([
      "reference-base",
      "object-documents",
    ]);
  });

  it("отличает неуказанный флаг от пустого значения", () => {
    // `--scope` не задан — ограничения нет. `--scope ""` — запрещено всё.
    // Свести их к одному значило бы дать флагу молча ничего не делать.
    expect(parseScope(undefined)).toBeUndefined();
    expect(parseScope("")).toEqual([]);
  });

  it("не пропускает пустые имена внутри списка", () => {
    expect(parseScope("reference-base,,object-documents")).toEqual([
      "reference-base",
      "object-documents",
    ]);
  });
});
