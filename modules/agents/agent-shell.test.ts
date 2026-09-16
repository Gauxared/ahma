/**
 * Тесты написаны до реализации. Оболочка модельного агента — ADR-R-011, ТЗ §9,
 * §12.1д, §12.2.
 *
 * ЗАЧЕМ ОБОЛОЧКА
 *
 * Сметчик — единственный из девяти агентов, обращающийся к модели, и стоит он
 * 411 строк. Восемь остальных тем же способом — это ещё три тысячи строк, восемь
 * схем вывода, восемь разборщиков ответа. ADR-R-011 требовал «реестр агентов
 * N-арный с первого дня»: по чек-листам и протоколу он N-арен, по ИСПОЛНЕНИЮ —
 * нет, модельный агент остаётся штучной работой.
 *
 * ЧТО ЗДЕСЬ ОБЩЕЕ, А ЧТО ОСТАЁТСЯ У АГЕНТА
 *
 * Общее — всё, что одинаково у любого агента: строгая схема вывода, отбраковка
 * замечания без основания (§9), подстановка суммы влияния ИЗ РАСЧЁТНОГО МОДУЛЯ
 * (§12.1д), обезличивание перед выходом, метрики прогона.
 *
 * Частное — три вещи: какие детерминированные проверки сложить агенту на вход,
 * как их изложить и откуда брать суммы. Это и есть то, чем Денчик отличается от
 * Ваныча, и сводить их к общему знаменателю нельзя.
 *
 * ЧЕГО ОБОЛОЧКА НЕ ДЕЛАЕТ
 *
 * Она не считает и не толкует. Число, пришедшее от модели, в результат не
 * попадает НИКОГДА: влияние берётся по порядковому номеру из данных расчётного
 * модуля. Иначе §12.1д («каждое число имеет источник») держался бы на том, что
 * модель не соврёт.
 */
import { describe, expect, it, vi } from "vitest";

import type { OperationDefinition, Sha256 } from "@contracts/index.js";

import { AGENT_OUTPUT_SCHEMA, createAgentOperation } from "./agent-shell.js";
import type { AgentRunRequest, AgentTurn } from "./agent-shell.js";

const ОПРЕДЕЛЕНИЕ: OperationDefinition = {
  id: "run-test-agent",
  version: 1,
  kind: "agent",
  variants: [],
  requires: [],
  optional: [],
  provides: ["test_review"],
  preconditions: [],
};

interface Вход {
  readonly documentPath: string;
  readonly contentHash: Sha256;
}

const ВХОД: Вход = { documentPath: "objects/КРГ-1/смета.xlsx", contentHash: "abc123" as Sha256 };

function ответ(output: unknown): AgentTurn {
  return {
    output,
    provider: "п",
    model: "м-1",
    inputTokens: 100,
    outputTokens: 50,
    latencyMs: 1234,
  };
}

const ЗАМЕЧАНИЕ = {
  severity: "high",
  statement: "позиция завышена",
  basis: "Расчётный модуль: поз. 14",
  deviation: "rate_overstatement",
  impactOrdinal: "14",
};

function агент(
  turn: AgentTurn,
  overrides: Partial<Parameters<typeof createAgentOperation<Вход>>[0]> = {},
) {
  const runAgent = vi.fn(async (_request: AgentRunRequest) => turn);

  const operation = createAgentOperation<Вход>({
    definition: ОПРЕДЕЛЕНИЕ,
    prompt: "системный промпт агента",
    buildPrompt: (input) => `документ ${input.documentPath}`,
    evidence: (input) => ({
      amounts: new Map([["14", { amount: "824009.97", row: 89 }]]),
      sourceId: input.documentPath,
      contentHash: input.contentHash,
      sheet: "ЛСР",
    }),
    accuracy: () => ({ range: "±5%", basis: "смета разобрана", heuristic: true }) as const,
    runAgent,
    ...overrides,
  });

  return { operation, runAgent };
}

