/**
 * Тесты написаны до реализации.
 *
 * Проверка объекта — это гейт MVP из роадмапа (M1): на входе папка объекта, на
 * выходе вердикт по критериям ТЗ §12.1. Главное свойство, которое здесь
 * защищается, — обход не теряет документы молча.
 */
import { describe, expect, it } from "vitest";

import { checkObject } from "./check-object.js";
import type { CheckObjectPorts, CheckProgress, DiscoveredDocument } from "./check-object.js";

const ЛСР_A = "объект/ЛСР-1.xlsx";
const ЛСР_B = "объект/ЛСР-2.xlsx";
const ССРСС = "объект/ССРСС.xlsx";
const РД = "объект/чертежи.pdf";

function ports(overrides: Partial<CheckObjectPorts> = {}): CheckObjectPorts {
  return {
    discover: async () => [
      { path: ЛСР_A, kind: "лср" },
      { path: ЛСР_B, kind: "лср" },
    ],
    checkDocument: async (document) => ({
      positions: 10,
      byCode: 9,
      unmatched: 1,
      converged: true,
      delta: "0.00",
      documentTotal: "1000.00",
      path: document.path,
    }),
    ...overrides,
  };
}

describe("проверка объекта", () => {
  it("обходит все сметы объекта и складывает итоги", async () => {
    const body = await checkObject("объект", ports());

    expect(body.totals.documents).toBe(2);
    expect(body.totals.checked).toBe(2);
    expect(body.totals.positions).toBe(20);
    expect(body.totals.byCode).toBe(18);
    expect(body.verdict).toBe("принято");
  });

  it("не принимает объект, если хоть одна смета не сошлась", async () => {
    // §12.1б: расхождение внутри ЛСР должно быть ровно 0 ₽.
    const body = await checkObject(
      "объект",
      ports({
        checkDocument: async (document) => ({
          positions: 10,
          byCode: 10,
          unmatched: 0,
          converged: document.path === ЛСР_A,
          delta: document.path === ЛСР_A ? "0.00" : "1250.40",
          documentTotal: "1000.00",
          path: document.path,
        }),
      }),
    );

    expect(body.verdict).toBe("не принято");
    const gate = body.gates.find((candidate) => candidate.id === "§12.1б");
    expect(gate?.passed).toBe(false);
    // Гейт называет ФАЙЛ, а не путь до него: путь тащит на экран каталог
    // развёртывания и идентификатор арендатора (см. `gate-detail.test.ts`).
    expect(gate?.detail).toContain("ЛСР-2.xlsx");
    expect(gate?.detail, "в пояснении гейта остался путь файловой системы").not.toContain("/");
  });

  it("предъявляет смету, которую не смог разобрать, а не пропускает её", async () => {
    // Молчаливый пропуск нечитаемой сметы — это ложное «всё сошлось»
    // на неполном обходе. Запрещено инвариантом ТЗ §9.
    const body = await checkObject(
      "объект",
      ports({
        checkDocument: async (document) => {
          if (document.path === ЛСР_B) throw new Error("не найдено ни одного раздела");
          return {
            positions: 10,
            byCode: 10,
            unmatched: 0,
            converged: true,
            delta: "0.00",
            documentTotal: "1000.00",
            path: document.path,
          };
        },
      }),
    );

    const failed = body.documents.find((candidate) => candidate.path === ЛСР_B);
    expect(failed?.status).toBe("отказ");
    expect(failed?.reason).toContain("не найдено ни одного раздела");

    expect(body.totals.checked).toBe(1);
    expect(body.totals.failed).toBe(1);
    expect(body.verdict).toBe("не принято");
  });

  it("считает нечитаемую смету провалом полноты обхода", async () => {
    const body = await checkObject(
      "объект",
      ports({
        checkDocument: async () => {
          throw new Error("это не книга Excel");
        },
      }),
    );

    const gate = body.gates.find((candidate) => candidate.id === "обход");
    expect(gate?.passed).toBe(false);
  });

  it("не считает провалом документы, которые не являются сметами", async () => {
    // Рабочая документация и ССРСС лежат в той же папке, но гейт §12.1б —
    // про локальные сметные расчёты. Их надо показать, а не провалить ими объект.
    const body = await checkObject(
      "объект",
      ports({
        discover: async (): Promise<readonly DiscoveredDocument[]> => [
          { path: ЛСР_A, kind: "лср" },
          { path: ССРСС, kind: "ссрсс" },
          { path: РД, kind: "рабочая-документация" },
        ],
      }),
    );

    expect(body.verdict).toBe("принято");
    expect(body.totals.documents).toBe(3);
    expect(body.totals.checked).toBe(1);

    const skipped = body.documents.filter((candidate) => candidate.status === "не поддержан");
    expect(skipped.map((candidate) => candidate.path)).toEqual([ССРСС, РД]);
    for (const document of skipped) {
      expect(document.reason).not.toBe("");
    }
  });

  it("ПРОЧИТАННЫЙ документ назван прочитанным, а не неподдержанным", async () => {
    /**
     * Подшивка рабочей документации помечалась «не поддержан» — тем же словом,
     * что чертёж AutoCAD, которого система не открывает вовсе. При этом из неё
     * прочитано полтораста тысяч знаков текстового слоя и отправлены агентам
     * листы картинками, и оба тома названы в замечаниях поимённо.
     *
     * «Не поддержан» о таком документе — неправда, и клиент читает её как «мой
     * файл выбросили».
     */
    const body = await checkObject(
      "объект",
      ports({
        discover: async (): Promise<readonly DiscoveredDocument[]> => [
          { path: ЛСР_A, kind: "лср" },
          { path: РД, kind: "рабочая-документация", text: { text: "текст подшивки ".repeat(400), pages: 53 } },
        ],
        sheetsOf: () => 12,
      }),
    );

    const рд = body.documents.find((candidate) => candidate.path === РД);

    expect(рд?.status, "прочитанная подшивка объявлена неподдержанной").toBe("прочитан");
    // И сказано, ЧТО именно взято: «позиций 0» о файле в четыре мегабайта
    // читается как «пусто».
    expect(рд?.readout?.pages).toBe(53);
    expect(рд?.readout?.chars).toBeGreaterThan(1000);
    expect(рд?.readout?.sheets).toBe(12);
  });

  it("документ БЕЗ текста остаётся неподдержанным: различие не косметическое", async () => {
    // Чертёж AutoCAD и скан система действительно не открывает. Пометить их
    // «прочитан» значило бы стереть разницу, ради которой статус и заведён.
    const body = await checkObject(
      "объект",
      ports({
        discover: async (): Promise<readonly DiscoveredDocument[]> => [
          { path: ЛСР_A, kind: "лср" },
          { path: "объект/план.dwg", kind: "не-разобран", reason: "чертёж AutoCAD: формат вне §8.1" },
        ],
      }),
    );

    const dwg = body.documents.find((candidate) => candidate.path.endsWith(".dwg"));

    expect(dwg?.status).toBe("не поддержан");
    expect(dwg?.readout).toBeUndefined();
    expect(dwg?.reason).toContain("AutoCAD");
  });

  it("не объявляет объект принятым, если сверять было нечего", async () => {
    // Папка без смет не должна давать зелёный вердикт: это не успех,
    // а отсутствие предмета проверки.
    const body = await checkObject("объект", ports({ discover: async () => [] }));

    expect(body.totals.checked).toBe(0);
    expect(body.verdict).toBe("нечего проверять");
  });

  it("выводит долю позиций с нормативным шифром, не выдавая её за полноту", async () => {
    const body = await checkObject("объект", ports());
    const gate = body.gates.find((candidate) => candidate.id === "§12.1а");

    // Сходимость 0 ₽ доказывает, что ни одна позиция не потеряна ПО СУММАМ:
    // пропущенная позиция дала бы расхождение. Это и есть проверяемое здесь
    // утверждение, а не «95% против ручной сверки» — ручной сверки у нас нет.
    expect(gate?.passed).toBe(true);
    expect(gate?.detail).toMatch(/сходимост/i);
  });
});

