/**
 * Тесты написаны до реализации по M2 роадмапа и ADR-R-002/R-003.
 *
 * Источник правды — легаси-протокол
 * `reference-system/skills/stroiintellect-master/.../references/workflow.md`,
 * раздел «Критические правила протокола (нарушение = системная ошибка)».
 *
 * Проверяется главное отличие от оригинала: там правило — строка в таблице,
 * которую читает человек и может молча нарушить; здесь оно блокирует запуск.
 */
import { describe, expect, it } from "vitest";

import { CRITICAL_RULES, runProtocol, startable } from "./protocol.js";
import type { ProtocolPorts, StageDefinition, SubjectState } from "./protocol.js";

/** Такты курганского протокола в сокращении, достаточном для проверок. */
const STAGES: readonly StageDefinition[] = [
  {
    id: "такт-0",
    name: "Приём",
    steps: [{ agent: "настенька", produces: ["паспорт", "реестр-поручений"], requires: [] }],
  },
  {
    id: "такт-1",
    name: "Инженерный и сметный вход",
    steps: [
      { agent: "денчик", produces: ["вор-геометрия"], requires: [] },
      // Людмила НЕ параллельна Денчику: она принимает от него ВОР (ADR-R-002).
      { agent: "людмила", produces: ["вор"], requires: ["вор-геометрия:approved"] },
      { agent: "палыч", produces: ["чеклист-старта"], requires: [] },
      { agent: "виктор", produces: ["аудит-договора"], requires: [] },
    ],
  },
  {
    id: "такт-2",
    name: "Финансовая модель",
    steps: [{ agent: "ваныч", produces: ["финмодель", "потолки"], requires: ["вор:approved"] }],
  },
  {
    id: "такт-3",
    name: "Снабжение и подряд",
    steps: [
      { agent: "марина", produces: ["лид-тайм-карта"], requires: ["потолки:approved"] },
      { agent: "халиль", produces: ["скоринг"], requires: ["потолки:approved"] },
    ],
  },
];

function subjects(overrides: Record<string, SubjectState["status"]> = {}): Map<string, SubjectState> {
  const base: Record<string, SubjectState["status"]> = {
    "вор-геометрия": "approved",
    вор: "approved",
    потолки: "approved",
    ...overrides,
  };

  return new Map(
    Object.entries(base).map(([id, status]) => [id, { id, status, returnedCount: 0 }]),
  );
}

function ports(overrides: Partial<ProtocolPorts> = {}): ProtocolPorts {
  return {
    runStep: async (step) => ({
      agent: step.agent,
      produced: step.produces.map((subject) => ({ subject, status: "approved" as const })),
      handoffs: [],
    }),
    ...overrides,
  };
}

describe("критические правила протокола", () => {
  it("перенесены из легаси со своими последствиями, а не переписаны", () => {
    // Последствие — не украшение: оно объясняет, почему правило существует,
    // и попадает в сообщение об отказе.
    expect(CRITICAL_RULES.length).toBeGreaterThanOrEqual(6);

    for (const rule of CRITICAL_RULES) {
      expect(rule.statement).not.toBe("");
      expect(rule.consequence).not.toBe("");
      expect(rule.precondition).toMatch(/^[^:]+:[^:]+$/);
    }
  });

  it("хранит правило про финмодель на «воздухе» дословно по последствию", () => {
    const rule = CRITICAL_RULES.find((candidate) => candidate.blocks === "ваныч");

    expect(rule?.precondition).toBe("вор:approved");
    expect(rule?.consequence).toContain("Каранайауле");
  });
});