describe("обращение к модели", () => {
  it("ОБЪЯВЛЯЕТ агенту отсутствие опорной базы, а не молчит о нём", async () => {
    // Агент, не знающий, что базы нет, отвечает так же уверенно, как агент с
    // базой, и отличить эти два ответа читателю нечем. Правило самого легаси:
    // «Нет базы → [БЕЗ БАЗЫ]».
    const { operation, runAgent } = агент(
      ответ({ verdict: "принято", findings: [], openQuestions: [] }),
    );

    await operation.run(ВХОД);

    expect(runAgent.mock.calls[0]![0].systemPrompt).toMatch(/\[БЕЗ БАЗЫ\]/u);
  });

  it("передаёт системный промпт агента и собранный им текст", async () => {
    const { operation, runAgent } = агент(
      ответ({ verdict: "принято", findings: [], openQuestions: [] }),
    );

    await operation.run(ВХОД);

    expect(runAgent).toHaveBeenCalledOnce();
    const запрос = runAgent.mock.calls[0]![0];

    expect(запрос.systemPrompt).toContain("системный промпт агента");
    // Не `toBe`: к тексту агента оболочка добавляет требования режима (§5.4).
    expect(запрос.prompt).toContain("документ objects/КРГ-1/смета.xlsx");
    expect(запрос.outputSchema).toBe(AGENT_OUTPUT_SCHEMA);
  });

  it("называет обезличиванию объект из пути документа", async () => {
    // Путь несёт наименование объекта — связку, привязывающую цены к заказчику.
    const { operation, runAgent } = агент(
      ответ({ verdict: "принято", findings: [], openQuestions: [] }),
    );

    await operation.run(ВХОД);

    const запрос = runAgent.mock.calls[0]![0];

    expect(запрос.anonymize.knownEntities.map((e) => e.value)).toContain("КРГ-1");
    expect(запрос.anonymize.knownEntities.every((e) => e.kind === "Объект")).toBe(true);
    // Соль — отпечаток документа: одинаковые псевдонимы при повторной проверке
    // того же документа, разные — для разных.
    expect(запрос.anonymize.salt).toBe("abc123");
  });
});

describe("основание обязательно (ТЗ §9)", () => {
  it("выпускает замечание с основанием", async () => {
    const { operation } = агент(
      ответ({ verdict: "с замечаниями", findings: [ЗАМЕЧАНИЕ], openQuestions: [] }),
    );

    const { body } = await operation.run(ВХОД);

    expect(body.findings).toHaveLength(1);
    expect(body.rejected).toHaveLength(0);
  });

  it("ОТБРАКОВЫВАЕТ замечание без основания, но не теряет его", async () => {
    // Молчаливая потеря результата модели так же недопустима, как приём вывода
    // без основания: в первом случае мы скрываем, что модель что-то сказала.
    const { operation } = агент(
      ответ({
        verdict: "с замечаниями",
        findings: [{ ...ЗАМЕЧАНИЕ, basis: "   " }],
        openQuestions: [],
      }),
    );

    const { body } = await operation.run(ВХОД);

    expect(body.findings).toHaveLength(0);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0]!.statement).toBe("позиция завышена");
    expect(body.rejected[0]!.reason).toContain("без основания");
  });
});