describe("проверка объекта с обзором сметчика", () => {
  const review = async () => ({
    verdict: "смета в целом обоснована",
    findings: [
      { severity: "high" as const, statement: "завышен расход кабеля", basis: "ГЭСНм08-02-409-03" },
      { severity: "info" as const, statement: "позиция без единицы", basis: "строка 41" },
    ],
  });

  const сметчик = { capability: "estimate_review", review };

  it("собирает замечания по всем сметам объекта", async () => {
    const body = await checkObject("объект", { ...ports(), reviewers: [сметчик] });

    expect(body.review?.requested).toBe(true);
    expect(body.review?.findings).toBe(4);
    expect(body.review?.bySeverity["high"]).toBe(2);
    expect(body.verdict).toBe("принято");
  });

  it("не считает суммы влияния, а только показывает замечания", async () => {
    // Сложение денег требует следа формулы (§12.1д). Складывать влияние
    // замечаний здесь, в обходе, значило бы завести число без провенанса.
    const body = await checkObject("объект", { ...ports(), reviewers: [сметчик] });

    expect(body.review).not.toHaveProperty("totalImpact");
  });

  it("предъявляет отказ агента и не принимает объект", async () => {
    // Запросили обзор и не получили — отчитаться «принято» значило бы
    // выдать неполную Проверку за полную.
    const body = await checkObject("объект", {
      ...ports(),
      reviewers: [
        {
          capability: "estimate_review",
          review: async (document) => {
            if (document.path === ЛСР_B) throw new Error("endpoint недоступен");
            return review();
          },
        },
      ],
    });

    const failed = body.review?.documents.find((candidate) => candidate.path === ЛСР_B);
    expect(failed?.error).toContain("endpoint недоступен");

    expect(body.gates.find((gate) => gate.id === "агент")?.passed).toBe(false);
    expect(body.verdict).toBe("не принято");
  });

  it("без запроса обзора не добавляет ни раздела, ни гейта", async () => {
    const body = await checkObject("объект", ports());

    expect(body.review).toBeUndefined();
    expect(body.gates.some((gate) => gate.id === "агент")).toBe(false);
    expect(body.verdict).toBe("принято");
  });

  it("ДВА агента смотрят каждую смету, и видно, кто что сказал", async () => {
    // Ради этого порт и стал списком. Без имени агента в отчёте на сорок
    // замечаний нельзя понять, кто автор, и спорить с выводом не с кем.
    const гип = {
      capability: "tech_opinion",
      review: async () => ({
        verdict: "объёмы не подтверждены геометрией",
        findings: [
          { severity: "critical" as const, statement: "кратность ×3", basis: "ГЭСНм20-03-035" },
        ],
      }),
    };

    const body = await checkObject("объект", { ...ports(), reviewers: [сметчик, гип] });

    const авторы = new Set(body.review?.documents.map((outcome) => outcome.capability));

    expect(авторы).toEqual(new Set(["estimate_review", "tech_opinion"]));
    // Два агента по две сметы: четыре замечания сметчика плюс два ГИПа.
    expect(body.review?.findings).toBe(6);
  });

  it("отказ ОДНОГО агента не отменяет работу второго", async () => {
    // Иначе недоступность одной модели обнуляла бы всю Проверку.
    const сломанный = {
      capability: "tech_opinion",
      review: async () => {
        throw new Error("endpoint недоступен");
      },
    };

    const body = await checkObject("объект", { ...ports(), reviewers: [сметчик, сломанный] });

    expect(body.review?.findings).toBe(4);
    expect(body.review?.failed).toBe(2);
  });
});

