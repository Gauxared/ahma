/**
 * Реестр агентов — против того, как восемь агентов стали Людмилой.
 *
 * Проверяется не «загрузчик читает json», а три способа потерять агента молча,
 * каждый из которых при исполнении выглядит успехом: способность, не совпавшая
 * с `provides`; повтор; чек-лист приёмки, которого нет.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadAgentRoster } from "./agent-roster.js";

function каталог(
  manifests: Record<string, Record<string, unknown>>,
): string {
  const root = mkdtempSync(join(tmpdir(), "ростер-"));

  for (const [name, manifest] of Object.entries(manifests)) {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, "manifest.json"), JSON.stringify(manifest), "utf8");
  }

  return root;
}

function манифест(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "finance-model",
    provides: ["finance_model"],
    displayName: "Эконом",
    checklistId: "ваныч",
    roster: { person: "Ваныч", capability: "finance_model", scope: "объект", order: 4 },
    ...over,
  };
}

describe("реестр агентов", () => {
  it("даёт имя, роль и предмет по способности из артефакта", () => {
    const { roster } = loadAgentRoster(каталог({ "finance-model": манифест() }));
    const ваныч = roster.require("finance_model");

    expect(ваныч.person).toBe("Ваныч");
    expect(ваныч.role).toBe("Эконом");
    expect(ваныч.scope).toBe("объект");
  });

  it("выдаёт агентов В ПОРЯДКЕ КОНВЕЙЕРА, а не обхода каталога", () => {
    // Порядок обхода — свойство файловой системы, и книга, собранная по нему,
    // поставила бы вердикт руководителя перед разбором сметы.
    const { roster } = loadAgentRoster(
      каталог({
        verdict: манифест({
          id: "verdict",
          provides: ["object_verdict"],
          displayName: "Руководитель",
          checklistId: "артемий",
          roster: { person: "Артемий", capability: "object_verdict", scope: "синтез", order: 9 },
        }),
        "estimate-review": манифест({
          id: "estimate-review",
          provides: ["estimate_review"],
          displayName: "Сметчик",
          checklistId: "людмила",
          roster: { person: "Людмила", capability: "estimate_review", scope: "документ", order: 2 },
        }),
      }),
    );

    expect(roster.all().map((entry) => entry.person)).toEqual(["Людмила", "Артемий"]);
  });

  it("ОТКАЗЫВАЕТ, если способность не совпала с provides", () => {
    // Так едва не потерялся Артемий: манифест зовётся verdict, способность —
    // object_verdict. Агент не нашёлся бы по артефакту и выпал бы из книги.
    const каталогСОшибкой = каталог({
      verdict: манифест({
        id: "verdict",
        provides: ["object_verdict"],
        roster: { person: "Артемий", capability: "verdict", scope: "синтез", order: 9 },
      }),
    });

    expect(() => loadAgentRoster(каталогСОшибкой)).toThrow(/provides/u);
  });

  it("ОТКАЗЫВАЕТ на повторе порядка: два агента встали бы на одну строку", () => {
    const двое = каталог({
      "finance-model": манифест(),
      procurement: манифест({
        id: "procurement",
        provides: ["procurement_map"],
        displayName: "Снабжение",
        checklistId: "марина",
        roster: { person: "Марина", capability: "procurement_map", scope: "объект", order: 4 },
      }),
    });

    expect(() => loadAgentRoster(двое)).toThrow(/Порядок 4 занят дважды/u);
  });

  it("ОТКАЗЫВАЕТ, если чек-листа приёмки нет", () => {
    // «0 из 0» на листе компетенций читается как результат приёмки, а не как
    // её отсутствие.
    expect(() =>
      loadAgentRoster(каталог({ "finance-model": манифест() }), ["людмила", "денчик"]),
    ).toThrow(/чек-лист/u);
  });

  it("на незнакомой способности отказывает, а не подставляет «Неизвестный»", () => {
    const { roster } = loadAgentRoster(каталог({ "finance-model": манифест() }));

    expect(roster.find("нет_такой")).toBeUndefined();
    expect(() => roster.require("нет_такой")).toThrow(/не найдена в реестре/u);
  });
});

describe("настоящая конфигурация проекта", () => {
  it("все агенты читаются и сходятся с чек-листами приёмки", () => {
    // Проверка на РЕАЛЬНОМ config/: рассинхрон между манифестом и файлом
    // приёмки уже был (estimate-review-v1 против людмила.json) и не проявлялся
    // никак, потому что checklistId не читал никто.
    //
    // Список приёмок перечислен ЯВНО и не выводится из манифестов: смысл
    // проверки в том, что две стороны сошлись, а выведенный из одной стороны
    // список сошёлся бы с ней всегда.
    const { roster } = loadAgentRoster("config/agents", [
      "артемий", "ваныч", "виктор", "денчик", "людмила",
      "марина", "настенька", "палыч", "тимофей", "халиль",
    ]);

    // Десятый — Тимофей, планировщик: график производства работ, десятый
    // документ пакета. До 06.09.2026 он значился объявленным отсутствием.
    expect(roster.all()).toHaveLength(10);
    expect(roster.all().map((entry) => entry.person)).toEqual([
      "Настенька", "Людмила", "Денчик", "Ваныч", "Марина",
      "Халиль", "Палыч", "Виктор", "Артемий", "Тимофей",
    ]);
    expect(roster.require("object_verdict").person).toBe("Артемий");
    expect(roster.require("work_schedule").person).toBe("Тимофей");
  });

  it("каркас роли объявлен у всех, чей документ пакета — книга", () => {
    /**
     * КАРКАС — НЕ СПИСОК ЛИСТОВ КНИГИ. Предметные листы агент выбирает сам по
     * объекту: «Контактная сеть: смета против физики» осмысленна на переезде и
     * бессмысленна на жилом доме, и заданный конфигурацией список заставил бы
     * агента выдумать таблицу там, где предмета нет.
     *
     * Каркас — то, на что роль отвечает НЕЗАВИСИМО от объекта. Не объявленный
     * каркас означает, что лист «Чего в этом документе нет» не сможет назвать
     * ни одного пробела: любое молчание агента будет прочитано как «предмета не
     * нашлось», и разница между «не нашлось» и «не ответил» исчезнет.
     *
     * Настенька исключена: её документ — записка (docx), а не книга, и листов
     * в нём нет вовсе. Требовать их значило бы просить работу в никуда.
     */
    const { roster } = loadAgentRoster("config/agents");

    const без = roster
      .all()
      .filter((agent) => agent.capability !== "object_passport")
      .filter((agent) => agent.requiredSections.length === 0)
      .map((agent) => agent.capability);

    expect(без, "роль без каркаса: её молчание нечем отличить от отсутствия предмета").toEqual([]);
  });

  it("лист каркаса несёт основание требования, а не только имя", () => {
    // Основание уходит в промпт. Требование «дай лист convergence» без причины
    // модель выполняет формально — заголовком с пустой таблицей.
    const { roster } = loadAgentRoster("config/agents");

    for (const agent of roster.all()) {
      for (const section of agent.requiredSections) {
        expect(section.why.length, `${agent.capability}/${section.id}: основание короче фразы`)
          .toBeGreaterThan(20);
      }
    }
  });

  it("у листа каркаса задана шапка — иначе сведение по документам даёт лоскут", () => {
    /**
     * Замерено на прогоне эталонного входа: сметчик смотрит четыре сметы по
     * одной и заголовки придумывает на каждой заново — «Вывод» на первой,
     * «Статус» на второй, «Значение» на одной, «Сумма» на другой. Сведение
     * четырёх смет в один лист дало восемь граф, половина из которых в каждой
     * строке прочерк.
     *
     * Шапка каркасного листа от объекта не зависит: сходимость везде
     * описывается показателем, значением, расхождением и основанием. К
     * ПРЕДМЕТНЫМ листам это не относится — их колонки знает только агент,
     * увидевший объект, и задать их значило бы вернуться к привязке к одной
     * структуре входа.
     */
    const { roster } = loadAgentRoster("config/agents");

    const без = roster
      .all()
      .flatMap((agent) =>
        agent.requiredSections
          .filter((section) => section.columns === undefined || section.columns.length === 0)
          .map((section) => `${agent.capability}/${section.id}`),
      );

    expect(без, "лист каркаса без шапки: у четырёх смет он выйдет с четырьмя разными").toEqual([]);
  });

  it("идентификаторы листов каркаса не повторяются внутри роли", () => {
    // Два листа с одним `id` схлопнутся в книге в один: имя листа строится из
    // `id`, и Excel не даст двух одинаковых.
    const { roster } = loadAgentRoster("config/agents");

    for (const agent of roster.all()) {
      const ids = agent.requiredSections.map((section) => section.id);
      expect(new Set(ids).size, `${agent.capability}: повтор id листа каркаса`).toBe(ids.length);
    }
  });
});
