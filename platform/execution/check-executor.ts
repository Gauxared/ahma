/**
 * Исполнитель проверки объекта — то, что делает очередь работающей.
 *
 * ЧТО ЭТО ЗАКРЫВАЕТ
 *
 * До него воркер брал задачу и честно отвечал «тип задачи не поддержан»:
 * очередь работала, а выполнять было некому. Теперь проверка, поставленная из
 * веба, действительно выполняется — §5.6 «интерфейс не блокирует пользователя»
 * перестаёт быть намерением.
 *
 * ПОРТЫ ОБЩИЕ С КОМАНДНОЙ СТРОКОЙ
 *
 * Исполнитель не повторяет логику `si check`, а берёт те же порты
 * (`buildCheckPorts`). Две реализации разошлись бы молча: проверка из веба
 * начала бы давать не то, что проверка из командной строки, а обнаружилось бы
 * это на споре о числе в отчёте.
 *
 * РЕЗУЛЬТАТ СОХРАНЯЕТСЯ КАК АРТЕФАКТ, ПРИВЯЗАННЫЙ К ПРОВЕРКЕ
 *
 * Иначе экран объекта показывает, что проверка завершилась, и не может
 * показать чем.
 *
 * СОСТОЯНИЕ ПРОВЕРКИ ОБНОВЛЯЕТСЯ ВМЕСТЕ С АРТЕФАКТОМ
 *
 * У проверки и у задачи очереди — два разных состояния, и они не должны
 * расходиться. Первый прогон показал это на экране буквально: «Статус: queued»
 * рядом с «Очередь: выполнена». Читатель видит два ответа на один вопрос и не
 * знает, какому верить.
 *
 * Состояние задачи отвечает на вопрос «где эта работа в очереди», состояние
 * проверки — «в каком она положении по существу». Второе обязано меняться
 * тогда же, когда появляется результат, и в той же транзакции: иначе между
 * ними образуется окно, в котором артефакт уже есть, а проверка ещё «в
 * очереди».
 */
import { randomUUID } from "node:crypto";

import { checkObject } from "@modules/workflow/check-object.js";
import type { CheckObjectBody, CheckProgress } from "@modules/workflow/check-object.js";

import type { Platform } from "../bootstrap.js";
import { ArtifactRepository } from "../db/artifact-repository.js";
import { ExtractionRepository } from "../db/extraction-repository.js";
import { ModelCallRepository } from "../db/model-call-repository.js";
import { recordAudit } from "../security/audit.js";
import type { Tx } from "../db/prisma.js";

import {
  buildCheckPorts,
  buildObjectReviewers,
  buildReviewers,
  buildScheduleReviewers,
  buildVerdictReviewers,
} from "./check-ports.js";
import { buildAgenticObjectReviewers, buildAgenticReviewers } from "./agentic-reviewers.js";
import { buildCrewReviewers } from "../codex/crew-reviewers.js";
import type { CollectedDuringCheck } from "./check-ports.js";
import type { PreviousEditions } from "./previous-edition.js";
import type { DepthMode } from "@modules/agents/depth-mode.js";
// Реэкспорт, чтобы потребители исполнителя не переписывали импорты. Тем, кому
// нужна только постановка задачи, следует брать их из `check-job.js` напрямую —
// иначе снова потянется весь граф исполнения (см. комментарий там).
export { CHECK_JOB_TYPE, parseCheckPayload, type CheckPayload } from "./check-job.js";
// Реэкспорт не вводит имя в область видимости самого файла — тип нужен ниже.
import type { CheckPayload } from "./check-job.js";

/** Что кладут в задачу очереди типа `check`. */
/** Разбор полезной нагрузки. Кривая задача — отказ с причиной, а не падение. */
export interface CheckExecution {
  readonly body: CheckObjectBody;
  readonly artifactId: string;
}

