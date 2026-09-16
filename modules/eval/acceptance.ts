/**
 * Приёмка по агентам — ТЗ §12.2.
 *
 * Требование договора: **≥80% пунктов чек-листа ПО КАЖДОМУ агенту**. Формулировка
 * «по каждому» — не оговорка: агент, провалившийся в одиночку, не принимается,
 * даже если остальные восемь идеальны.
 *
 * ПОЧЕМУ НЕЛЬЗЯ УСРЕДНЯТЬ
 *
 * Средняя доля по девяти агентам прячет того, кто не работает: восемь по сто
 * процентов и один по нулю дают 89% — выше порога. Но объект, где не работает
 * сметчик, не проверен, сколько бы ни старались остальные. Поэтому свод
 * называет проваленных поимённо, а не считает их долю.
 *
 * ДВА ПРАВИЛА, БЕЗ КОТОРЫХ ОЦЕНКА ЛЬСТИТ
 *
 * 1. *Неотвеченный пункт — непройденный.* Иначе чек-лист из одного отвеченного
 *    пункта даёт сто процентов: чем меньше проверили, тем лучше результат.
 *    Это худший из возможных стимулов, и он появляется сам собой, если считать
 *    долю от отвеченных, а не от всех.
 *
 * 2. *Пустой чек-лист не проходит.* Ноль из нуля — не сто процентов. Агент без
 *    чек-листа не проверен, и объявить его принятым значит принять
 *    непроверенное (ТЗ §9).
 */

/** Порог договора: §12.2 требует не менее восьмидесяти процентов. */
export const ACCEPTANCE_THRESHOLD = 0.8;

export interface ChecklistItem {
  readonly id: string;
  readonly requirement: string;
  /** Как проверить. Пункт без способа проверки — пожелание, а не критерий. */
  readonly howToCheck?: string;
}

export interface AgentChecklist {
  readonly agent: string;
  readonly items: readonly ChecklistItem[];
}

export interface AgentResult {
  readonly agent: string;
  readonly total: number;
  readonly passedCount: number;
  /** Доля пройденных от ВСЕХ пунктов, а не от отвеченных. */
  readonly share: number;
  readonly passed: boolean;
  readonly failed: readonly ChecklistItem[];
  readonly unanswered: readonly ChecklistItem[];
}

export interface AcceptanceResult {
  readonly byAgent: readonly AgentResult[];
  /** Принято, только если прошёл КАЖДЫЙ агент. */
  readonly passed: boolean;
  readonly failedAgents: readonly string[];
}

export function evaluateAgent(
  checklist: AgentChecklist,
  answers: Readonly<Record<string, boolean>>,
): AgentResult {
  const total = checklist.items.length;

  const failed = checklist.items.filter((item) => answers[item.id] === false);
  const unanswered = checklist.items.filter((item) => answers[item.id] === undefined);
  const passedCount = checklist.items.filter((item) => answers[item.id] === true).length;

  // Доля считается от ВСЕХ пунктов: неотвеченный не исчезает из знаменателя.
  const share = total === 0 ? 0 : passedCount / total;

  return {
    agent: checklist.agent,
    total,
    passedCount,
    share,
    // Пустой чек-лист не проходит: проверять было нечего.
    passed: total > 0 && share >= ACCEPTANCE_THRESHOLD,
    failed,
    unanswered,
  };
}

export function evaluateAll(
  checklists: readonly AgentChecklist[],
  answers: Readonly<Record<string, Readonly<Record<string, boolean>>>>,
): AcceptanceResult {
  const byAgent = checklists.map((checklist) =>
    evaluateAgent(checklist, answers[checklist.agent] ?? {}),
  );

  const failedAgents = byAgent.filter((agent) => !agent.passed).map((agent) => agent.agent);

  return {
    byAgent,
    passed: failedAgents.length === 0,
    failedAgents,
  };
}
