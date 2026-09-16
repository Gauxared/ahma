/**
 * Свёртка результата Проверки ПО АГЕНТАМ.
 *
 * ЧТО ЭТО ЧИНИТ
 *
 * Обзор возвращается списком «исходов по предметам»: у документного агента
 * предмет — смета, у объектного — объект целиком. Обе поверхности группировали
 * этот список ПО ПРЕДМЕТУ, и обе получали неправду:
 *
 *  · шесть объектных агентов имеют один и тот же `path` (папку объекта) и
 *    схлопывались в одну кучу, а их вердикты склеивались через «; »;
 *  · документный агент, посмотревший четыре сметы, распадался на четыре
 *    безымянных блока;
 *  · подпись бралась откуда придётся — записка звала Виктора и Халиля
 *    «Людмилой».
 *
 * Вопрос, на который отвечает выгрузка, — «что сказал каждый из девяти», а не
 * «что сказали про каждый файл». Ключ группировки — способность.
 *
 * ДЕВЯТЬ ЗАПИСЕЙ ВСЕГДА
 *
 * Агент, не оставивший ни одного исхода, получает запись со статусом «не
 * выполнен» и ПРИЧИНОЙ. Молча показать шесть блоков вместо девяти значит выдать
 * неполный расклад за полный: читатель не отличит «эту тему никто не смотрел»
 * от «этой темы у объекта нет» (ТЗ §9, ADR-R-026).
 *
 * ЛИЧНОСТИ ПРИХОДЯТ ДАННЫМИ
 *
 * Реестр живёт в `platform/config/agent-roster.ts`, а сюда его состав приходит
 * аргументом. Так узкая талия остаётся целой (ADR-R-025), и — не менее важно —
 * в этом файле не появляется литеральный ростер, который запрещает ADR-R-011.
 */

/** Зеркало `AgentIdentity` реестра. Объявлено локально, чтобы не тянуть платформу. */
export interface AgentIdentityForReport {
  readonly capability: string;
  readonly person: string;
  readonly role: string;
  readonly scope: string;
  readonly order: number;
}

export interface FindingForReport {
  readonly severity: string;
  readonly statement: string;
  readonly basis: string;
  /** Класс отклонения, если агент его назвал. */
  readonly deviation?: string;
  /**
   * Сумма под угрозой как десятичная строка рублей.
   *
   * Считает система по порядковому номеру позиции, а не модель: число из ответа
   * модели было бы числом без следа (§12.1д). Отсутствие — «не определено», а
   * не ноль: ноль сказал бы, что нарушение бесплатно.
   */
  readonly impact?: string;
  /** Чью смету смотрели. Отсутствует у объектных агентов и у синтеза. */
  readonly document?: string;
}

/** Один предмет, рассмотренный агентом: смета либо объект целиком. */
export interface SubjectForReport {
  /** Имя файла либо «объект целиком». */
  readonly subject: string;
  readonly scope: string;
  /** Вердикт по этому предмету. Отсутствует, если агент отказал. */
  readonly verdict?: string;
  /** Причина отказа. Отсутствует, если отказа не было. */
  readonly error?: string;
  readonly findings: readonly FindingForReport[];
  readonly depthViolations: readonly string[];
}

/**
 * Что агент сделал.
 *
 * Три состояния, и ни одно не сводится к другому. «Выполнен без замечаний» и
 * «не запускался» дают на экране одинаковый ноль находок, и различить их можно
 * только этим полем.
 */
export type AgentStatus = "выполнен" | "отказ" | "не выполнен";

export interface AgentSection {
  readonly identity: AgentIdentityForReport;
  readonly status: AgentStatus;
  /** Почему не выполнен. Обязательна при статусе «не выполнен». */
  readonly reason?: string;
  readonly subjects: readonly SubjectForReport[];
  readonly findings: readonly FindingForReport[];
  readonly bySeverity: readonly (readonly [string, number])[];
  readonly depthViolations: readonly string[];
}

/** Исход по предмету — ровно то, что кладёт в артефакт `check-object`. */
export interface OutcomeForReport {
  readonly path: string;
  readonly scope?: string | undefined;
  readonly capability?: string | undefined;
  readonly verdict?: string | undefined;
  readonly error?: string | undefined;
  readonly findings: readonly {
    severity: string;
    basis: string;
    statement: string;
    deviation?: string | undefined;
    impact?: { value: { amount: string } } | undefined;
  }[];
  readonly depthViolations?: readonly string[] | undefined;
}