describe("сверка суммы смет со сводным сметным расчётом", () => {
  const summary = async () => ({
    path: ССРСС,
    scope: "chapters:1-9",
    label: "Итого по Главам 1-9",
    declaredThousands: "2000.00",
    declaredRubles: "2000000.00",
    delta: "0.00",
    granularity: "10",
    explainedByScale: true,
  });

  const ports2 = () =>
    ports({
      discover: async (): Promise<readonly DiscoveredDocument[]> => [
        { path: ЛСР_A, kind: "лср" },
        { path: ЛСР_B, kind: "лср" },
        { path: ССРСС, kind: "ссрсс" },
      ],
    });

  it("сводный расчёт перестаёт быть пропущенным и становится сверенным", async () => {
    const body = await checkObject("объект", { ...ports2(), checkSummary: summary });

    const ссрсс = body.documents.find((document) => document.path === ССРСС);
    expect(ссрсс?.status).toBe("сверен");
    expect(body.totals.skipped).toBe(0);
  });

  it("принимает расхождение, объяснимое шкалой источника", async () => {
    // ССРСС номинирован в тыс. руб., ЛСР — в рублях. Расхождение в пределах
    // гранулярности шкалы — округление источника, а не ошибка сметы.
    const body = await checkObject("объект", {
      ...ports2(),
      checkSummary: async () => ({ ...(await summary()), delta: "7.52", explainedByScale: true }),
    });

    expect(body.summary?.delta).toBe("7.52");
    expect(body.gates.find((gate) => gate.id === "ЛСР→ССРСС")?.passed).toBe(true);
  });

  it("не принимает расхождение вне гранулярности шкалы", async () => {
    const body = await checkObject("объект", {
      ...ports2(),
      checkSummary: async () => ({ ...(await summary()), delta: "1250.40", explainedByScale: false }),
    });

    const gate = body.gates.find((candidate) => candidate.id === "ЛСР→ССРСС");
    expect(gate?.passed).toBe(false);
    expect(gate?.detail).toContain("1250.40");
    expect(body.verdict).toBe("не принято");
  });

  it("предъявляет отказ разбора сводного расчёта, а не молчит", async () => {
    const body = await checkObject("объект", {
      ...ports2(),
      checkSummary: async () => {
        throw new Error("не найдена шапка «Сметная стоимость, тыс. руб.»");
      },
    });

    expect(body.summary?.error).toContain("не найдена шапка");
    expect(body.gates.find((gate) => gate.id === "ЛСР→ССРСС")?.passed).toBe(false);
  });

  it("без сводного расчёта в папке гейт сверки не выставляется", async () => {
    // Гейт, которому нечего проверять, не должен изображать успех.
    const body = await checkObject("объект", { ...ports(), checkSummary: summary });

    expect(body.summary).toBeUndefined();
    expect(body.gates.some((gate) => gate.id === "ЛСР→ССРСС")).toBe(false);
  });
});