describe("допуск шага к запуску", () => {
  it("пускает шаг, когда все предметы подтверждены", () => {
    const step = { agent: "ваныч", produces: ["финмодель"], requires: ["вор:approved"] };

    expect(startable(step, subjects()).ok).toBe(true);
  });

  it("не пускает Ваныча при возвращённом ВОР и называет последствие", () => {
    // Реальный кейс Кургана: у Людмилы «Статус ВОР = 🔴 возвращён»,
    // Ванычу адресовано «БЕЗ моего "ОК по ВОР" финмодель НЕ считать».
    const step = { agent: "ваныч", produces: ["финмодель"], requires: ["вор:approved"] };
    const result = startable(step, subjects({ вор: "returned" }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blocks[0]?.subject).toBe("вор");
      expect(result.blocks[0]?.actual).toBe("returned");
      expect(result.blocks[0]?.consequence).toContain("воздухе");
    }
  });

  it("не пускает шаг, если предмета вовсе нет", () => {
    // Отсутствие предмета — не то же самое, что его чернового состояния.
    const step = { agent: "ваныч", produces: ["финмодель"], requires: ["вор:approved"] };
    const result = startable(step, new Map());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.blocks[0]?.actual).toBe("предмет отсутствует");
  });
});

describe("исполнение протокола", () => {
  it("проходит такты по порядку и отдаёт след каждого шага", async () => {
    const body = await runProtocol(STAGES, ports(), { subjects: new Map() });

    expect(body.stages.map((stage) => stage.id)).toEqual(["такт-0", "такт-1", "такт-2", "такт-3"]);
    expect(body.completed).toBe(true);

    const агенты = body.stages.flatMap((stage) => stage.steps.map((step) => step.agent));
    expect(агенты).toEqual([
      "настенька",
      "денчик",
      "людмила",
      "палыч",
      "виктор",
      "ваныч",
      "марина",
      "халиль",
    ]);
  });

  it("не запускает такт 2, пока ВОР возвращён на пересчёт", async () => {
    const body = await runProtocol(STAGES, ports({
      runStep: async (step) => ({
        agent: step.agent,
        produced: step.produces.map((subject) => ({
          // Людмила возвращает ВОР: объёмы не обоснованы.
          subject,
          status: subject === "вор" ? ("returned" as const) : ("approved" as const),
        })),
        handoffs: [],
      }),
    }), { subjects: new Map() });

    const такт2 = body.stages.find((stage) => stage.id === "такт-2");
    expect(такт2?.steps[0]?.status).toBe("заблокирован");
    expect(body.completed).toBe(false);
  });

  it("собственный возврат эскалирует сразу, без переигрывания", async () => {
    // ADR-R-002 ограничивает цикл двумя итерациями. Но здесь Людмила
    // возвращает СВОЙ продукт — это вердикт «посчитать не могу», а не отказ
    // от чужой работы. Переигрывать нечем: новых данных не появится.
    //
    // Настоящий цикл легаси — «Людмила возвращает ВОР ДЕНЧИКУ», то есть
    // отвергает ЧУЖОЙ продукт. Он моделируется отдельно (см. О-24).
    let attempts = 0;

    const body = await runProtocol(
      STAGES,
      ports({
        runStep: async (step) => {
          if (step.agent === "людмила") attempts += 1;
          return {
            agent: step.agent,
            produced: step.produces.map((subject) => ({
              subject,
              status: subject === "вор" ? ("returned" as const) : ("approved" as const),
            })),
            handoffs: [],
          };
        },
      }),
      { subjects: new Map(), maxRework: 2 },
    );

    expect(attempts).toBe(1);
    expect(body.escalations).toHaveLength(1);
    expect(body.escalations[0]?.subject).toBe("вор");
    expect(body.escalations[0]?.reason).toContain("САМ АВТОРОМ");
  });

  it("собирает передачи смежникам в порядке их появления", async () => {
    const body = await runProtocol(
      STAGES,
      ports({
        runStep: async (step) => ({
          agent: step.agent,
          produced: step.produces.map((subject) => ({ subject, status: "approved" as const })),
          handoffs:
            step.agent === "денчик"
              ? [{ from: "денчик", to: "людмила", subject: "вор-геометрия", payload: "ВОР с геометрическим обоснованием", priority: "critical" as const }]
              : [],
        }),
      }),
      { subjects: new Map() },
    );

    expect(body.handoffs).toHaveLength(1);
    expect(body.handoffs[0]?.to).toBe("людмила");
  });

  it("не выдаёт частичный прогон за полный", async () => {
    // ADR-R-022: подмена класса полноты запрещена. Прогон, где такт
    // заблокирован, не имеет права нести сводный вывод §5.3.
    const body = await runProtocol(STAGES, ports({
      runStep: async (step) => ({
        agent: step.agent,
        produced: step.produces.map((subject) => ({
          subject,
          status: subject === "вор" ? ("returned" as const) : ("approved" as const),
        })),
        handoffs: [],
      }),
    }), { subjects: new Map() });

    expect(body.completed).toBe(false);
    expect(body.blockedSteps).toBeGreaterThan(0);
  });
});