/** Важность по убыванию. Порядок объявлен, а не выведен из алфавита. */
const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"] as const;

function severityRank(severity: string): number {
  const index = (SEVERITY_ORDER as readonly string[]).indexOf(severity);
  return index === -1 ? SEVERITY_ORDER.length : index;
}

function baseName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

export function foldByAgent(input: {
  readonly roster: readonly AgentIdentityForReport[];
  /** Исходы обзора. `undefined` — обзор не запрашивался вовсе. */
  readonly outcomes: readonly OutcomeForReport[] | undefined;
  /** Объявленные деградации прогона: отсюда берётся причина «не выполнен». */
  readonly degradations?: readonly { capability: string; reason: string }[];
}): readonly AgentSection[] {
  const outcomes = input.outcomes ?? [];
  const reasons = new Map(
    (input.degradations ?? []).map((degradation) => [degradation.capability, degradation.reason]),
  );

  const byCapability = new Map<string, OutcomeForReport[]>();

  for (const outcome of outcomes) {
    // Исход без способности не приписывается никому: подставить сюда первого
    // попавшегося агента — это ровно тот дефект, который свёртка и чинит.
    const key = outcome.capability ?? "";
    byCapability.set(key, [...(byCapability.get(key) ?? []), outcome]);
  }

  const sections = [...input.roster]
    .sort((a, b) => a.order - b.order)
    .map((identity) => section(identity, byCapability.get(identity.capability) ?? [], reasons));

  // Исходы, чьей способности нет в реестре, не пропадают: их видно как
  // «агент не назван». Молчаливая потеря выглядела бы как отсутствие замечаний.
  const orphans = [...byCapability]
    .filter(([capability]) => !input.roster.some((entry) => entry.capability === capability))
    .flatMap(([, entries]) => entries);

  if (orphans.length > 0) {
    sections.push(
      section(
        {
          capability: "",
          person: "агент не назван",
          role: "способность не найдена в реестре",
          scope: "неизвестно",
          order: Number.MAX_SAFE_INTEGER,
        },
        orphans,
        reasons,
      ),
    );
  }

  return sections;
}

function section(
  identity: AgentIdentityForReport,
  entries: readonly OutcomeForReport[],
  reasons: ReadonlyMap<string, string>,
): AgentSection {
  const subjects: SubjectForReport[] = entries.map((outcome) => ({
    subject: outcome.scope === "объект" ? "объект целиком" : baseName(outcome.path),
    scope: outcome.scope ?? "документ",
    ...(outcome.verdict === undefined ? {} : { verdict: outcome.verdict }),
    ...(outcome.error === undefined ? {} : { error: outcome.error }),
    findings: outcome.findings.map((finding) => ({
      severity: finding.severity,
      statement: finding.statement,
      basis: finding.basis,
      ...(finding.deviation === undefined ? {} : { deviation: finding.deviation }),
      ...(finding.impact === undefined ? {} : { impact: finding.impact.value.amount }),
      // Документ несут только находки документного агента: у объектного
      // «документ» был бы папкой, и читатель решил бы, что смотрели один файл.
      ...(outcome.scope === "объект" ? {} : { document: baseName(outcome.path) }),
    })),
    depthViolations: outcome.depthViolations ?? [],
  }));

  const findings = subjects
    .flatMap((subject) => subject.findings)
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  const counts = new Map<string, number>();
  for (const finding of findings) counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);

  const status: AgentStatus =
    entries.length === 0
      ? "не выполнен"
      : entries.some((outcome) => outcome.error !== undefined)
        ? "отказ"
        : "выполнен";

  const reason =
    status === "не выполнен"
      ? (reasons.get(identity.capability) ??
        "агент не запускался: причина не объявлена деградацией прогона")
      : status === "отказ"
        ? entries.find((outcome) => outcome.error !== undefined)?.error
        : undefined;

  return {
    identity,
    status,
    ...(reason === undefined ? {} : { reason }),
    subjects,
    findings,
    bySeverity: [...counts].sort((a, b) => severityRank(a[0]) - severityRank(b[0])),
    depthViolations: [...new Set(subjects.flatMap((subject) => subject.depthViolations))],
  };
}
