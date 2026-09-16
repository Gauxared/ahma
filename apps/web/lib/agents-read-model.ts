/**
 * Доска агентов — то, на чём держатся все три прототипа заказчика.
 *
 * ЧТО ЗДЕСЬ СОЕДИНЯЕТСЯ
 *
 * Три источника, каждый из которых знает свою часть и не знает остальных:
 *
 *  · **артефакт прогона** — кто что сказал: `capability`, вердикт, замечания с
 *    основаниями (`check-read-model.ts`, разрез `agents`);
 *  · **реестр агентов** — кто это: имя, роль, охват, место в конвейере
 *    (`platform/config/agent-roster.ts`);
 *  · **воркфлоу** — порядок и предусловия: такты 0–4, что шаг производит и чего
 *    ждёт (`config/workflows/full-check.json`).
 *
 * Соединяются они так: воркфлоу называет агента ИМЕНЕМ («денчик»), реестр знает
 * имя и способность, артефакт знает способность. Стык по имени, приведённому к
 * нижнему регистру, — единственный, и он проверен: все девять агентов
 * воркфлоу находятся в реестре.
 *
 * ПОЧЕМУ ПРЕДУСЛОВИЕ ПЕРЕВОДИТСЯ В СЛОВА
 *
 * В воркфлоу оно записано как `вор-геометрия:approved` — это точно, но человеку
 * не говорит ничего. Здесь оно превращается в «ждёт ВОР-геометрию от Денчика»:
 * предмет находится в `produces` другого шага, и по нему опознаётся автор.
 * Порядок в конвейере — главное, чего не хватало интерфейсу: без него девять
 * агентов выглядели девятью независимыми проверками, а они цепочка.
 *
 * ЧЕГО ЗДЕСЬ НЕТ
 *
 * Рублёвого эффекта у замечания. В прототипах он есть у каждой находки, и это
 * правильная цель, — но `impact` в контракте агента не типизирован, а основание
 * агент возвращает прозой. Приделать провенанс к тексту значило бы изобразить
 * расчёт, которого не было (`Ф-ADR-006`).
 */
import { loadWorkflows } from "@platform/config/workflow-loader";

import { agentRoster } from "./agent-roles.js";
import {
  countBySeverity,
  readCheck,
  viewVerdict,
  type AgentRunRow,
  type AgentVerdictView,
  type OpenQuestionView,
  type ReviewAgentView,
  type ReviewFindingView,
} from "./check-read-model.js";

/**
 * Состояние агента в прогоне.
 *
 * Три вида, и различать их обязательно: «замечаний нет» и «агент не работал» —
 * противоположные утверждения, а «отказался» — третье, и оно тревожнее обоих.
 */
export type AgentState =
  | { readonly kind: "высказался" }
  | { readonly kind: "отказ"; readonly errors: readonly string[] }
  /**
   * Агент работает прямо сейчас.
   *
   * Четвёртое состояние, и оно появилось вместе с Д2. До него «работает» и «не
   * запускался» выглядели одинаково — «не высказался», — и на двадцатой минуте
   * прогона доска сообщала «высказалось 0 из 9» про девять работающих агентов.
   * Правда, из которой следует неверный вывод: клиент читает это как «система
   * стоит».
   */
  | { readonly kind: "работает"; readonly since: Date | null }
  | { readonly kind: "не-запускался"; readonly reason: string };

export interface AgentPrecondition {
  /** Предмет, которого агент ждёт: `вор-геометрия`. */
  readonly subject: string;
  /** Требуемое состояние предмета: `approved`. */
  readonly status: string;
  /** Кто его производит — если такой шаг в воркфлоу есть. */
  readonly from: string | undefined;
}

