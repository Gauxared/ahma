/**
 * Какие агенты работают в этом прогоне — по ВОРКФЛОУ, а не по коду.
 *
 * ЧТО ЭТО ЗАКРЫВАЕТ (веха Д2 плана демо, «быстрый проход»)
 *
 * Воркфлоу два — `full-check` на девять агентов и `estimate-only` на одного, —
 * и до сих пор они давали ОДИН И ТОТ ЖЕ результат: исполнитель строил всех
 * агентов, каких умел, независимо от того, кого объявил воркфлоу. То есть
 * второй воркфлоу существовал как данные и не существовал как поведение;
 * утверждение «воркфлоу — это данные, а не код» держалось на одном порядке
 * тактов.
 *
 * Здесь оно становится проверяемым: перечень агентов воркфлоу превращается в
 * перечень СПОСОБНОСТЕЙ, и исполнитель запускает только их. Быстрый проход —
 * это `estimate-only`, то есть объявленное сужение, а не отдельная ветка кода.
 *
 * СТЫК ИДЁТ ЧЕРЕЗ РЕЕСТР, И ДРУГОГО СТЫКА НЕТ
 *
 * Воркфлоу называет агента ИМЕНЕМ («людмила»), артефакт и порты — СПОСОБНОСТЬЮ
 * (`estimate_review`). Соответствие живёт в реестре агентов и только там:
 * таблица «имя → способность» в коде — ровно то, что запрещает `ADR-R-019`,
 * потому что расходится с манифестами молча.
 *
 * СБОЙ РАЗРЕШАЕТ ВСЁ, А НЕ ЗАПРЕЩАЕТ ВСЁ
 *
 * Это единственное место в проекте, где `fail closed` был бы хуже открытого
 * отказа. Нечитаемый реестр при закрытом поведении дал бы Проверку БЕЗ агентов
 * — то есть тихий вердикт по одной детерминированной части, выглядящий полным.
 * Поэтому при сбое сужение не применяется вовсе, и причина называется вслух:
 * лучше лишний агент с объяснением, чем девять пропавших молча.
 */
import { join } from "node:path";

import { loadAgentRoster, type AgentRoster } from "./agent-roster.js";
import { loadWorkflows } from "./workflow-loader.js";

export interface AllowedCapabilities {
  /** Способности, которые разрешает воркфлоу. Пусто при `narrowed: false`. */
  readonly allowed: ReadonlySet<string>;
  /** Сужать ли набор агентов. `false` — работают все, кого умеет исполнитель. */
  readonly narrowed: boolean;
  /** Почему сузили или почему не стали. Словами, для журнала и для артефакта. */
  readonly reason: string;
  /** Агенты воркфлоу, которых реестр не знает. Непусто — повод разобраться. */
  readonly unknownAgents: readonly string[];
  /**
   * Воркфлоу зовёт НЕ ВСЕХ агентов реестра — то есть это быстрый проход.
   *
   * Отдельно от `narrowed`, и разница существенна: `narrowed` отвечает «звать
   * ли по списку воркфлоу», а это — «короче ли список, чем весь реестр».
   * `full-check` даёт `narrowed: true` и `shorterThanRoster: false`: он зовёт
   * по списку, но список полный. Экран называет быстрым второе, а не первое.
   */
  readonly shorterThanRoster: boolean;
  /** Кого реестр знает, а этот воркфлоу не зовёт. Слова для экрана и артефакта. */
  readonly notInvited: readonly string[];
}

/**
 * Способности, разрешённые воркфлоу Проверки.
 *
 * `workflowsDir` и `agentsDir` — параметры, а не константы: тесты и командная
 * строка работают из разных рабочих каталогов, и жёсткий путь превратил бы
 * «конфигурация не найдена» в «агентов нет».
 */
/**
 * Имя человека из воркфлоу → способность агента.
 *
 * Воркфлоу называет шаги ИМЕНАМИ («настенька», «денчик»), ядро различает
 * агентов СПОСОБНОСТЯМИ (`object_passport`, `tech_opinion`). Отображение между
 * ними одно на систему: второе завелось бы тут же, как только доске тактов
 * понадобилось узнать, отработал ли шаг, — и разошлось бы с этим на первом
 * новом агенте.
 */
export function personToCapability(roster: AgentRoster): ReadonlyMap<string, string> {
  return new Map(roster.all().map((identity) => [identity.person.toLowerCase(), identity.capability]));
}

export function capabilitiesOfWorkflow(
  workflowId: string,
  directories: { readonly workflows?: string; readonly agents?: string } = {},
): AllowedCapabilities {
  const workflowsDir = directories.workflows ?? "config/workflows";
  const agentsDir = directories.agents ?? join(process.cwd(), "config", "agents");

  let workflow;
  let roster;

  try {
    workflow = loadWorkflows(workflowsDir).find((bundle) => bundle.value.id === workflowId);
    roster = loadAgentRoster(agentsDir).roster;
  } catch (cause) {
    return {
      allowed: new Set(),
      narrowed: false,
      reason: `конфигурация не прочитана (${(cause as Error).message}): набор агентов не сужаем`,
      unknownAgents: [],
      shorterThanRoster: false,
      notInvited: [],
    };
  }

  if (workflow === undefined) {
    return {
      allowed: new Set(),
      narrowed: false,
      reason: `воркфлоу «${workflowId}» в конфигурации не найден: набор агентов не сужаем`,
      unknownAgents: [],
      shorterThanRoster: false,
      notInvited: [],
    };
  }

  const byPerson = personToCapability(roster);

  const allowed = new Set<string>();
  const unknownAgents: string[] = [];

  for (const stage of workflow.value.stages) {
    for (const step of stage.steps) {
      const capability = byPerson.get(step.agent.toLowerCase());

      if (capability === undefined) {
        unknownAgents.push(step.agent);
        continue;
      }

      allowed.add(capability);
    }
  }

  // Ни одного узнанного агента — сужать нельзя: это не «воркфлоу без агентов»,
  // а рассогласование конфигураций, и Проверка без обзора его не объяснит.
  if (allowed.size === 0) {
    return {
      allowed,
      narrowed: false,
      reason:
        `ни один агент воркфлоу «${workflowId}» не найден в реестре ` +
        `(${unknownAgents.join(", ")}): набор агентов не сужаем`,
      unknownAgents,
      shorterThanRoster: false,
      notInvited: [],
    };
  }

  // Кого реестр знает, а воркфлоу не зовёт. Считается по РЕЕСТРУ, а не по
  // списку способностей в коде: второй перечень девяти агентов разошёлся бы с
  // манифестами на первом же новом агенте.
  const notInvited = roster
    .all()
    .map((identity) => identity.capability)
    .filter((capability) => !allowed.has(capability))
    .sort();

  return {
    allowed,
    narrowed: true,
    reason:
      notInvited.length === 0
        ? `воркфлоу «${workflow.value.name}» зовёт всех агентов реестра`
        : `воркфлоу «${workflow.value.name}» зовёт ${[...allowed].sort().join(", ")}; ` +
          `не зовёт ${notInvited.join(", ")}`,
    unknownAgents,
    shorterThanRoster: notInvited.length > 0,
    notInvited,
  };
}
