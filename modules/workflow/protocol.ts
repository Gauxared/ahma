/**
 * Протокол тактов как код (M2, ADR-R-002, ADR-R-003).
 *
 * Источник правды — легаси-протокол
 * `reference-system/skills/stroiintellect-master/.../references/workflow.md`.
 * Здесь он не пересказан своими словами, а перенесён: формулировки правил и их
 * последствия сохранены дословно.
 *
 * ЧТО ЭТОТ МОДУЛЬ ДЕЛАЕТ ЛУЧШЕ ОРИГИНАЛА
 *
 * В легаси критические правила — строки таблицы, которую читает человек или
 * модель. Соблюдение держится на внимании: «Ваныч без ВОР от Людмилы» можно
 * нарушить, и система об этом не узнает — узнает бухгалтерия, как в
 * Каранайауле.
 *
 * Здесь правило — предусловие, которое БЛОКИРУЕТ запуск шага и называет
 * последствие в отказе. Оригинал правило описывает; этот модуль его принуждает.
 * Ничего из содержания протокола при этом не потеряно: правил столько же, и они
 * ссылаются на тот же документ.
 *
 * Второе отличие — цикл возврата. В легаси «Людмила принимает ВОР от Денчика»
 * и «Статус ВОР = 🔴 возвращён» описаны, но сколько раз можно возвращать —
 * не сказано. Бесконечный цикл согласований между двумя агентами и есть способ
 * не выпустить объект никогда. Здесь цикл ограничен и заканчивается эскалацией
 * человеку с указанием, сколько попыток исчерпано.
 */

/** Статус общего предмета: ВОР, потолки, аудит договора. */
export type SubjectStatus = "draft" | "returned" | "approved";

export interface SubjectState {
  readonly id: string;
  readonly status: SubjectStatus;
  /** Сколько раз предмет возвращали на пересчёт. */
  readonly returnedCount: number;
}

export interface StepDefinition {
  readonly agent: string;
  /** Предметы, которые шаг создаёт или обновляет. */
  readonly produces: readonly string[];
  /** Предусловия вида «предмет:статус». */
  readonly requires: readonly string[];
}

export interface StageDefinition {
  readonly id: string;
  readonly name: string;
  readonly steps: readonly StepDefinition[];
}

/**
 * Критическое правило протокола. Перенесено из таблицы
 * «Критические правила протокола (нарушение = системная ошибка)».
 *
 * `consequence` — не украшение: это ответ на вопрос «почему нельзя», и он
 * попадает в текст отказа. Отказ без причины человек обходит; отказ с ценой
 * ошибки — обдумывает.
 */
export interface CriticalRule {
  readonly id: string;
  readonly statement: string;
  readonly consequence: string;
  /** Предусловие вида «предмет:статус». */
  readonly precondition: string;
  /** Агент, чей шаг блокируется нарушением. */
  readonly blocks: string;
}

export const CRITICAL_RULES: readonly CriticalRule[] = [
  {
    id: "ваныч-без-вор",
    statement: "Ваныч без ВОР от Людмилы",
    consequence: "Финмодель на «воздухе» → убыток как в Каранайауле",
    precondition: "вор:approved",
    blocks: "ваныч",
  },
  {
    id: "людмила-без-вор-денчика",
    statement: "Людмила без ВОР от Денчика",
    consequence: "Смета на необоснованных объёмах → ошибка 30–40%",
    precondition: "вор-геометрия:approved",
    blocks: "людмила",
  },
  {
    id: "марина-без-потолков",
    statement: "Марина без потолков от Ваныча",
    consequence: "Закупка выше бюджета → кассовый разрыв",
    precondition: "потолки:approved",
    blocks: "марина",
  },
  {
    id: "такт-4-без-critical",
    statement: "Такт 4 без закрытых CRITICAL",
    consequence: "Вердикт без оснований → риск на старте",
    precondition: "critical-замечания:approved",
    blocks: "артемий",
  },
  {
    id: "ид-без-палыча",
    statement: "ИД без Палыча с первого дня",
    consequence: "Предписание ГСН → штраф + останов работ",
    precondition: "чеклист-старта:approved",
    blocks: "пто",
  },
  {
    id: "договор-без-виктора",
    statement: "Договор без Виктора",
    consequence: "Пропущенный риск ГУ/БГ → 30–50 млн потерь",
    precondition: "аудит-договора:approved",
    blocks: "договор",
  },
];