export interface AgentCard {
  readonly capability: string;
  /** Имя: им подписаны замечания в протоколах заказчика. */
  readonly person: string;
  readonly role: string;
  /** Охват: документ, объект или синтез. Объясняет, почему предметов один или четыре. */
  readonly scope: string | undefined;
  /** Такт конвейера, в котором агент работает. */
  readonly tact: string | undefined;
  readonly produces: readonly string[];
  readonly requires: readonly AgentPrecondition[];
  readonly state: AgentState;
  /** Вердикты агента — по одному на предмет, со светофором как состоянием. */
  readonly verdicts: readonly AgentVerdictView[];
  readonly subjects: readonly string[];
  readonly findings: readonly ReviewFindingView[];
  readonly bySeverity: readonly (readonly [string, number])[];
  /**
   * Что агент просит проверить человеку — восьмая графа формы результата (Д3).
   *
   * Не замечание и не его часть: у поручения владелец и срок, а у замечания
   * важность и координата. Смешать их значило бы получить список, по которому
   * нельзя ни спорить, ни поручать.
   */
  readonly openQuestions: readonly OpenQuestionView[];
  /**
   * Замечания взяты из ХОДА прогона, а не из его артефакта.
   *
   * Помечается словом на экране и не сливается с итоговым: замечание, которое
   * ещё может измениться вместе с переигранной попыткой агента, и замечание из
   * канонического результата — разной прочности, и смешивать их значит
   * обесценить второе.
   */
  readonly preliminary: boolean;
}

export interface TactCard {
  readonly id: string;
  readonly name: string;
  readonly agents: readonly AgentCard[];
}

/** Критичное замечание с автором — «что убьёт проект» из прототипов. */
export interface CriticalFinding {
  readonly capability: string;
  readonly person: string;
  readonly role: string;
  readonly tact: string | undefined;
  readonly finding: ReviewFindingView;
}

export interface AgentsBoard {
  readonly objectCode: string;
  readonly objectName: string;
  readonly checkId: string;
  readonly workflowId: string;
  readonly finishedAt: Date | null;
  /** Прогон ещё не кончился: доска обновляется сама, пока это так. */
  readonly live: boolean;
  /** Быстрый проход: воркфлоу зовёт не всех агентов реестра. */
  readonly fast: boolean;
  /** Кого не зовёт. Их молчание значит «не звали», а не «замечаний нет». */
  readonly notInvited: readonly string[];
  /** Чем прогон занят сейчас. Пусто у не начавшегося и у завершённого. */
  readonly phase: string | null;
  readonly documentsTotal: number | null;
  readonly documentsDone: number | null;
  readonly tacts: readonly TactCard[];
  /** Агенты, которых нет в тактах этого воркфлоу, но которые высказались. */
  readonly offPipeline: readonly AgentCard[];
  readonly critical: readonly CriticalFinding[];
  readonly spoke: number;
  /** Агентов работает прямо сейчас. Ноль у завершённого прогона. */
  readonly working: number;
  readonly total: number;
  readonly findings: number;
  /** Хотя бы у одного агента замечания взяты из хода прогона, а не из артефакта. */
  readonly preliminary: boolean;
  /** Воркфлоу не найден: такты показать нечем, и это говорится прямо. */
  readonly workflowMissing: boolean;
}

/** Важность, которую считаем критичной. Одно место, а не литерал по экранам. */
const CRITICAL = "critical";

function precondition(raw: string, producers: ReadonlyMap<string, string>): AgentPrecondition {
  const [subject = raw, status = ""] = raw.split(":");
  return { subject, status, from: producers.get(subject) };
}