/** Что дала проверка до записи: результат и то, полной ли она была. */
export interface CheckOutcome {
  readonly body: CheckObjectBody;
  /** Был ли доступен обзор сметчика. Определяет полноту артефакта. */
  readonly agentAvailable: boolean;
  /** Что разбор извлёк: строки и описания документов — для §5.5. */
  readonly collected: CollectedDuringCheck;
  /**
   * Набор агентов был СУЖЕН воркфлоу — то есть это быстрый проход, а не полная
   * Проверка.
   *
   * Отсутствует, когда работали все, кого умеет исполнитель. Заполнено —
   * артефакт обязан объявить сужение и потерять класс полноты `full`
   * (ADR-R-022): сводный вывод §5.3 имеет право нести только полный обход, а
   * прогон на одном агенте полным не является ни в каком смысле.
   */
  readonly narrowing?: { readonly reason: string; readonly excluded: readonly string[] };
}

/**
 * Выполняет проверку и сохраняет результат.
 *
 * ОБЗОР СМЕТЧИКА ВКЛЮЧАЕТСЯ, КОГДА МОДЕЛЬ НАСТРОЕНА
 *
 * Раньше он не включался никогда: порт обзора жил в командной строке, и воркер
 * до него не дотягивался. Пользователь веба получал завершённую проверку, в
 * которой не было главного — девяти агентов, ради которых система и строится.
 *
 * Отсутствие модели при этом НЕ превращает проверку в отказ: детерминированная
 * часть (§12.1а, §12.1б и сверка со сводным расчётом) работает без неё и
 * составляет гейт приёмки. Но и не замалчивается: недостающая способность
 * объявляется деградацией (ADR-R-026), и в артефакте видно, чего в проверке нет.
 *
 * Разница существенна. «Проверка завершена» без обзора и «проверка завершена
 * без обзора, потому что модель не настроена» — это разные утверждения, и
 * первое из них неправда.
 */