describe("каскад блокировок", () => {
  it("шаг, который не стартовал, ничего не произвёл — и его потребители тоже стоят", async () => {
    // Дефект, найденный на реальном выводе: такты 3 и 4 показывались
    // проходимыми при заблокированном такте 2. Это воспроизводило ровно ту
    // ошибку, ради которой написано правило «Марина без потолков от Ваныча».
    const body = await runProtocol(
      STAGES,
      ports({
        runStep: async (step) => ({
          agent: step.agent,
          produced: step.produces.map((subject) => ({
            subject,
            status: subject === "вор" ? ("returned" as const) : ("approved" as const),
          })),
          handoffs: [],
        }),
      }),
      { subjects: new Map() },
    );

    const заблокированные = body.stages
      .flatMap((stage) => stage.steps)
      .filter((step) => step.status === "заблокирован")
      .map((step) => step.agent);

    // Ваныч — из-за ВОР; Марина и Халиль — потому что Ваныч не создал потолки.
    expect(заблокированные).toEqual(["ваныч", "марина", "халиль"]);
  });

  it("называет отсутствие предмета отсутствием, а не черновиком", async () => {
    // «Предмета нет» и «предмет в черновике» — разные состояния, и путать их
    // нельзя: во втором случае есть что дорабатывать, в первом работа не начата.
    const body = await runProtocol(
      STAGES,
      ports({
        runStep: async (step) => ({
          agent: step.agent,
          produced: step.produces.map((subject) => ({
            subject,
            status: subject === "вор" ? ("returned" as const) : ("approved" as const),
          })),
          handoffs: [],
        }),
      }),
      { subjects: new Map() },
    );

    const марина = body.stages
      .flatMap((stage) => stage.steps)
      .find((step) => step.agent === "марина");

    expect(марина?.blocks?.[0]?.actual).toBe("предмет отсутствует");
    expect(марина?.blocks?.[0]?.consequence).toContain("кассовый разрыв");
  });
});

describe("шаг без реализации", () => {
  it("не изображает исполнение, а объявляется нереализованным", async () => {
    // Восемь агентов из девяти ещё не написаны. Считать их шаги пройденными —
    // это молчаливая деградация: протокол отчитался бы полным на одной девятой
    // работы. Запрещено инвариантом ТЗ §9.
    const body = await runProtocol(
      STAGES,
      ports({
        // Порт возвращает undefined для агента, которого нет.
        runStep: async (step) =>
          step.agent === "людмила"
            ? {
                agent: step.agent,
                produced: step.produces.map((subject) => ({ subject, status: "approved" as const })),
                handoffs: [],
              }
            : undefined,
      }),
      { subjects: new Map() },
    );

    const денчик = body.stages
      .flatMap((stage) => stage.steps)
      .find((step) => step.agent === "денчик");

    expect(денчик?.status).toBe("не реализован");
    expect(body.completed).toBe(false);
  });

  it("считает нереализованные шаги отдельно от заблокированных", async () => {
    // Разные вещи: заблокированный шаг не имел ПРАВА стартовать,
    // нереализованный — не имел ЧЕМ. Смешать их значит спрятать объём работы.
    const body = await runProtocol(
      STAGES,
      ports({ runStep: async () => undefined }),
      { subjects: new Map() },
    );

    expect(body.unimplementedSteps).toBeGreaterThan(0);
    expect(body.blockedSteps).toBeGreaterThan(0);
  });

  it("нереализованный шаг не создаёт предметов, и потребители встают", async () => {
    const body = await runProtocol(
      STAGES,
      ports({
        runStep: async (step) =>
          step.agent === "денчик"
            ? undefined
            : {
                agent: step.agent,
                produced: step.produces.map((subject) => ({ subject, status: "approved" as const })),
                handoffs: [],
              },
      }),
      { subjects: new Map() },
    );

    const людмила = body.stages
      .flatMap((stage) => stage.steps)
      .find((step) => step.agent === "людмила");

    // Денчик не выдал вор-геометрию — Людмила не имеет права стартовать.
    expect(людмила?.status).toBe("заблокирован");
    expect(людмила?.blocks?.[0]?.consequence).toContain("30–40%");
  });
});