function stateOf(
  review: ReviewAgentView | undefined,
  running: RunningAgent | undefined,
  notInvited: boolean,
): AgentState {
  // РАБОТАЕТ — ПЕРВЫМ, потому что это единственное состояние, которое меняется
  // само. Агент, начавший вторую смету после первой, и «высказался», и
  // «работает»; сказать о нём «высказался» значило бы объявить работу
  // законченной за минуту до того, как она закончилась.
  if (running !== undefined) return { kind: "работает", since: running.since };

  if (review === undefined) {
    return {
      kind: "не-запускался",
      // Причина НАЗЫВАЕТСЯ точно, когда она известна. «Не звали» и «не дошло» —
      // разные вещи: первое решил воркфлоу, второе решил ход прогона, и
      // одинаковая формулировка на обоих заставляла бы читателя гадать.
      reason: notInvited
        ? "воркфлоу этой Проверки его не зовёт: это быстрый проход, а не полный прогон"
        : "в этом прогоне агент не высказался: его либо не запускали, либо прогон до него не дошёл",
    };
  }

  // Отказ проверяется ПЕРЕД «высказался»: агент с отказом и без замечаний иначе
  // выглядел бы как агент, который отработал и ничего не нашёл.
  if (review.errors.length > 0) return { kind: "отказ", errors: review.errors };

  return { kind: "высказался" };
}

interface RunningAgent {
  readonly since: Date | null;
}

/**
 * Ход прогона, приведённый к тому же виду, что обзор из артефакта.
 *
 * ЗАЧЕМ ПРИВОДИТЬ, А НЕ ЗАВОДИТЬ ВТОРОЙ ПУТЬ. Доска умеет показывать
 * `ReviewAgentView` — с замечаниями, важностями, вердиктом и отказом. Второе
 * представление того же самого разошлось бы с первым на первой правке, и
 * разошлось бы там, где сравнить их некому: на экране, который смотрят раз в
 * тридцать минут.
 *
 * Строки одного агента по разным сметам СКЛЕИВАЮТСЯ — ровно так же, как их
 * склеивает `groupByAgent` в артефакте.
 */
function fromRuns(runs: readonly AgentRunRow[]): {
  readonly reviews: ReadonlyMap<string, ReviewAgentView>;
  readonly running: ReadonlyMap<string, RunningAgent>;
} {
  const reviews = new Map<string, ReviewAgentView>();
  const running = new Map<string, RunningAgent>();

  for (const run of runs) {
    if (run.status === "выполняется") {
      const known = running.get(run.capability);
      // Самое раннее начало: агент на четырёх сметах работает с первой из них,
      // и «работает с 14:31» при начале в 14:12 занижало бы длительность.
      const since =
        known?.since === null || known === undefined
          ? run.startedAt
          : run.startedAt !== null && run.startedAt < known.since
            ? run.startedAt
            : known.since;

      running.set(run.capability, { since });
      continue;
    }

    const bucket = reviews.get(run.capability);
    const subject = run.subject.split("/").pop() ?? "";
    // Тот же разбор, что у артефакта: светофор становится состоянием, а
    // вердикт подписывается предметом. Второй разбор того же поля разошёлся бы
    // с первым, и на ходе прогона знак остался бы внутри абзаца.
    const verdict = viewVerdict(run.scope === "объект" ? "" : subject, run.verdict ?? "");

    if (bucket === undefined) {
      reviews.set(run.capability, {
        capability: run.capability,
        verdicts: verdict === undefined ? [] : [verdict],
        subjects: subject === "" ? [] : [subject],
        findings: run.findings,
        bySeverity: run.bySeverity,
        errors: run.error === null ? [] : [run.error],
        openQuestions: run.openQuestions,
        // Ход прогона предметных листов не показывает: они приезжают книгой
        // пакета. Пустой список честнее выдуманного.
        sheets: [],
      });
      continue;
    }

    const findings = [...bucket.findings, ...run.findings];

    reviews.set(run.capability, {
      capability: run.capability,
      verdicts:
        verdict === undefined || bucket.verdicts.some((known) => known.text === verdict.text)
          ? bucket.verdicts
          : [...bucket.verdicts, verdict],
      subjects: subject === "" || bucket.subjects.includes(subject) ? bucket.subjects : [...bucket.subjects, subject],
      findings,
      bySeverity: countBySeverity(findings),
      errors: run.error === null || bucket.errors.includes(run.error) ? bucket.errors : [...bucket.errors, run.error],
      // Один и тот же вопрос по четырём сметам агент задаёт четыре раза; в
      // реестре поручений он один. Склейка по тексту и владельцу — та же, что
      // в разборе артефакта.
      openQuestions: [
        ...bucket.openQuestions,
        ...run.openQuestions.filter(
          (question) =>
            !bucket.openQuestions.some(
              (known) => known.question === question.question && known.owner === question.owner,
            ),
        ),
      ],
      sheets: bucket.sheets,
    });
  }

  return { reviews, running };
}