export interface Block {
  readonly subject: string;
  readonly expected: readonly string[];
  readonly actual: string;
  /** Последствие из критического правила, если предусловие им покрыто. */
  readonly consequence?: string;
}

export type Startable = { readonly ok: true } | { readonly ok: false; readonly blocks: readonly Block[] };

export interface HandoffRecord {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly payload: string;
  readonly priority: "critical" | "high" | "medium";
}

export interface ReturnedSubject {
  readonly subject: string;
  readonly reason: string;
}

export interface StepResult {
  readonly agent: string;
  readonly produced: readonly { readonly subject: string; readonly status: SubjectStatus }[];
  /**
   * Предметы ЧУЖОГО авторства, которые шаг отвергает.
   *
   * Это и есть цикл ADR-R-002: «Людмила принимает ВОР от Денчика» и возвращает
   * ЕГО на пересчёт. Возврат чужого продукта переигрывает шаг АВТОРА, а не
   * того, кто вернул: исправлять должен тот, кто делал.
   */
  readonly returned?: readonly ReturnedSubject[];
  readonly handoffs: readonly HandoffRecord[];
}

export interface ProtocolPorts {
  /**
   * Исполняет шаг. Возвращает `undefined`, если агента ещё нет.
   *
   * Не «пустой результат», а именно отсутствие: восемь агентов из девяти пока
   * не написаны, и считать их шаги пройденными значило бы отчитаться полным
   * протоколом на одной девятой работы.
   */
  readonly runStep: (
    step: StepDefinition,
    subjects: ReadonlyMap<string, SubjectState>,
  ) => Promise<StepResult | undefined>;
}

/**
 * Заблокированный шаг не имел ПРАВА стартовать; нереализованный — не имел ЧЕМ.
 * Смешать их значит спрятать объём оставшейся работы.
 */
export type StepStatus = "исполнен" | "уже исполнен" | "заблокирован" | "не реализован";

export interface StepOutcome {
  readonly agent: string;
  readonly status: StepStatus;
  readonly produced?: readonly { readonly subject: string; readonly status: SubjectStatus }[];
  readonly blocks?: readonly Block[];
  /** Сколько раз шаг переигрывался из-за возвращённого предмета. */
  readonly attempts: number;
}

export interface StageOutcome {
  readonly id: string;
  readonly name: string;
  readonly steps: readonly StepOutcome[];
}

export interface Escalation {
  readonly subject: string;
  /** Автор предмета: к нему идёт пересчёт. */
  readonly agent: string;
  /** Кто вернул. Без этого непонятно, с кем говорить о разногласии. */
  readonly returnedBy?: string;
  readonly reason: string;
}

export interface ProtocolBody {
  readonly stages: readonly StageOutcome[];
  readonly handoffs: readonly HandoffRecord[];
  readonly escalations: readonly Escalation[];
  readonly subjects: readonly SubjectState[];
  readonly blockedSteps: number;
  readonly unimplementedSteps: number;
  /**
   * Прогон дошёл до конца без заблокированных шагов. Только такой прогон имеет
   * право нести сводный вывод §5.3 (ADR-R-022).
   */
  readonly completed: boolean;
}

export interface ProtocolOptions {
  readonly subjects: ReadonlyMap<string, SubjectState>;
  /** Сколько раз допустимо вернуть предмет на пересчёт. По умолчанию два (ADR-R-002). */
  readonly maxRework?: number;
  /**
   * Шаги, исполненные в прошлых запусках этого прогона (§5.6).
   *
   * Ключи вида `такт-1/людмила`. Такой шаг не исполняется заново: рестарт
   * «без повторной загрузки» на то и рестарт, что не повторяет сделанное.
   */
  readonly completedSteps?: readonly string[];
}

function parsePrecondition(precondition: string): { subject: string; statuses: readonly string[] } {
  const [subject, alternatives] = precondition.split(":");

  if (subject === undefined || alternatives === undefined || subject === "" || alternatives === "") {
    throw new Error(`Некорректное предусловие: ${JSON.stringify(precondition)}. Ожидается «предмет:статус».`);
  }

  return { subject, statuses: alternatives.split("|") };
}