export async function computeCheck(input: {
  readonly platform: Platform;
  readonly tenantId: string;
  readonly payload: CheckPayload;
  readonly now: Date;
  /**
   * Режим глубины Проверки (§5.4). «Стандарт», если не задан.
   *
   * Берётся из записи Проверки, а не из настроек сборки: режим выбирают на
   * конкретную Проверку. До этого он принимался, печатался и не влиял ни на что.
   */
  readonly depth?: DepthMode;
  /**
   * Режим прогона: `агентный` — цикл с инструментами, иначе конвейер (Т9.1).
   *
   * Строкой, а не флагом: режимов уже три (`быстрый`, `конвейер`, `агентный`),
   * и флаг «агентный да/нет» пришлось бы менять при появлении четвёртого.
   */
  readonly mode?: string;
  /** Выручка и себестоимость: из договора, а не из смет (чек-лист Ваныча). */
  readonly economics?: { readonly revenue?: string | undefined; readonly costs?: string | undefined };
  /**
   * Куда сообщать ход прогона (Д2): этап, разобранные документы, высказавшиеся
   * агенты. Нет порта — проверка идёт молча, как шла до Д2, и это законный
   * режим: командная строка печатает результат сама.
   */
  readonly progress?: (event: CheckProgress) => Promise<void>;
  /**
   * Продолжать ли обход. Возврат строки означает «остановиться», и строка —
   * причина. Спрашивается на границах тактов (см. `CheckObjectPorts`).
   *
   * Нужен воркеру: потеряв аренду задачи, он обязан прекратить работу, иначе
   * платит за модель второй раз и пишет поверх того, что делает другой.
   */
  readonly stopRequested?: () => string | undefined;
  /**
   * Что роли говорили об этом объекте в прошлый раз (Т9.5, редакции).
   *
   * Читается из базы ВОРКЕРОМ и передаётся сюда готовым: исполнитель прогона
   * работает вне транзакции и в базу не ходит — иначе тридцатиминутный прогон
   * держал бы соединение ради одного запроса.
   *
   * Не задано — прогон идёт первой редакцией, как шёл до этого.
   */
  readonly previous?: PreviousEditions;
  /**
   * Способности, разрешённые воркфлоу Проверки (Д2, «быстрый проход»).
   *
   * Не задано — работают все агенты, каких умеет исполнитель, как было до Д2.
   * Задано — работают только эти, и артефакт обязан сказать, кого не звали:
   * прогон на одном агенте, выглядящий полной Проверкой, хуже отсутствия
   * быстрого прохода.
   */
  readonly only?: ReadonlySet<string>;
}): Promise<CheckOutcome> {
  const now = input.now.toISOString();

  // В режиме `codex` обзор дают не операции конвейера, а экипаж: доступность
  // определяется его настройками, а не регистрацией `run-estimate-review`.
  const agentAvailable =
    input.mode === "codex"
      ? input.platform.codex !== undefined
      : input.platform.operations.definition("run-estimate-review") !== undefined;

  /**
   * Сужение — ОДНОЙ функцией на три списка агентов.
   *
   * Три отдельных фильтра разошлись бы: объектных агентов забыли бы отфильтровать
   * первым же, и «быстрый проход» тихо звал бы шестерых из девяти.
   *
   * Исключённые СОБИРАЮТСЯ по ходу: назвать их можно только здесь, где известно,
   * кого исполнитель вообще умеет строить. Список способностей в другом месте
   * был бы вторым объявлением того же и разошёлся бы с первым.
   */
  const excluded = new Set<string>();

  const narrow = <T extends { readonly capability: string }>(
    build: (collected: CollectedDuringCheck) => readonly T[],
  ): ((collected: CollectedDuringCheck) => readonly T[]) => {
    if (input.only === undefined) return build;
    const only = input.only;

    return (collected) =>
      build(collected).filter((reviewer) => {
        if (only.has(reviewer.capability)) return true;
        excluded.add(reviewer.capability);
        return false;
      });
  };

  const { ports, collected } = buildCheckPorts({
    platform: input.platform,
    tenantId: input.tenantId,
    now,
    ...(input.progress === undefined ? {} : { progress: input.progress }),
    ...(input.stopRequested === undefined ? {} : { stopRequested: input.stopRequested }),
    /**
     * РЕЖИМ РЕШАЕТ, ЧЕМ СМОТРЯТ АГЕНТЫ (Т9.1).
     *
     * `агентный` — цикл с инструментами: агент сам решает, что прочитать.
     * Остальные режимы — конвейер ролевых промптов: один вызов на роль, быстрее
     * и дешевле. Конвейер не заменяется, а остаётся выбором.
     *
     * Синтезные агенты в агентном режиме идут ПО-ПРЕЖНЕМУ конвейером: их
     * предмет — сказанное остальными, и оно уже собрано. Инструменты им дали бы
     * возможность перечитать то, что им и так передано целиком.
     */
    ...(input.mode === "codex" && input.platform.codex !== undefined
      ? /**
         * ЭКИПАЖ НА CODEX SDK — ЧЕТВЁРТЫЙ ПУТЬ, РЯДОМ С ТРЕМЯ (spec-demo-stage-1 §7).
         *
         * Документных рецензентов нет: роли смотрят все сметы объекта из одного
         * треда. Объектные — восемь ролей экипажа, синтезные — Артемий и
         * Тимофей из того же экипажа, а не конвейерные: в образце вердикт
         * выносит тот, кто прошёл такты, а не тот, кому пересказали.
         */
        (() => {
          const crew = buildCrewReviewers({
            platform: input.platform,
            settings: input.platform.codex,
            objectPath: input.payload.objectPath,
            objectCode: input.payload.objectCode,
            now,
            // Прежние редакции ролей по этому объекту (Т9.5): повторный прогон —
            // это редакция 2, а не второй первый взгляд.
            ...(input.previous === undefined ? {} : { previous: input.previous }),
            ...(input.progress === undefined ? {} : { progress: input.progress }),
            ...(input.stopRequested === undefined ? {} : { stopRequested: input.stopRequested }),
          });

          return {
            reviewers: () => [],
            objectReviewers: narrow(crew.objectReviewers),
            synthesisReviewers: narrow(crew.synthesisReviewers),
          };
        })()
      : agentAvailable && input.mode === "agentic"
      ? {
          reviewers: narrow(buildAgenticReviewers(input.platform, input.tenantId, now)),
          objectReviewers: narrow(buildAgenticObjectReviewers(input.platform, input.tenantId, now)),
          synthesisReviewers: (collected) => [
            ...narrow(buildVerdictReviewers(input.platform, input.tenantId, now, input.depth ?? "стандарт"))(collected),
            ...narrow(buildScheduleReviewers(input.platform, input.tenantId, now, input.depth ?? "стандарт"))(collected),
          ],
        }
      : agentAvailable
      ? {
          reviewers: narrow(buildReviewers(input.platform, input.tenantId, now, input.depth ?? "стандарт")),
          // Экономика приходит из договора и паспорта, а не из смет. Веб их
          // пока не собирает — Ваныч честно скажет, чего не хватает.
          objectReviewers: narrow(
            buildObjectReviewers(
              input.platform,
              input.tenantId,
              now,
              input.economics ?? {},
              input.depth ?? "стандарт",
            ),
          ),
          /**
           * Синтезных агентов ДВА, и оба читают одно и то же.
           *
           * Артемий отвечает «брать ли объект», Тимофей — «за сколько он
           * делается». Списки соединяются здесь, а не выбираются: воркфлоу
           * решает, кого звать, сужением по способностям, и подменять это
           * решение выбором в коде значило бы завести вторую истину о составе.
           */
          synthesisReviewers: (collected) => [
            ...narrow(buildVerdictReviewers(input.platform, input.tenantId, now, input.depth ?? "стандарт"))(collected),
            ...narrow(buildScheduleReviewers(input.platform, input.tenantId, now, input.depth ?? "стандарт"))(collected),
          ],
        }
      : {}),
  });

  const body = await checkObject(input.payload.objectPath, ports);

  return {
    body,
    agentAvailable,
    collected,
    // Сужение объявляется только тогда, когда кого-то действительно не позвали.
    // `estimate-only` на сборке без объектных операций никого не исключает — и
    // объявлять сужение было бы неправдой о прогоне.
    ...(excluded.size === 0
      ? {}
      : {
          narrowing: {
            reason: `набор агентов сужен воркфлоу Проверки: работали ${[...(input.only ?? [])].sort().join(", ")}`,
            excluded: [...excluded].sort(),
          },
        }),
  };
}