export async function readAgentsBoard(
  tenant: string,
  objectCode: string,
  checkId: string,
): Promise<AgentsBoard | undefined> {
  const card = await readCheck(tenant, objectCode, checkId);
  if (card === undefined) return undefined;

  const roster = agentRoster();
  const workflow = loadWorkflows("config/workflows").find((bundle) => bundle.value.id === card.workflowId);

  // Обзор по агентам: первый артефакт с обзором главнее — они отсортированы по
  // времени, свежий сверху.
  const reviews = new Map<string, ReviewAgentView>();

  for (const artifact of card.artifacts) {
    if (artifact.review === null) continue;
    for (const agent of artifact.review.agents) {
      if (!reviews.has(agent.capability)) reviews.set(agent.capability, agent);
    }
  }

  /**
   * ХОД ПРОГОНА ДОПОЛНЯЕТ АРТЕФАКТ, А НЕ ЗАМЕНЯЕТ ЕГО.
   *
   * Артефакт главнее там, где он есть: это канонический результат, и его
   * замечания прошли сборку тела. Ход прогона отвечает за агентов, до которых
   * артефакт ещё не дошёл, — то есть за всё, что видно на двадцатой минуте
   * тридцатишестиминутного прогона.
   *
   * Порядок именно такой, а не обратный: свежесть здесь не главное. Строка хода
   * относится к попытке, которая может быть переиграна; артефакт — к
   * состоявшемуся результату.
   */
  const live = fromRuns(card.runs);
  const preliminary = new Set<string>();

  for (const [capability, view] of live.reviews) {
    if (reviews.has(capability)) continue;
    reviews.set(capability, view);
    preliminary.add(capability);
  }

  /** Имя → способность. Стык воркфлоу с реестром. */
  const byPerson = new Map<string, string>();
  for (const identity of roster.values()) {
    byPerson.set(identity.person.toLowerCase(), identity.capability);
  }

  /** Предмет → кто его производит. Нужен, чтобы назвать предусловие словами. */
  const producers = new Map<string, string>();
  for (const stage of workflow?.value.stages ?? []) {
    for (const step of stage.steps) {
      const capability = byPerson.get(step.agent.toLowerCase());
      const identity = capability === undefined ? undefined : roster.get(capability);
      for (const subject of step.produces) {
        producers.set(subject, identity?.person ?? step.agent);
      }
    }
  }

  const used = new Set<string>();
  /** Кого этот воркфлоу не зовёт — из той же read-модели, что у экрана Проверки. */
  const notInvited = new Set(card.notInvited);

  const tacts: TactCard[] = (workflow?.value.stages ?? []).map((stage) => ({
    id: stage.id,
    name: stage.name,
    agents: stage.steps.map((step) => {
      const capability = byPerson.get(step.agent.toLowerCase());
      const identity = capability === undefined ? undefined : roster.get(capability);
      const review = capability === undefined ? undefined : reviews.get(capability);

      if (capability !== undefined) used.add(capability);

      return {
        // Способности может не быть, если воркфлоу называет агента, которого нет
        // в реестре. Молча пропустить его нельзя: шаг в конвейере есть, и
        // экран обязан показать шаг, а не сделать вид, что такта короче.
        capability: capability ?? step.agent,
        person: identity?.person ?? step.agent,
        role: identity?.role ?? "роль не объявлена в реестре",
        scope: identity?.scope,
        tact: stage.id,
        produces: step.produces,
        requires: step.requires.map((raw) => precondition(raw, producers)),
        state: stateOf(
          review,
          capability === undefined ? undefined : live.running.get(capability),
          capability !== undefined && notInvited.has(capability),
        ),
        verdicts: review?.verdicts ?? [],
        subjects: review?.subjects ?? [],
        findings: review?.findings ?? [],
        bySeverity: review?.bySeverity ?? [],
        openQuestions: review?.openQuestions ?? [],
        preliminary: capability !== undefined && preliminary.has(capability),
      };
    }),
  }));

  /**
   * Агенты вне тактов.
   *
   * Прогон мог быть запущен операцией напрямую (`check-object`), и тогда такты
   * не заданы вовсе, а высказавшиеся агенты есть. Показать их надо: иначе экран
   * сообщит «агенты не работали» там, где они дали сотню замечаний.
   */
  const offPipeline: AgentCard[] = [
    // Работающий агент вне тактов попадает сюда наравне с высказавшимся: он
    // ЕСТЬ, и «его не показали» читалось бы как «он не работал».
    ...new Set([...reviews.keys(), ...live.running.keys()]),
  ]
    .filter((capability) => !used.has(capability))
    .map((capability) => {
      const identity = roster.get(capability);
      const review = reviews.get(capability);

      return {
        capability,
        person: identity?.person ?? capability,
        role: identity?.role ?? "роль не объявлена в реестре",
        scope: identity?.scope,
        tact: undefined,
        produces: [],
        requires: [],
        state: stateOf(review, live.running.get(capability), notInvited.has(capability)),
        verdicts: review?.verdicts ?? [],
        subjects: review?.subjects ?? [],
        findings: review?.findings ?? [],
        bySeverity: review?.bySeverity ?? [],
        openQuestions: review?.openQuestions ?? [],
        preliminary: preliminary.has(capability),
      };
    })
    .sort((left, right) => (roster.get(left.capability)?.order ?? 99) - (roster.get(right.capability)?.order ?? 99));

  const all = [...tacts.flatMap((tact) => tact.agents), ...offPipeline];

  const critical: CriticalFinding[] = all.flatMap((agent) =>
    agent.findings
      .filter((finding) => finding.severity === CRITICAL)
      .map((finding) => ({
        capability: agent.capability,
        person: agent.person,
        role: agent.role,
        tact: agent.tact,
        finding,
      })),
  );

  return {
    objectCode: card.objectCode,
    objectName: card.objectName,
    checkId: card.id,
    workflowId: card.workflowId,
    finishedAt: card.finishedAt,
    live: card.live,
    fast: card.fast,
    notInvited: card.notInvited,
    phase: card.phase,
    documentsTotal: card.documentsTotal,
    documentsDone: card.documentsDone,
    tacts,
    offPipeline,
    critical,
    // ВЫСКАЗАЛСЯ — ЭТО НЕ «НЕ БЕЗДЕЛЬНИЧАЕТ». Работающий агент считался бы
    // высказавшимся при `!== "не-запускался"`, и «высказалось 9 из 9» стояло бы
    // на экране, пока девять агентов ещё думают.
    spoke: all.filter((agent) => agent.state.kind === "высказался" || agent.state.kind === "отказ").length,
    working: all.filter((agent) => agent.state.kind === "работает").length,
    total: all.length,
    // Считается по агентам, а не суммой по артефактам: с ходом прогона
    // замечание может приехать и из хода, и из артефакта, и сумма посчитала бы
    // его дважды.
    findings: all.reduce((sum, agent) => sum + agent.findings.length, 0),
    preliminary: all.some((agent) => agent.preliminary),
    workflowMissing: workflow === undefined,
  };
}

/** Один агент по способности — для экрана его замечаний. */
export function agentOf(board: AgentsBoard, capability: string): AgentCard | undefined {
  return [...board.tacts.flatMap((tact) => tact.agents), ...board.offPipeline].find(
    (agent) => agent.capability === capability,
  );
}