describe("числа берутся из расчётного модуля, а не из ответа модели", () => {
  it("подставляет сумму влияния по порядковому номеру", async () => {
    // §12.1д: у каждого числа источник. Взять сумму из текста модели значило бы
    // положить в реестр нарушений число без следа.
    const { operation } = агент(
      ответ({ verdict: "с замечаниями", findings: [ЗАМЕЧАНИЕ], openQuestions: [] }),
    );

    const { body } = await operation.run(ВХОД);

    expect(body.findings[0]!.impact?.value.amount).toBe("824009.97");
    expect(body.findings[0]!.impact?.provenance.kind).toBe("source");
  });

  /**
   * КООРДИНАТА СТРОКИ — ВЕХА Д3.
   *
   * До неё координата существовала только внутри `impact`: замечание без
   * денежного влияния теряло её вместе с суммой, и на экране оставался абзац
   * прозы. Здесь проверяется, что ссылка на источник стоит на самом замечании
   * и несёт всё, что нужно читателю: лист, строку и уровень доверия.
   */
  it("даёт замечанию координату строки, а не только сумме влияния", async () => {
    const { operation } = агент(
      ответ({ verdict: "с замечаниями", findings: [ЗАМЕЧАНИЕ], openQuestions: [] }),
    );

    const { body } = await operation.run(ВХОД);
    const source = body.findings[0]!.source;

    expect(source?.locator).toEqual({ kind: "row", sheet: "ЛСР", row: 89 });
    expect(source?.status).toBe("fact");
    expect(source?.acquisition).toBe("parsed");
    // Ссылка ОДНА на замечание и на сумму: две разошлись бы, и экран показал бы
    // одну строку рядом с суммой из другой.
    expect(body.findings[0]!.impact?.provenance).toEqual({ kind: "source", ref: source });
  });

  /**
   * ИСТОЧНИК БЕРЁТСЯ У ПОЗИЦИИ, А НЕ ОДИН НА АГЕНТА.
   *
   * Объектный агент — снабженец, договорник, подрядчик, исполнительная —
   * получает позиции ИЗ РАЗНЫХ СМЕТ, а источник у него был один: путь папки
   * объекта и отпечаток ПЕРВОГО документа обхода. Замерено на курганском
   * прогоне: 63 замечания из 72 с координатой приходили от таких агентов, то
   * есть у 63 из 72 ссылка «откуда взято» называла не тот файл.
   *
   * Хуже, чем «строки не нашлось»: при совпадении номера строки экран показал
   * бы ЧУЖУЮ строку как источник, и это выглядело бы ответом.
   */
  it("источник берёт у позиции, когда она знает свой файл", async () => {
    const { operation } = агент(ответ({ verdict: "с замечаниями", findings: [ЗАМЕЧАНИЕ], openQuestions: [] }), {
      evidence: (input) => ({
        amounts: new Map([
          [
            "14",
            {
              amount: "824009.97",
              row: 89,
              sourceId: "objects/КРГ-1/вторая-смета.xlsx",
              contentHash: "bbb222" as Sha256,
            },
          ],
        ]),
        // Общий источник НАМЕРЕННО другой: если позиция знает свой файл, он и
        // должен победить.
        sourceId: input.documentPath,
        contentHash: input.contentHash,
        sheet: "ЛСР",
      }),
    });

    const { body } = await operation.run(ВХОД);

    expect(body.findings[0]!.source?.sourceId).toBe("objects/КРГ-1/вторая-смета.xlsx");
    expect(body.findings[0]!.source?.contentHash).toBe("bbb222");
  });

  /**
   * СТРОКА, КОТОРОЙ НЕТ, НЕ СТАНОВИТСЯ КООРДИНАТОЙ.
   *
   * Реверс объёма работает с порядковыми номерами позиций и строки книги не
   * знает — он кладёт в это поле ноль, объявляя незнание. Ноль доезжал до
   * экрана как «лист «ЛСР», строка 0»: координата, которой в книге нет и
   * которая ничем не отличалась от настоящей.
   *
   * След при этом не пропадает, а грубеет: ссылка на позицию по номеру. Сумма
   * влияния сохраняет провенанс — без него её нельзя вынести из модуля.
   */
  it("неизвестная строка даёт след до позиции, а не строку ноль", async () => {
    const { operation } = агент(ответ({ verdict: "с замечаниями", findings: [ЗАМЕЧАНИЕ], openQuestions: [] }), {
      evidence: (input) => ({
        amounts: new Map([["14", { amount: "824009.97", row: 0 }]]),
        sourceId: input.documentPath,
        contentHash: input.contentHash,
        sheet: "ЛСР",
      }),
    });

    const { body } = await operation.run(ВХОД);

    expect(body.findings[0]!.source?.locator).toEqual({ kind: "record", recordId: "14" });
    // Сумма никуда не делась: её след — позиция, а не строка.
    expect(body.findings[0]!.impact?.value.amount).toBe("824009.97");
  });

  it("замечание без найденной позиции остаётся без координаты, а не с выдуманной", async () => {
    // Ноль здесь был бы хуже пустоты: «лист, строка 0» — координата, которой в
    // документе нет, и читатель пошёл бы её искать.
    const { operation } = агент(
      ответ({
        verdict: "с замечаниями",
        findings: [{ ...ЗАМЕЧАНИЕ, impactOrdinal: "999" }],
        openQuestions: [],
      }),
    );

    const { body } = await operation.run(ВХОД);

    expect(body.findings[0]!.source).toBeUndefined();
    expect(body.findings[0]!.statement).toBe("позиция завышена");
  });

  it("оставляет влияние ПУСТЫМ, когда номер не найден", async () => {
    // Неизвестное не превращается в ноль (ТЗ §9). Подставить сюда 0 ₽ значило бы
    // сказать «влияния нет» там, где мы просто не знаем, к чему это относится.
    const { operation } = агент(
      ответ({
        verdict: "с замечаниями",
        findings: [{ ...ЗАМЕЧАНИЕ, impactOrdinal: "999" }],
        openQuestions: [],
      }),
    );

    const { body } = await operation.run(ВХОД);

    expect(body.findings[0]!.impact).toBeUndefined();
  });

  it("не различает пробелы вокруг номера", async () => {
    const { operation } = агент(
      ответ({
        verdict: "с",
        findings: [{ ...ЗАМЕЧАНИЕ, impactOrdinal: " 14 " }],
        openQuestions: [],
      }),
    );

    const { body } = await operation.run(ВХОД);

    expect(body.findings[0]!.impact?.value.amount).toBe("824009.97");
  });

  it("«none» в виде отклонения означает ОТСУТСТВИЕ вида, а не вид «none»", async () => {
    const { operation } = агент(
      ответ({
        verdict: "с",
        findings: [{ ...ЗАМЕЧАНИЕ, deviation: "none" }],
        openQuestions: [],
      }),
    );

    const { body } = await operation.run(ВХОД);

    expect(body.findings[0]!.deviation).toBeUndefined();
  });
});

