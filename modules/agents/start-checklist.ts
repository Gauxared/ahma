/**
 * Чеклист старта — продукт Палыча на такте 1.
 *
 * Источник — легаси-протокол
 * `reference-system/skills/stroiintellect-master/.../references/workflow.md`,
 * ТАКТ 1, ПАЛЫЧ. Семь пунктов перенесены дословно.
 *
 * Критическое правило того же протокола: «ИД без Палыча с первого дня →
 * Предписание ГСН → штраф + останов работ».
 *
 * ЧЕМ ЭТО ЛУЧШЕ ОРИГИНАЛА
 *
 * В легаси это семь квадратиков □, которые человек ставит галочками. У такого
 * списка два способа соврать, и оба обычны:
 *
 *  · неотвеченный пункт выглядит как отсутствие проблемы — пустой квадратик
 *    и «нет, не сделано» на бумаге неразличимы;
 *  · пункт без цены пропуска откладывается, потому что непонятно, чем рискуешь.
 *
 * Здесь неотвеченное и отвеченное отрицательно — РАЗНЫЕ исходы, и оба мешают
 * чеклисту считаться пройденным. У каждого пункта записано последствие, и оно
 * попадает в передачу: не «закройте пункт 3», а «без аккредитованной
 * лаборатории протоколы испытаний недействительны».
 */

export interface ChecklistItem {
  readonly id: string;
  readonly question: string;
  /** Что случится, если пункт не закрыт. Из практики ГСН. */
  readonly consequence: string;
}

/** Семь пунктов протокола, в порядке оригинала. */
export const START_CHECKLIST: readonly ChecklistItem[] = [
  {
    id: "приказ-о-начале",
    question: "Приказ о начале производства работ подписан?",
    consequence: "работы без приказа — основание для предписания ГСН и отказа в приёмке",
  },
  {
    id: "общий-журнал",
    question: "Общий журнал производства работ оформлен?",
    consequence: "журнал заводится ДО начала работ; задним числом он недействителен",
  },
  {
    id: "лаборатория",
    question: "Лаборатория найдена и аккредитация проверена по виду работ?",
    consequence: "без аккредитованной лаборатории протоколы испытаний недействительны",
  },
  {
    id: "пос",
    question: "ПОС утверждён?",
    consequence: "без утверждённого ПОС нет законного порядка производства работ",
  },
  {
    id: "список-аоср",
    question: "Список АОСР составлен и передан прорабу?",
    consequence: "скрытые работы, не освидетельствованные вовремя, вскрывают заново за свой счёт",
  },
  {
    id: "ответственный-за-ид",
    question: "Ответственный за исполнительную документацию назначен?",
    consequence: "без назначенного ответственного ИД накапливается и собирается в конце — с потерями",
  },
  {
    id: "журналы-спецработ",
    question: "Журналы специальных работ (сварка, бетон, изоляция) готовы?",
    consequence: "специальные работы без своего журнала не принимаются надзором",
  },
];

export interface StartChecklistResult {
  readonly subject: "чеклист-старта";
  readonly status: "approved" | "returned";
  /** Пункты, на которые не ответили. Не то же самое, что «нет». */
  readonly unanswered: readonly ChecklistItem[];
  /** Пункты с ответом «нет»: известный незакрытый риск. */
  readonly failed: readonly ChecklistItem[];
  readonly handoff: {
    readonly from: string;
    readonly to: string;
    readonly subject: string;
    readonly payload: string;
    readonly priority: "critical" | "high" | "medium";
  };
}

/**
 * Строит результат чеклиста по ответам.
 *
 * Ответ отсутствует — пункт в `unanswered`; ответ «нет» — в `failed`. Оба
 * держат чеклист незакрытым, но требуют разного: первому нужен ответ, второму
 * работа.
 */
export function buildStartChecklist(
  answers: Readonly<Record<string, boolean>>,
): StartChecklistResult {
  const unanswered = START_CHECKLIST.filter((item) => answers[item.id] === undefined);
  const failed = START_CHECKLIST.filter((item) => answers[item.id] === false);

  const status = unanswered.length === 0 && failed.length === 0 ? "approved" : "returned";

  const blocking = [...failed, ...unanswered];

  return {
    subject: "чеклист-старта",
    status,
    unanswered,
    failed,
    handoff: {
      from: "палыч",
      to: "артемий",
      subject: "чеклист-старта",
      payload:
        status === "approved"
          ? "Чеклист старта закрыт полностью: препятствий к началу работ по ИД нет."
          : `Старт не обеспечен по ${blocking.length} пунктам. ` +
            blocking
              .map((item) => `${item.question} — ${item.consequence}`)
              .join("; "),
      priority: "critical",
    },
  };
}
