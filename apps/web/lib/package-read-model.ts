/**
 * Пакет заказчику — шаг 6 тракта и второй его разрыв.
 *
 * ЧТО ТАКОЕ ПАКЕТ
 *
 * Не отдельная функция, а ВЫХОД КОНВЕЙЕРА. Замерено по `reference-system/output-1`:
 * там десять документов, и девять из них соответствуют девяти агентам системы
 * один в один — от «02 Инженерное заключение» (ГИП) до «09 Организационный
 * протокол» (администратор). Десятый — график производства работ — агента не
 * имеет, и это объявленное отсутствие, а не недоделка.
 *
 * ПОЧЕМУ СОСТАВ ЗАДАН СПИСКОМ, А НЕ СОБИРАЕТСЯ ИЗ АРТЕФАКТА
 *
 * Потому что пакет — это ОБЕЩАНИЕ заказчику: десять документов названы в
 * `output-1`, и заказчик считает по этому перечню. Если состав выводить из того,
 * что отработало, пакет молча уменьшится на неотработавшем прогоне — и никто не
 * заметит, что документа нет. Здесь наоборот: строк всегда десять, и каждая
 * либо даёт файл, либо называет причину.
 *
 * СОСТОЯНИЕ СТРОКИ ВЫВОДИТСЯ ИЗ ПРОГОНА, А НЕ ЗАДАЁТСЯ
 *
 * Готовность документа = «его агент высказался в этом прогоне». Иначе строка
 * стоит с причиной: агент не отработал, или его в конвейере нет вовсе.
 */
import { readCheck, type ArtifactView, type CheckCard, type ReviewAgentView } from "./check-read-model.js";

/** Состояние строки пакета: либо файл, либо названная причина. */
export type PackageState =
  | { readonly kind: "готов" }
  | { readonly kind: "нет"; readonly reason: string };

export interface PackageRow {
  /** Номер как в `output-1`: заказчик считает по нему. */
  readonly ordinal: string;
  readonly title: string;
  /** Часть адреса скачивания. Латиницей: имя файла уезжает в заголовок ответа. */
  readonly slug: string;
  /** Способность агента, который наполняет документ. */
  readonly capability: string | undefined;
  readonly format: "xlsx" | "docx";
  readonly state: PackageState;
  /** Сколько замечаний вошло — ноль тоже сообщается, чтобы не гадать. */
  readonly findings: number;
  readonly bySeverity: readonly (readonly [string, number])[];
}

export interface PackageCard {
  readonly checkId: string;
  readonly objectCode: string;
  readonly objectName: string;
  readonly producedAt: Date | null;
  /**
   * Артефакт, из которого собираются документы.
   *
   * Необязательное свойство, а не `string | undefined`: при
   * `exactOptionalPropertyTypes` это разные вещи, и «артефакта нет» здесь
   * означает отсутствие ключа, а не ключ со значением «ничего».
   */
  readonly artifactId?: string;
  readonly rows: readonly PackageRow[];
  readonly ready: number;
  /** Всего строк в обещанном пакете. */
  readonly promised: number;
  /**
   * Прогон не дал НИ ОДНОГО высказывания агента.
   *
   * Различие обязательное, а не удобное: десять строк «не собран» выглядят
   * поломкой системы, тогда как причина у них одна и общая — прогон ещё не
   * закончился либо закончился без обзора. Сказать это один раз наверху честнее,
   * чем повторить десять раз в строках. Сформулировано отдельным полем, потому
   * что «этот документ не собрать» и «собирать пока нечего» — разные утверждения.
   */
  readonly silent: boolean;
}

/**
 * Состав пакета: десять документов `output-1` и агент под каждым.
 *
 * `capability: undefined` означает «в конвейере нет агента, который его
 * производит». Такая строка не исчезает из перечня: исчезнувшая строка — это
 * обещание, снятое молча.
 */