/**
 * Записывает результат проверки.
 *
 * Транзакция открывается ЗДЕСЬ и живёт секунды. Раньше в ней жила вся проверка
 * целиком: чтение документов с диска и обращения к модели — минуты работы под
 * открытой транзакцией. Комментарий воркера утверждал обратное («проверка идёт
 * вне транзакции сохранения»), и утверждение было неверным.
 */
export async function persistCheck(input: {
  readonly tx: Tx;
  readonly tenantId: string;
  readonly checkId: string;
  readonly outcome: CheckOutcome;
  readonly platform: Platform;
  readonly now: Date;
  /** Объект, к которому относятся документы. Без него версию некуда привязать. */
  readonly objectId?: string;
}): Promise<CheckExecution> {
  const now = input.now.toISOString();
  const { body, agentAvailable, narrowing } = input.outcome;

  // Разбор сохраняется В ТОЙ ЖЕ транзакции, что и артефакт. Отдельная
  // транзакция дала бы окно, в котором проверка завершена, а строк, по которым
  // она сделана, ещё нет: экран §5.5 показал бы результат без оснований.
  //
  // Объект не передан — записывать некуда. Это НЕ отказ: командная строка
  // работает по папке и объекта в базе не заводит, а проверка от этого не
  // становится неверной. Но и молча делать вид, что сохранили, нельзя.
  if (input.objectId !== undefined) {
    await saveExtraction(input.tx, input.tenantId, input.objectId, input.outcome.collected);
  }

  const artifactId = randomUUID();

  await new ArtifactRepository().save(
    input.tx,
    {
      id: artifactId,
      tenantId: input.tenantId,
      operation: { id: "check-object", version: 1 },
      // СУЖЕННЫЙ НАБОР АГЕНТОВ НЕ ДАЁТ КЛАССА `full`, и это не строгость ради
      // строгости: сводный вывод §5.3 имеет право нести только полный обход
      // (ADR-R-022). Быстрый проход на одном агенте — `partial` по определению,
      // и назвать его полным значило бы разрешить ему подменять Проверку.
      completeness: agentAvailable && narrowing === undefined ? "full" : "partial",
      inputHashes: [],
      // Недостающая способность ОБЪЯВЛЯЕТСЯ, а не замалчивается (ADR-R-026):
      // «проверка завершена» и «проверка завершена без обзора, потому что модель
      // не настроена» — разные утверждения, и первое из них неправда.
      degradations: [
        ...(agentAvailable
          ? []
          : [
              {
                capability: "estimate-review",
                reason: "модель не настроена: STROYINTELLECT_MODEL_BASE_URL и MODEL_ID не заданы",
              },
            ]),
        // Не позванный агент объявляется ПОИМЁННО. «Проверка без Ваныча» и
        // «Ваныч не нашёл замечаний» — противоположные утверждения, и артефакт
        // обязан различать их сам, без сверки с воркфлоу.
        ...(narrowing === undefined
          ? []
          : narrowing.excluded.map((capability) => ({ capability, reason: narrowing.reason }))),
      ],
      body,
      producedAt: now,
    } as never,
    [],
    input.checkId,
  );

  // Решения шлюза — в журнал, и в ТОЙ ЖЕ транзакции, что и результат.
  //
  // До этого они копились в памяти и никуда не попадали: §12.1л требует, чтобы
  // обращение к внешним моделям «подтверждалось записями журнала», а
  // подтверждать было нечем. Запись в отдельной транзакции дала бы окно, в
  // котором проверка сохранена, а следа обращения наружу нет.
  for (const decision of input.platform.drainEgressLog()) {
    await recordAudit(
      input.tx,
      input.tenantId,
      {
        action: decision.allowed ? "model.called" : "egress.blocked",
        resourceKind: "egress",
        // Имя хоста, но не путь и не строка запроса: журнал отвечает на вопрос
        // «куда ходили», а не «что именно вынесли».
        resourceId: decision.host,
        reason: decision.reason,
        traceId: input.checkId,
      },
      input.now,
    );
  }

  // Журнал обращений к моделям (§12.1л) — той же транзакцией. Обращение,
  // записанное отдельно от результата, дало бы окно, в котором проверка есть, а
  // подтверждения обращений к моделям нет — а §12.1л проверяется именно ими.
  const journal = new ModelCallRepository();

  for (const call of input.platform.drainModelCalls()) {
    await journal.record(input.tx, input.tenantId, call);
  }

  // Та же транзакция, что и артефакт: окно, в котором результат уже сохранён, а
  // проверка ещё числится в очереди, — это окно, в котором экран врёт.
  // Этап гасится вместе с завершением: «идёт синтез» у завершённого прогона —
  // это застывшая надпись, которая переживёт свою правду. Счётчики документов
  // остаются: они факт обхода, а не признак того, что он идёт.
  await input.tx.check.update({
    where: { id: input.checkId },
    data: { status: "completed", finishedAt: input.now, phase: null },
  });

  return { body, artifactId };
}