/**
 * Может ли шаг стартовать. Вызывается ОДИНАКОВО из полного прогона протокола и
 * из отдельного вызова шага — иначе «посчитать финмодель отдельно» обходит
 * гейт, ради которого гейт и заведён (ADR-R-022).
 */
export function startable(step: StepDefinition, subjects: ReadonlyMap<string, SubjectState>): Startable {
  const blocks: Block[] = [];

  for (const precondition of step.requires) {
    const { subject, statuses } = parsePrecondition(precondition);
    const state = subjects.get(subject);

    if (state !== undefined && statuses.includes(state.status)) continue;

    const rule = CRITICAL_RULES.find(
      (candidate) => candidate.precondition === precondition && candidate.blocks === step.agent,
    );

    blocks.push({
      subject,
      expected: statuses,
      actual: state?.status ?? "предмет отсутствует",
      ...(rule === undefined ? {} : { consequence: rule.consequence }),
    });
  }

  return blocks.length === 0 ? { ok: true } : { ok: false, blocks };
}

/**
 * Проводит объект по тактам.
 *
 * Возврат предмета переигрывает ТОТ ЖЕ шаг, а не весь такт: возвращают
 * конкретный продукт конкретному автору. Число попыток ограничено; исчерпание
 * даёт эскалацию, а не молчаливое продолжение с неподтверждённым предметом.
 */