const COMPOSITION: readonly {
  readonly ordinal: string;
  readonly title: string;
  readonly slug: string;
  readonly capability: string | undefined;
  readonly format: "xlsx" | "docx";
}[] = [
  { ordinal: "01", title: "Итоговая записка", slug: "itogovaya-zapiska", capability: "object_verdict", format: "docx" },
  { ordinal: "02", title: "Инженерное заключение", slug: "inzhenernoe-zaklyuchenie", capability: "tech_opinion", format: "xlsx" },
  { ordinal: "03", title: "Сметный анализ", slug: "smetnyy-analiz", capability: "estimate_review", format: "xlsx" },
  { ordinal: "04", title: "Себестоимость и финрезультат", slug: "sebestoimost", capability: "finance_model", format: "xlsx" },
  { ordinal: "05", title: "Снабжение и поставки", slug: "snabzhenie", capability: "procurement_map", format: "xlsx" },
  { ordinal: "06", title: "Подрядный анализ", slug: "podryadnyy-analiz", capability: "subcontract_plan", format: "xlsx" },
  { ordinal: "07", title: "ПТО и исполнительная документация", slug: "pto-i-id", capability: "executive_docs", format: "xlsx" },
  { ordinal: "08", title: "Договорной анализ", slug: "dogovornoy-analiz", capability: "contract_audit", format: "xlsx" },
  { ordinal: "09", title: "Организационный протокол", slug: "organizatsionnyy-protokol", capability: "object_passport", format: "xlsx" },
  { ordinal: "10", title: "График производства работ", slug: "grafik-rabot", capability: "work_schedule", format: "xlsx" },
];

/** Строка пакета по её адресу — для обработчика скачивания. */
export function compositionOf(slug: string): (typeof COMPOSITION)[number] | undefined {
  return COMPOSITION.find((row) => row.slug === slug);
}

/** Обзор прогона, разложенный по агентам. Пустая карта — обзора не было. */
export function agentsOf(card: CheckCard): ReadonlyMap<string, ReviewAgentView> {
  const byCapability = new Map<string, ReviewAgentView>();

  for (const artifact of card.artifacts) {
    if (artifact.review === null) continue;
    for (const agent of artifact.review.agents) {
      // Первый артефакт прогона главнее: они отсортированы по времени, свежий
      // сверху, и переписывать свежие данные старыми нельзя.
      if (!byCapability.has(agent.capability)) byCapability.set(agent.capability, agent);
    }
  }

  return byCapability;
}

/** Артефакт обхода объекта — тот, из которого собираются документы. */
export function sourceArtifact(card: CheckCard): ArtifactView | undefined {
  return card.artifacts.find((artifact) => artifact.review !== null) ?? card.artifacts[0];
}

export async function readPackage(
  tenant: string,
  objectCode: string,
  checkId: string,
): Promise<PackageCard | undefined> {
  const card = await readCheck(tenant, objectCode, checkId);
  if (card === undefined) return undefined;

  const agents = agentsOf(card);
  const artifact = sourceArtifact(card);

  const rows: PackageRow[] = COMPOSITION.map((entry) => {
    if (entry.capability === undefined) {
      return {
        ...entry,
        state: { kind: "нет", reason: "в конвейере нет агента, который производит этот документ" },
        findings: 0,
        bySeverity: [],
      };
    }

    const agent = agents.get(entry.capability);

    if (agent === undefined) {
      return {
        ...entry,
        state: {
          kind: "нет",
          reason: `агент ${entry.capability} не высказался в этом прогоне`,
        },
        findings: 0,
        bySeverity: [],
      };
    }

    return {
      ...entry,
      state: { kind: "готов" },
      findings: agent.findings.length,
      bySeverity: agent.bySeverity,
    };
  });

  return {
    checkId: card.id,
    objectCode: card.objectCode,
    objectName: card.objectName,
    producedAt: card.finishedAt,
    ...(artifact === undefined ? {} : { artifactId: artifact.id }),
    rows,
    ready: rows.filter((row) => row.state.kind === "готов").length,
    promised: COMPOSITION.length,
    silent: agents.size === 0,
  };
}