describe("ответ не по схеме", () => {
  it("ОТКАЗЫВАЕТ, а не подставляет пустое", async () => {
    // Молча вернуть пустой вердикт значило бы выдать «замечаний нет» там, где
    // модель ответила непонятно.
    const { operation } = агент(ответ({ findings: [] }));

    await expect(operation.run(ВХОД)).rejects.toThrow(/схем/iu);
  });

  it("называет агента в отказе", async () => {
    // «Ответ не по схеме» без имени агента при девяти агентах бесполезно.
    const { operation } = агент(ответ(null));

    await expect(operation.run(ВХОД)).rejects.toThrow(/run-test-agent/u);
  });
});

describe("след прогона", () => {
  it("несёт провайдера, модель, токены и время", async () => {
    // §11 нормирует время Проверки, а ADR-R-020 — бюджет внешнего контура.
    // Без этих чисел ни то, ни другое не измеримо.
    const { operation } = агент(ответ({ verdict: "п", findings: [], openQuestions: [] }));

    const { body } = await operation.run(ВХОД);

    expect(body.run).toEqual({
      provider: "п",
      model: "м-1",
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 1234,
    });
  });

  it("возвращает отпечаток входа для снапшота", async () => {
    const { operation } = агент(ответ({ verdict: "п", findings: [], openQuestions: [] }));

    const result = await operation.run(ВХОД);

    expect(result.inputHashes).toEqual(["abc123"]);
  });
});