describe("сверка со сводным расчётом без единой проверенной сметы", () => {
  const ports3 = () =>
    ports({
      discover: async (): Promise<readonly DiscoveredDocument[]> => [
        { path: ЛСР_A, kind: "лср" },
        { path: ССРСС, kind: "ссрсс" },
      ],
      checkDocument: async () => {
        throw new Error("источник документов выключен областью знания");
      },
    });

  it("не сверяет, когда смет нет: ноль слагаемых — не ноль рублей", async () => {
    // Дефект, вскрытый гейтом области знания: когда ни одна смета не
    // разобрана, сумма смет равна 0 ₽, и сравнение её с ССРСС даёт
    // расхождение размером во весь сводный расчёт. Это не расхождение,
    // это отсутствие предмета сверки — и оно обязано называться так.
    let вызвана = false;

    const body = await checkObject("объект", {
      ...ports3(),
      checkSummary: async () => {
        вызвана = true;
        return {
          path: ССРСС,
          scope: "chapters:1-9",
          label: "Итого по Главам 1-9",
          declaredThousands: "104976.71",
          declaredRubles: "104976710.00",
          delta: "104976710.00",
          granularity: "10",
          explainedByScale: false,
        };
      },
    });

    expect(вызвана).toBe(false);
    expect(body.summary?.error).toContain("ни одна смета не проверена");
  });

  it("гейт сверки не выставляется как проваленный по несуществующему расхождению", async () => {
    const body = await checkObject("объект", {
      ...ports3(),
      checkSummary: async () => {
        throw new Error("не должно вызываться");
      },
    });

    const gate = body.gates.find((candidate) => candidate.id === "ЛСР→ССРСС");
    expect(gate?.detail).toContain("сверять нечего");
  });
});

/**
 * ХОД ПРОГОНА (веха Д2 плана демо).
 *
 * Проверяется не «события отправляются», а то, ради чего они заведены:
 * замечание агента доступно В МОМЕНТ, когда агент его дал, а не после
 * последнего такта. Обход по семи файлам идёт тридцать шесть минут, и это
 * разница между «показать на пятой минуте» и «молчать двадцать».
 */