describe("продолжение прерванного прогона", () => {
  it("не исполняет заново то, что уже исполнено", async () => {
    // §5.6: рестарт «без повторной загрузки». Если исполненный шаг делается
    // снова, перезапуск стоит столько же, сколько прогон с нуля.
    const исполнено: string[] = [];

    const body = await runProtocol(
      STAGES,
      ports({
        runStep: async (step) => {
          исполнено.push(step.agent);
          return {
            agent: step.agent,
            produced: step.produces.map((subject) => ({ subject, status: "approved" as const })),
            handoffs: [],
          };
        },
      }),
      {
        subjects: new Map([
          ["паспорт", { id: "паспорт", status: "approved", returnedCount: 0 }],
          ["вор-геометрия", { id: "вор-геометрия", status: "approved", returnedCount: 0 }],
        ]),
        completedSteps: ["такт-0/настенька", "такт-1/денчик"],
      },
    );

    expect(исполнено).not.toContain("настенька");
    expect(исполнено).not.toContain("денчик");
    expect(исполнено).toContain("людмила");
  });

  it("продолженный шаг помечен продолженным, а не исполненным заново", async () => {
    // Отчёт обязан отличать «сделано сейчас» от «было сделано раньше»:
    // иначе по нему не понять, что именно дал этот запуск.
    const body = await runProtocol(STAGES, ports(), {
      subjects: new Map([["паспорт", { id: "паспорт", status: "approved", returnedCount: 0 }]]),
      completedSteps: ["такт-0/настенька"],
    });

    const настенька = body.stages
      .flatMap((stage) => stage.steps)
      .find((step) => step.agent === "настенька");

    expect(настенька?.status).toBe("уже исполнен");
  });

  it("продолжение с исполненными шагами даёт тот же исход, что непрерывный прогон", async () => {
    // Главное утверждение §5.6. Пока оно не сведено к сравнению, «переживает
    // рестарт» — обещание.
    const непрерывный = await runProtocol(STAGES, ports(), { subjects: new Map() });

    const продолженный = await runProtocol(STAGES, ports(), {
      subjects: new Map(
        непрерывный.subjects
          .filter((subject) => ["паспорт", "реестр-поручений", "вор-геометрия"].includes(subject.id))
          .map((subject) => [subject.id, subject]),
      ),
      completedSteps: ["такт-0/настенька", "такт-1/денчик"],
    });

    expect(продолженный.completed).toBe(непрерывный.completed);
    expect(продолженный.blockedSteps).toBe(непрерывный.blockedSteps);

    const итог = (body: typeof непрерывный) =>
      [...body.subjects].map((s) => `${s.id}=${s.status}`).sort();

    expect(итог(продолженный)).toEqual(итог(непрерывный));
  });
});