describe("режим глубины §5.4", () => {
  function ответСТекстом(verdict: string, statements: readonly string[], options: readonly string[] = []) {
    return ответ({
      verdict,
      findings: statements.map((statement) => ({ ...ЗАМЕЧАНИЕ, statement })),
      openQuestions: [],
      options,
    });
  }

  it("СООБЩАЕТ модели контракт режима", async () => {
    // Режим, о котором агент не знает, — не режим. До этого `describeDepth`
    // только печатался в `si eval` и до промпта не доходил.
    const { operation, runAgent } = агент(ответ({ verdict: "п", findings: [], openQuestions: [], options: [] }), {
      depth: "экспресс",
    });

    await operation.run(ВХОД);

    expect(runAgent.mock.calls[0]![0].prompt).toContain("15 строк");
    expect(runAgent.mock.calls[0]![0].prompt).toContain("таблицы запрещены");
  });

  it("по умолчанию — стандарт", async () => {
    const { operation, runAgent } = агент(ответ({ verdict: "п", findings: [], openQuestions: [], options: [] }));

    await operation.run(ВХОД);

    expect(runAgent.mock.calls[0]![0].prompt).toContain("источником");
  });

  it("ЛОВИТ превышение предела строк в экспрессе", async () => {
    // «Будь краток» модель нарушает тем чаще, чем больше ей есть что сказать.
    const { operation } = агент(ответСТекстом("вердикт", Array.from({ length: 20 }, (_, i) => `замечание ${i}`)), {
      depth: "экспресс",
    });

    const { body } = await operation.run(ВХОД);

    expect(body.depth.mode).toBe("экспресс");
    expect(body.depth.violations.join(" ")).toMatch(/15 строк/u);
  });

  it("ЛОВИТ таблицу в экспрессе", async () => {
    const { operation } = агент(ответСТекстом("| шифр | сумма |", ["одно замечание"]), {
      depth: "экспресс",
    });

    const { body } = await operation.run(ВХОД);

    expect(body.depth.violations.join(" ")).toMatch(/таблиц/iu);
  });

  it("ЛОВИТ нехватку вариантов в эксперте", async () => {
    // Эксперт обещает не менее трёх вариантов и матрицу сравнения. Обещание,
    // которое нечем проверить, — не обещание.
    const { operation } = агент(ответСТекстом("вердикт", ["замечание"], ["вариант А"]), {
      depth: "эксперт",
    });

    const { body } = await operation.run(ВХОД);

    expect(body.depth.violations.join(" ")).toMatch(/трёх вариантов|не менее 3/u);
  });

  it("НЕ придирается к эксперту, давшему три варианта", async () => {
    const { operation } = агент(
      ответСТекстом("вердикт", ["замечание"], ["вариант А", "вариант Б", "вариант В"]),
      { depth: "эксперт" },
    );

    const { body } = await operation.run(ВХОД);

    expect(body.depth.violations).toEqual([]);
  });

  it("нарушение формы НЕ отменяет содержание", async () => {
    // Отвергнуть разбор целиком из-за шестнадцатой строки значит выбросить
    // работу, которая по существу верна. Нарушение записывается, а не рушит.
    const { operation } = агент(ответСТекстом("вердикт", Array.from({ length: 20 }, (_, i) => `замечание ${i}`)), {
      depth: "экспресс",
    });

    const { body } = await operation.run(ВХОД);

    expect(body.findings).toHaveLength(20);
    expect(body.depth.violations.length).toBeGreaterThan(0);
  });

  it("варианты доезжают до результата, а не теряются", async () => {
    const { operation } = агент(ответСТекстом("в", ["з"], ["А", "Б", "В"]), { depth: "эксперт" });

    const { body } = await operation.run(ВХОД);

    expect(body.options).toEqual(["А", "Б", "В"]);
  });
});

/**
 * ПРЕДМЕТНЫЕ ЛИСТЫ ЗАКЛЮЧЕНИЯ ОПРЕДЕЛЯЕТ ОБЪЕКТ, А НЕ КОНФИГУРАЦИЯ.
 *
 * Эталонный пакет снят с ОДНОГО объекта — железнодорожного переезда с
 * контактной сетью. Соблазн был вписать его листы («КС_геометрия»,
 * «Проверка_ЭОМ») в манифесты агентов и считать задачу закрытой.
 *
 * Это сломало бы систему на первом же другом объекте: агент, обязанный
 * заполнить лист про предмет, которого нет, начинает его ВЫДУМЫВАТЬ, и
 * выдуманное выглядит анализом. Пустая таблица с уверенным названием хуже
 * отсутствующей.
 *
 * Поэтому проверяется ровно противоположное тому, что просилось: что механизм
 * НЕ знает названий листов и принимает любые.
 */
