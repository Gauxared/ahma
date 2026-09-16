/**
 * Реестр агентов для веба — обёртка над платформенным, а не второй реестр.
 *
 * ПОЧЕМУ ОБЁРТКА
 *
 * Первая версия этого модуля читала `displayName` из манифестов сама: реестр
 * платформы (`platform/config/agent-roster.ts`) в тот момент ещё не был
 * закоммичен, а собирать чужое незакоммиченное нельзя (`Ф-ADR-013`). Как только
 * он появился, своё чтение стало ВТОРЫМ источником правды о том же — а два
 * реестра расходятся, и расходятся молча: ровно так восемь агентов однажды стали
 * Людмилой.
 *
 * Теперь здесь только кэш и мягкое поведение при сбое; знание об агентах живёт
 * в одном месте и приходит из манифестов.
 *
 * ПОЧЕМУ СБОЙ НЕ РОНЯЕТ ЭКРАН
 *
 * Загрузчик платформы падает при рассогласовании манифеста — это `fail closed`
 * из `ADR-R-014`, и он защищает от НЕВЕРНОЙ ПОДПИСИ. Веб от этого защищён
 * иначе: при сбое загрузки реестр остаётся пустым, и экран показывает
 * способность (`estimate_review`) вместо роли. Это меньше сведений, но не ложь,
 * — а уронить страницу пакета из-за одного манифеста значит потерять девять
 * исправных документов.
 */
import { join } from "node:path";

import { loadAgentRoster, type AgentIdentity } from "@platform/config/agent-roster";

/**
 * Читается один раз на процесс.
 *
 * Манифесты меняются только при развёртывании, а страница пакета спрашивает
 * реестр по разу на документ: без запоминания это десять обходов каталога на
 * один экран.
 */
let cache: ReadonlyMap<string, AgentIdentity> | undefined;

export function agentRoster(): ReadonlyMap<string, AgentIdentity> {
  if (cache !== undefined) return cache;

  try {
    const { roster } = loadAgentRoster(join(process.cwd(), "config", "agents"));
    cache = new Map(roster.all().map((identity) => [identity.capability, identity]));
  } catch {
    cache = new Map();
  }

  return cache;
}

/** Роль агента («Договорник») или `undefined`, если реестр её не знает. */
export function roleOf(capability: string): string | undefined {
  return agentRoster().get(capability)?.role;
}

/** Имя агента («Виктор») — им подписаны замечания в протоколах заказчика. */
export function personOf(capability: string): string | undefined {
  return agentRoster().get(capability)?.person;
}

/**
 * Каркас роли: листы, которые агент обязан дать при ЛЮБОМ объекте.
 *
 * Книге он нужен, чтобы отличить ДВА разных отсутствия. Предметного листа нет —
 * значит, на объекте нет предмета: у жилого дома не проверяют геометрию
 * контактной сети, и молчание тут правильный ответ. Листа каркаса нет — значит,
 * роль не ответила на свой всегдашний вопрос, и это ПРОБЕЛ.
 *
 * Тот же список уходит агенту в промпт из композиционного корня. Источник у них
 * один — манифест, — потому что второй список разошёлся бы с первым, и книга
 * упрекала бы агента в пропуске листа, которого у него не просили.
 */
export function requiredSectionsOf(
  capability: string,
): readonly { readonly id: string; readonly title: string }[] {
  return agentRoster().get(capability)?.requiredSections ?? [];
}

/** Место агента в конвейере: по нему выстраивается порядок такта. */
export function orderOf(capability: string): number | undefined {
  return agentRoster().get(capability)?.order;
}
