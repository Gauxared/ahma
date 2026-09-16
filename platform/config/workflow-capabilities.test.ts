/**
 * Состав агентов прогона — против НАСТОЯЩЕЙ конфигурации проекта.
 *
 * ПОЧЕМУ НЕ НА ВЫДУМАННЫХ ФАЙЛАХ. Проверяется здесь не алгоритм пересечения
 * двух списков — он на три строки, — а СОГЛАСОВАННОСТЬ двух конфигураций,
 * которые правят разные люди в разное время: воркфлоу в `config/workflows` и
 * манифесты агентов в `config/agents`. Набор на выдуманных каталогах остался бы
 * зелёным ровно в тот день, когда в воркфлоу переименуют агента.
 *
 * ГЛАВНОЕ УТВЕРЖДЕНИЕ — ПЕРВОЕ: `full-check` зовёт ВСЕХ агентов реестра.
 * С Д2 набор агентов сузился до объявленного воркфлоу, и если full-check
 * когда-нибудь перестанет называть кого-то из девяти, полный прогон молча
 * станет неполным. Этот набор — единственное, что стоит между таким днём и
 * вердиктом, выданным без Ваныча.
 */
import { describe, expect, it } from "vitest";

import { loadAgentRoster } from "./agent-roster.js";
import { capabilitiesOfWorkflow } from "./workflow-capabilities.js";

const AGENTS = "config/agents";
const WORKFLOWS = "config/workflows";

describe("состав агентов прогона", () => {
  it("full-check зовёт всех агентов реестра: полный прогон не сужается молча", () => {
    const { roster } = loadAgentRoster(AGENTS);
    const invited = capabilitiesOfWorkflow("full-check", { workflows: WORKFLOWS, agents: AGENTS });

    expect(invited.narrowed).toBe(true);
    expect(invited.unknownAgents).toEqual([]);
    // Ни одного не позванного — то есть сужение full-check ничего не отнимает.
    expect(invited.notInvited).toEqual([]);
    expect(invited.shorterThanRoster).toBe(false);
    expect([...invited.allowed].sort()).toEqual(roster.all().map((identity) => identity.capability).sort());
  });

  it("estimate-only — объявленное сужение, и оно называет кого не зовёт", () => {
    const { roster } = loadAgentRoster(AGENTS);
    const invited = capabilitiesOfWorkflow("estimate-only", { workflows: WORKFLOWS, agents: AGENTS });

    expect(invited.narrowed).toBe(true);
    expect(invited.shorterThanRoster).toBe(true);
    // Меньше, чем весь реестр, — иначе «быстрый проход» не быстрее полного.
    expect(invited.allowed.size).toBeLessThan(roster.all().length);
    expect(invited.notInvited.length).toBe(roster.all().length - invited.allowed.size);
    // Причина названа словами: её печатает воркер и показывает экран.
    expect(invited.reason).toContain("не зовёт");
  });

  it("неизвестный воркфлоу не сужает набор, а объясняет почему", () => {
    const invited = capabilitiesOfWorkflow("нет-такого", { workflows: WORKFLOWS, agents: AGENTS });

    // Сужение при незнании дало бы Проверку без агентов — молчаливый вердикт по
    // одной детерминированной части, выглядящий полным.
    expect(invited.narrowed).toBe(false);
    expect(invited.shorterThanRoster).toBe(false);
    expect(invited.reason).toContain("не найден");
  });

  it("нечитаемая конфигурация не сужает набор, а называет причину", () => {
    const invited = capabilitiesOfWorkflow("full-check", {
      workflows: "config/workflows",
      agents: "config/нет-такого-каталога",
    });

    expect(invited.narrowed).toBe(false);
    expect(invited.reason).toContain("конфигурация не прочитана");
  });
});