export async function runProtocol(
  stages: readonly StageDefinition[],
  ports: ProtocolPorts,
  options: ProtocolOptions,
): Promise<ProtocolBody> {
  const maxRework = options.maxRework ?? 2;
  const subjects = new Map(options.subjects);
  const handoffs: HandoffRecord[] = [];
  const escalations: Escalation[] = [];
  const outcomes: StageOutcome[] = [];

  let blockedSteps = 0;
  let unimplementedSteps = 0;

  const alreadyDone = new Set(options.completedSteps ?? []);

  /** Кто произвёл предмет: нужно, чтобы вернуть его автору. */
  const authorOf = new Map<string, { stage: StageDefinition; step: StepDefinition }>();
  for (const stage of stages) {
    for (const step of stage.steps) {
      for (const subject of step.produces) {
        if (!authorOf.has(subject)) authorOf.set(subject, { stage, step });
      }
    }
  }

  /** Сколько раз предмет уже возвращали автору. */
  const reworkCount = new Map<string, number>();

  for (const stage of stages) {
    const steps: StepOutcome[] = [];

    for (const step of stage.steps) {
      // Шаг из прошлого запуска: его продукты уже в состоянии предметов,
      // повторять работу незачем. Гейт при этом НЕ проверяется — он был
      // пройден тогда, и переигрывать его решение задним числом неверно.
      if (alreadyDone.has(`${stage.id}/${step.agent}`)) {
        steps.push({ agent: step.agent, status: "уже исполнен", attempts: 0 });
        continue;
      }

      const gate = startable(step, subjects);

      if (!gate.ok) {
        blockedSteps += 1;
        steps.push({ agent: step.agent, status: "заблокирован", blocks: gate.blocks, attempts: 0 });
        continue;
      }

      let attempts = 0;
      // eslint-disable-next-line prefer-const -- переприсваивается при возврате
      let result = await ports.runStep(step, subjects);
      attempts += 1;

      if (result === undefined) {
        // Агента нет. Шаг не исполнен и предметов не создал — значит его
        // потребители дальше встанут на гейте, и это правильно.
        unimplementedSteps += 1;
        steps.push({ agent: step.agent, status: "не реализован", attempts: 0 });
        continue;
      }

      // Возврат предмета переигрывает шаг, пока не исчерпан лимит.
      //
      // Но только если предмет вернул КТО-ТО ДРУГОЙ. Шаг, объявивший свой
      // собственный продукт возвращённым, вынес вердикт: новых данных у него
      // нет, и повтор даст тот же ответ. Легаси описывает возврат между
      // агентами («Людмила принимает ВОР от Денчика»), а не самому себе.
      const selfReturned = result.produced.some(
        (product) => product.status === "returned" && step.produces.includes(product.subject),
      );

      while (
        !selfReturned &&
        attempts <= maxRework &&
        result !== undefined &&
        result.produced.some((product) => product.status === "returned")
      ) {
        for (const product of result.produced) {
          const previous = subjects.get(product.subject);
          subjects.set(product.subject, {
            id: product.subject,
            status: product.status,
            returnedCount:
              (previous?.returnedCount ?? 0) + (product.status === "returned" ? 1 : 0),
          });
        }

        const retry = await ports.runStep(step, subjects);
        if (retry === undefined) break;
        result = retry;
        attempts += 1;
      }

      for (const product of result.produced) {
        const previous = subjects.get(product.subject);
        subjects.set(product.subject, {
          id: product.subject,
          status: product.status,
          returnedCount: (previous?.returnedCount ?? 0) + (product.status === "returned" ? 1 : 0),
        });

        if (product.status === "returned") {
          escalations.push({
            subject: product.subject,
            agent: step.agent,
            reason: selfReturned
              ? `предмет «${product.subject}» возвращён САМ АВТОРОМ: обосновать нечем, ` +
                "повтор даст тот же ответ — требуется решение человека"
              : `предмет «${product.subject}» возвращён на пересчёт ${maxRework} раза подряд — ` +
                "цикл исчерпан, требуется решение человека",
          });
        }
      }

      handoffs.push(...result.handoffs);

      // Возврат ЧУЖОГО предмета: переигрывается шаг АВТОРА, а не текущий —
      // исправлять должен тот, кто делал. После пересчёта текущий шаг тоже
      // повторяется: он работал на данных, которые только что признали
      // негодными.
      //
      // Цикл, а не один проход: повторный прогон может вернуть предмет снова,
      // и это ровно тот случай, ради которого ADR-R-002 ставит лимит.
      let pending = [...(result.returned ?? [])];

      while (pending.length > 0) {
        const returned = pending[0]!;
        const author = authorOf.get(returned.subject);

        if (author === undefined) {
          pending = pending.slice(1);
          continue;
        }

        const used = reworkCount.get(returned.subject) ?? 0;

        subjects.set(returned.subject, {
          id: returned.subject,
          status: "returned",
          returnedCount: used + 1,
        });

        if (used >= maxRework) {
          escalations.push({
            subject: returned.subject,
            agent: author.step.agent,
            returnedBy: step.agent,
            reason:
              `предмет «${returned.subject}» возвращён ${maxRework} раза подряд ` +
              `(${step.agent} → ${author.step.agent}): ${returned.reason}. ` +
              "Цикл исчерпан, требуется решение человека",
          });
          break;
        }

        reworkCount.set(returned.subject, used + 1);

        const redo = await ports.runStep(author.step, subjects);
        if (redo === undefined) break;

        for (const product of redo.produced) {
          subjects.set(product.subject, {
            id: product.subject,
            status: product.status,
            returnedCount: used + 1,
          });
        }
        handoffs.push(...redo.handoffs);

        const authorOutcome = steps.find((outcome) => outcome.agent === author.step.agent);
        if (authorOutcome !== undefined) {
          steps.splice(steps.indexOf(authorOutcome), 1, {
            ...authorOutcome,
            produced: redo.produced,
            attempts: authorOutcome.attempts + 1,
          });
        }

        const again = await ports.runStep(step, subjects);
        if (again === undefined) break;

        result = again;
        attempts += 1;

        for (const product of again.produced) {
          subjects.set(product.subject, {
            id: product.subject,
            status: product.status,
            returnedCount: subjects.get(product.subject)?.returnedCount ?? 0,
          });
        }
        handoffs.push(...again.handoffs);

        pending = [...(again.returned ?? [])];
      }

      steps.push({ agent: step.agent, status: "исполнен", produced: result.produced, attempts });
    }

    outcomes.push({ id: stage.id, name: stage.name, steps });
  }

  return {
    stages: outcomes,
    handoffs,
    escalations,
    subjects: [...subjects.values()],
    blockedSteps,
    unimplementedSteps,
    completed: blockedSteps === 0 && unimplementedSteps === 0 && escalations.length === 0,
  };
}