describe("предметные листы", () => {
  const лист = (id: string, rows: string[][]) => ({
    id,
    title: `Лист ${id}`,
    purpose: "зачем он нужен",
    columns: ["Параметр", "Значение"],
    rows,
  });

  it("принимает листы, которых нет ни в одной конфигурации", async () => {
    // Ни «КС_геометрия», ни «фасады» системе не известны, и это правильно:
    // состав определяется объектом, а объекты бывают любые.
    const { operation } = агент(
      ответ({
        verdict: "🟡 с условием",
        findings: [ЗАМЕЧАНИЕ],
        openQuestions: [],
        options: [],
        sections: [лист("ks-geometry", [["длина", "15 240 м"]]), лист("facades", [["площадь", "3 200 м²"]])],
      }),
    );

    const { body } = await operation.run(ВХОД);

    expect(body.sections.map((s) => s.id)).toEqual(["ks-geometry", "facades"]);
    expect(body.sections[0]?.columns).toEqual(["Параметр", "Значение"]);
  });

  it("лист без строк отбрасывается: заголовок без содержимого — не проверка", async () => {
    // Заведённый и незаполненный лист читается как «предмет проверен и пуст».
    const { operation } = агент(
      ответ({
        verdict: "🟢",
        findings: [ЗАМЕЧАНИЕ],
        openQuestions: [],
        options: [],
        sections: [лист("empty", []), лист("filled", [["a", "b"]])],
      }),
    );

    const { body } = await operation.run(ВХОД);

    expect(body.sections.map((s) => s.id)).toEqual(["filled"]);
  });

  it("поле обязательно по схеме, но пустой список — честный ответ", async () => {
    /**
     * В строгом structured output необязательных полей НЕТ: провайдер отвергает
     * схему, где свойство объявлено и не перечислено в `required`. Это поймал
     * гейт `findStrictSchemaProblems` — тот самый, что стоит с находки спайка M0.
     *
     * Значит `sections` обязателен для всех, и агент без предметных листов
     * возвращает пустой массив. Оболочка обязана это принять, а не считать
     * поломкой.
     */
    const { operation } = агент(
      ответ({ verdict: "🟢", findings: [ЗАМЕЧАНИЕ], openQuestions: [], options: [] }),
    );

    const { body } = await operation.run(ВХОД);

    expect(body.sections).toEqual([]);
  });

  it("каркас роли уходит в промпт, а состав листов оставлен объекту", async () => {
    const { operation, runAgent } = агент(
      ответ({ verdict: "🟢", findings: [ЗАМЕЧАНИЕ], openQuestions: [], options: [] }),
      {
        requiredSections: [
          { id: "convergence", title: "Сходимость", why: "§12.1б требует расхождения 0 ₽" },
        ],
      },
    );

    await operation.run(ВХОД);

    const prompt = runAgent.mock.calls[0]?.[0]?.prompt ?? "";

    // Обязательное названо и объяснено: требование без причины обходят.
    expect(prompt).toContain("convergence");
    expect(prompt).toContain("§12.1б требует расхождения 0 ₽");
    // А состав предметных листов агент выбирает сам — и предупреждён, чем
    // опасен лист без предмета.
    expect(prompt).toContain("ЛИСТЫ ВЫБИРАЕШЬ ТЫ, ПО ЭТОМУ ОБЪЕКТУ");
    expect(prompt).toContain("НЕ ЗАВОДИ");
  });

  it("без каркаса роли промпт не требует обязательных листов", async () => {
    const { operation, runAgent } = агент(
      ответ({ verdict: "🟢", findings: [ЗАМЕЧАНИЕ], openQuestions: [], options: [] }),
    );

    await operation.run(ВХОД);

    expect(runAgent.mock.calls[0]?.[0]?.prompt ?? "").not.toContain("ОБЯЗАТЕЛЬНЫ ПРИ ЛЮБОМ ОБЪЕКТЕ");
  });
});