describe("собственный возврат — вердикт, а не повод переигрывать", () => {
  it("не переигрывает шаг, который сам объявил свой продукт возвращённым", async () => {
    // Денчик, вернувший вор-геометрию, сказал «обосновать нечем». Новых
    // данных у него не появится, и три одинаковых прогона подряд — это
    // потраченное время с тем же исходом.
    //
    // Возврат ОТ ДРУГОГО агента — другое дело: там появилась обратная связь,
    // и пересчёт осмыслен. Легаси описывает именно такой случай: «Людмила
    // принимает ВОР от Денчика» и возвращает его на пересчёт.
    let попыток = 0;

    const body = await runProtocol(
      STAGES,
      ports({
        runStep: async (step) => {
          if (step.agent === "денчик") попыток += 1;
          return {
            agent: step.agent,
            produced: step.produces.map((subject) => ({
              subject,
              status: subject === "вор-геометрия" ? ("returned" as const) : ("approved" as const),
            })),
            handoffs: [],
          };
        },
      }),
      { subjects: new Map(), maxRework: 2 },
    );

    expect(попыток).toBe(1);
    expect(body.escalations.map((escalation) => escalation.subject)).toContain("вор-геометрия");
  });

  it("эскалирует сразу, называя причину собственным вердиктом автора", async () => {
    const body = await runProtocol(
      STAGES,
      ports({
        runStep: async (step) => ({
          agent: step.agent,
          produced: step.produces.map((subject) => ({
            subject,
            status: subject === "вор-геометрия" ? ("returned" as const) : ("approved" as const),
          })),
          handoffs: [],
        }),
      }),
      { subjects: new Map(), maxRework: 2 },
    );

    const эскалация = body.escalations.find((item) => item.subject === "вор-геометрия");

    expect(эскалация?.reason).toContain("САМ АВТОРОМ");
  });
});

describe("возврат чужого продукта — настоящий цикл ADR-R-002", () => {
  /** Людмила принимает ВОР от Денчика и возвращает ЕГО на пересчёт. */
  const людмилаВозвращает = (сколькоРаз: number) => {
    let денчик = 0;
    let людмила = 0;

    return {
      счётчики: () => ({ денчик, людмила }),
      ports: ports({
        runStep: async (step) => {
          if (step.agent === "денчик") {
            денчик += 1;
            return {
              agent: step.agent,
              produced: [{ subject: "вор-геометрия", status: "approved" as const }],
              handoffs: [],
            };
          }

          if (step.agent === "людмила") {
            людмила += 1;
            return {
              agent: step.agent,
              produced: [{ subject: "вор", status: "approved" as const }],
              // Отвергает ЧУЖОЙ предмет: это и есть возврат легаси.
              returned:
                людмила <= сколькоРаз
                  ? [{ subject: "вор-геометрия", reason: "объёмы не обоснованы геометрией" }]
                  : [],
              handoffs: [],
            };
          }

          return {
            agent: step.agent,
            produced: step.produces.map((subject) => ({ subject, status: "approved" as const })),
            handoffs: [],
          };
        },
      }),
    };
  };

  it("возвращает предмет автору и переигрывает ЕГО шаг, а не свой", async () => {
    const сцена = людмилаВозвращает(1);
    await runProtocol(STAGES, сцена.ports, { subjects: new Map(), maxRework: 2 });

    const { денчик, людмила } = сцена.счётчики();

    // Денчик пересчитал один раз по возврату; Людмила прошла дважды —
    // первый раз вернула, второй приняла.
    expect(денчик).toBe(2);
    expect(людмила).toBe(2);
  });

  it("доводит до конца, когда автор исправился", async () => {
    const сцена = людмилаВозвращает(1);
    const body = await runProtocol(STAGES, сцена.ports, { subjects: new Map(), maxRework: 2 });

    expect(body.completed).toBe(true);
    expect(body.escalations).toEqual([]);
  });

  it("ограничивает цикл и эскалирует, когда возвраты не кончаются", async () => {
    // ADR-R-002: «Цикл ограничен двумя итерациями, дальше — эскалация
    // человеку». Бесконечное согласование двух агентов — способ не выпустить
    // объект никогда.
    const сцена = людмилаВозвращает(99);
    const body = await runProtocol(STAGES, сцена.ports, { subjects: new Map(), maxRework: 2 });

    const { денчик } = сцена.счётчики();

    expect(денчик).toBe(3); // первичный прогон и два пересчёта
    expect(body.escalations).toHaveLength(1);
    expect(body.escalations[0]?.subject).toBe("вор-геометрия");
    expect(body.escalations[0]?.reason).toContain("2");
  });

  it("называет, КТО вернул предмет: без этого непонятно, с кем говорить", async () => {
    const сцена = людмилаВозвращает(99);
    const body = await runProtocol(STAGES, сцена.ports, { subjects: new Map(), maxRework: 2 });

    expect(body.escalations[0]?.returnedBy).toBe("людмила");
    expect(body.escalations[0]?.agent).toBe("денчик");
  });
});