/**
 * Сохраняет разобранное: документы, версии, позиции.
 *
 * Позиции группируются ПО ДОКУМЕНТУ: версия принадлежит документу, и строки
 * чужой сметы в неё попасть не должны. Ошибка здесь была бы невидимой —
 * таблица позиций выглядела бы полной, а принадлежала бы не тому файлу.
 */
async function saveExtraction(
  tx: Tx,
  tenantId: string,
  objectId: string,
  collected: CollectedDuringCheck,
): Promise<void> {
  const repository = new ExtractionRepository();

  for (const descriptor of collected.descriptors) {
    const rows = collected.extracted.filter((row) => row.document === descriptor.path);

    await repository.saveExtraction(tx, {
      tenantId,
      objectId,
      document: {
        objectPath: descriptor.path,
        fileName: descriptor.fileName,
        kind: descriptor.kind,
        mimeType: descriptor.mimeType,
        byteSize: descriptor.byteSize,
      },
      contentHash: descriptor.contentHash,
      positions: rows.map((row) => ({
        ordinal: row.ordinal,
        section: row.section,
        sourceName: row.sourceName,
        basis: row.basis,
        unit: row.unit,
        ...(row.quantity === undefined ? {} : { quantity: row.quantity }),
        amount: row.amount,
        sourceRow: row.sourceRow,
        // Уровень доверия и лист едут вместе с позицией (Т11): без них
        // распознанное ролью было бы неотличимо от разобранного формой.
        ...(row.sheet === undefined ? {} : { sheet: row.sheet }),
        ...(row.acquisition === undefined ? {} : { acquisition: row.acquisition }),
      })),
    });
  }
}