describe("ход прогона", () => {
  /**
   * Агент, который сообщает о себе ДО того, как ответил.
   *
   * Приём нужен, чтобы поймать главное: события «начал» и «высказался» должны
   * приходить в разном времени, а не парой в конце. Промис, который агент ждёт,
   * даёт тесту точку, где он уже работает и ещё не ответил.
   */
  function медленныйАгент(): {
    readonly reviewer: NonNullable<CheckObjectPorts["reviewers"]>[number];
    readonly ответить: () => void;
  } {
    let освободить = (): void => {};
    const ждёт = new Promise<void>((resolve) => {
      освободить = resolve;
    });

    return {
      reviewer: {
        capability: "estimate_review",
        review: async () => {
          await ждёт;
          return {
            verdict: "смета к работе пригодна",
            findings: [{ severity: "critical", statement: "расценка задвоена", basis: "позиции 12 и 48" }],
          };
        },
      },
      ответить: () => освободить(),
    };
  }

  it("сообщает этап, число документов и разбор каждого — до конца обхода", async () => {
    const events: CheckProgress[] = [];

    await checkObject("объект", ports({ progress: async (event) => void events.push(event) }));

    expect(events[0]).toEqual({ kind: "этап", phase: "обход папки" });
    expect(events[1]).toEqual({ kind: "обход", documents: 2 });

    const документы = events.filter((event) => event.kind === "документ");
    expect(документы).toHaveLength(2);
    // Счётчик двигается по факту разбора, а не приезжает готовым в конце.
    expect(документы.map((event) => (event.kind === "документ" ? event.done : 0))).toEqual([1, 2]);
  });

  it("замечания агента доступны ДО того, как высказались остальные", async () => {
    const первый = медленныйАгент();
    const второй = медленныйАгент();
    const events: CheckProgress[] = [];

    const прогон = checkObject("объект", {
      ...ports({ progress: async (event) => void events.push(event) }),
      discover: async () => [{ path: ЛСР_A, kind: "лср" }, { path: ЛСР_B, kind: "лср" }],
      reviewers: [
        { capability: "estimate_review", review: первый.reviewer.review },
        { capability: "tech_opinion", review: второй.reviewer.review },
      ],
    });

    // Оба взялись за работу, ни один не ответил.
    await Promise.resolve();
    первый.ответить();
    // Двух витков цикла событий хватает, чтобы отчёт о первом дошёл: ждать
    // завершения прогона здесь нельзя — тогда проверка станет проверкой итога.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const высказались = events.filter((event) => event.kind === "агент-высказался");
    expect(высказались.length).toBeGreaterThan(0);
    expect(
      высказались.some(
        (event) =>
          event.kind === "агент-высказался" &&
          event.outcome.capability === "estimate_review" &&
          event.outcome.findings[0]?.statement === "расценка задвоена",
      ),
    ).toBe(true);
    // Второй ещё думает — и это то самое «по мере готовности».
    expect(
      высказались.some((event) => event.kind === "агент-высказался" && event.outcome.capability === "tech_opinion"),
    ).toBe(false);

    второй.ответить();
    await прогон;
  });

  it("отличает начало работы агента от его ответа", async () => {
    const агент = медленныйАгент();
    const events: CheckProgress[] = [];

    const прогон = checkObject("объект", {
      ...ports({ progress: async (event) => void events.push(event) }),
      discover: async () => [{ path: ЛСР_A, kind: "лср" }],
      reviewers: [агент.reviewer],
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(events.some((event) => event.kind === "агент-начал")).toBe(true);
    expect(events.some((event) => event.kind === "агент-высказался")).toBe(false);

    агент.ответить();
    await прогон;

    expect(events.some((event) => event.kind === "агент-высказался")).toBe(true);
  });

  it("упавший отчёт о ходе не роняет прогон и не молчит о себе", async () => {
    // Тридцать шесть минут работы не имеют права погибнуть из-за недоступной
    // на секунду базы. Но и потеря не имеет права быть невидимой: экран,
    // разошедшийся с фактом, объясняется этим полем, а не догадкой.
    const body = await checkObject(
      "объект",
      ports({
        progress: async () => {
          throw new Error("база недоступна");
        },
      }),
    );

    expect(body.verdict).toBe("принято");
    expect(body.progressLost?.join(" ")).toContain("база недоступна");
  });

  it("без порта хода обход работает молча и тело о потерях не сочиняет", async () => {
    const body = await checkObject("объект", ports());

    expect(body.progressLost).toBeUndefined();
  });
});

/**
 * ИСТОЧНИК У ВЫВОДА (веха Д3 плана демо).
 *
 * Обход — воронка, через которую проходят замечания всех девяти агентов: поле,
 * потерянное здесь, теряется у всех сразу. Так уже терялась сумма влияния, а
 * вместе с ней координата строки. Здесь проверяется, что обход не теряет ни
 * координату, ни открытые вопросы.
 */
describe("источник у вывода", () => {
  const КООРДИНАТА = {
    sourceId: "объект/ЛСР-1.xlsx",
    contentHash: "a".repeat(64),
    locator: { kind: "row", sheet: "Раздел 3", row: 48 },
    status: "fact",
    acquisition: "parsed",
    checkedAt: "2026-09-04",
    staleAfterDays: 90,
  } as never;

  it("координата строки доезжает от агента до тела результата", async () => {
    const body = await checkObject(
      "объект",
      ports({
        discover: async () => [{ path: ЛСР_A, kind: "лср" }],
        reviewers: [
          {
            capability: "estimate_review",
            review: async () => ({
              verdict: "смета пригодна",
              findings: [
                { severity: "critical", statement: "расценка задвоена", basis: "поз. 12 и 48", source: КООРДИНАТА },
                // Второе — БЕЗ координаты: обход обязан довезти и его, не
                // выдумав ссылку и не отбросив замечание.
                { severity: "medium", statement: "объём без подтверждения", basis: "лист 2" },
              ],
            }),
          },
        ],
      }),
    );

    const findings = body.review?.documents[0]?.findings ?? [];

    expect(findings[0]?.source?.locator).toEqual({ kind: "row", sheet: "Раздел 3", row: 48 });
    expect(findings[1]?.source).toBeUndefined();
    expect(findings).toHaveLength(2);
  });

  it("открытые вопросы агента доезжают вместе с замечаниями", async () => {
    // Восьмая графа формы результата. Её отбрасывали все девять портов, и на
    // экране «что проверить человеку» не существовало вовсе.
    const body = await checkObject(
      "объект",
      ports({
        discover: async () => [{ path: ЛСР_A, kind: "лср" }],
        reviewers: [
          {
            capability: "estimate_review",
            review: async () => ({
              verdict: "смета пригодна",
              findings: [],
              openQuestions: [
                { question: "запросить исполнительную", owner: "ПТО", dueBy: "2026-09-10" },
              ],
            }),
          },
        ],
      }),
    );

    expect(body.review?.documents[0]?.openQuestions).toEqual([
      { question: "запросить исполнительную", owner: "ПТО", dueBy: "2026-09-10" },
    ]);
  });

  it("агент без открытых вопросов не получает пустого списка вместо отсутствия", async () => {
    // «Вопросов не задал» и «поле не заполняли» — разные утверждения, и пустой
    // массив стёр бы разницу: экран не смог бы отличить одно от другого.
    const body = await checkObject(
      "объект",
      ports({
        discover: async () => [{ path: ЛСР_A, kind: "лср" }],
        reviewers: [
          {
            capability: "estimate_review",
            review: async () => ({ verdict: "смета пригодна", findings: [] }),
          },
        ],
      }),
    );

    expect(body.review?.documents[0]?.openQuestions).toBeUndefined();
  });

  it("отказ РАЗБОРА не выдаётся за отказ ЧТЕНИЯ", async () => {
    /**
     * Замерено на входе из пяти документов, ни один из которых не по эталонной
     * структуре: ведомость объёмов в `.csv`, калькуляция своей вёрстки, смета с
     * нераспознанной раскладкой формы. Позиций из них не извлечь — и извлекать
     * нельзя, выдуманная позиция хуже отсутствующей. Но содержимое ЧИТАЕТСЯ:
     * все пять доехали до агентов текстом и названы в замечаниях поимённо.
     *
     * Экран при этом показывал «отказ» и молчал о прочитанном. Человек читает
     * это слово как «мой файл выбросили» — и это неправда, дорогая ровно тем,
     * что проверяема: файл назван в выводах, которых он якобы не породил.
     */
    const body = await checkObject(
      "объект",
      ports({
        discover: async () => [{ path: ЛСР_A, kind: "лср" }],
        checkDocument: async () => {
          throw new Error("не найдена шапка таблицы: возможно, это не сметный расчёт");
        },
        charsOf: () => 4419,
      }),
    );

    const документ = body.documents[0]!;

    expect(документ.status, "отказ разбора остаётся отказом: позиций нет").toBe("отказ");
    expect(документ.reason).toContain("не найдена шапка таблицы");
    expect(документ.reason, "прочитанное не названо").toContain("передано агентам текстом");
    expect(документ.readout?.chars).toBe(4419);
  });

  it("отказ, из которого агентам не ушло ничего, о передаче НЕ сообщает", async () => {
    // Скан и повреждённый файл — тот случай, когда «отказ» и есть вся правда.
    // Приписать им передачу значило бы отчитаться о работе, которой не было.
    const body = await checkObject(
      "объект",
      ports({
        discover: async () => [{ path: ЛСР_A, kind: "лср" }],
        checkDocument: async () => {
          throw new Error("файл повреждён");
        },
        charsOf: () => 0,
      }),
    );

    expect(body.documents[0]!.reason).toBe("файл повреждён");
    expect(body.documents[0]!.readout).toBeUndefined();
  });

  it("вызовы инструментов агента доезжают до артефакта поимённо", async () => {
    /**
     * Т9.4. «Агент позвал инструмент шесть раз» без перечня — это счётчик, а не
     * след: по нему нельзя проверить, ЧТО он смотрел. У агентного режима ответ
     * на вопрос «откуда взято» длиннее, чем у конвейера, а не короче.
     */
    const body = await checkObject(
      "объект",
      ports({
        discover: async () => [{ path: ЛСР_A, kind: "лср" }],
        reviewers: [
          {
            capability: "estimate_review",
            review: async () => ({
              verdict: "смета пригодна",
              findings: [],
              toolCalls: [
                { tool: "read_positions", arguments: '{"document":"ЛСР-1.xlsx"}', resultChars: 4120, resultDigest: "a1b2c3d4" },
                { tool: "lookup_norm", arguments: '{"code":"ГЭСН01"}', resultChars: 0, resultDigest: "00000000", failed: "шифр не найден" },
              ],
            }),
          },
        ],
      }),
    );

    const вызовы = body.review?.documents[0]?.toolCalls ?? [];

    expect(вызовы).toHaveLength(2);
    expect(вызовы[0]?.tool).toBe("read_positions");
    expect(вызовы[0]?.arguments, "доводы потеряны: видно «звал», не видно «о чём»").toContain("ЛСР-1.xlsx");
    expect(вызовы[1]?.failed, "отказ инструмента выглядел бы пустым ответом").toBe("шифр не найден");
  });

  it("конвейер отличён от агента: у него вызовов НЕТ, а не пусто", async () => {
    // «Инструментов не было» и «инструменты были, агент их не звал» — разные
    // утверждения, и разница нужна при сравнении режимов.
    const body = await checkObject(
      "объект",
      ports({
        discover: async () => [{ path: ЛСР_A, kind: "лср" }],
        reviewers: [
          { capability: "estimate_review", review: async () => ({ verdict: "смета пригодна", findings: [] }) },
        ],
      }),
    );

    expect(body.review?.documents[0]?.toolCalls).toBeUndefined();
  });

  it("предметные листы агента доезжают до отчёта целиком, а не именами", async () => {
    /**
     * Оболочка агента собирала листы, и они умирали в ней: у обхода не было
     * поля, куда их положить. Книга заключения выходила без единой предметной
     * таблицы — с вердиктом, замечаниями и ничем между ними.
     *
     * Довозить надо ЦЕЛИКОМ. Имя листа без колонок и строк — это заголовок
     * пустой таблицы: читатель видит «Контактная сеть: смета против физики» и
     * ни одного числа под ним.
     */
    const body = await checkObject(
      "объект",
      ports({
        discover: async () => [{ path: ЛСР_A, kind: "лср" }],
        reviewers: [
          {
            capability: "estimate_review",
            review: async () => ({
              verdict: "смета пригодна",
              findings: [],
              sections: [
                {
                  id: "ks-geometry",
                  title: "Контактная сеть: смета против физики",
                  purpose: "объём сметы сверяется с геометрией трассы",
                  columns: ["Параметр", "Значение", "Ед."],
                  rows: [["длина участка", "15 240", "м"]],
                },
              ],
            }),
          },
        ],
      }),
    );

    expect(body.review?.documents[0]?.sections).toEqual([
      {
        id: "ks-geometry",
        title: "Контактная сеть: смета против физики",
        purpose: "объём сметы сверяется с геометрией трассы",
        columns: ["Параметр", "Значение", "Ед."],
        rows: [["длина участка", "15 240", "м"]],
      },
    ]);
  });

  it("агент без предметных листов не получает пустого списка вместо отсутствия", async () => {
    // «Предмета на объекте не нашлось» и «листы у агента не запрашивались» —
    // разные утверждения. Пустой массив выдал бы второе за первое.
    const body = await checkObject(
      "объект",
      ports({
        discover: async () => [{ path: ЛСР_A, kind: "лср" }],
        reviewers: [
          {
            capability: "estimate_review",
            review: async () => ({ verdict: "смета пригодна", findings: [] }),
          },
        ],
      }),
    );

    expect(body.review?.documents[0]?.sections).toBeUndefined();
  });
});
