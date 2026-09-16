/**
 * Воркер длительных задач — ТЗ §5.6, роадмап M6.
 *
 * §5.6: «Проверки в режимах "стандарт" и "эксперт" выполняются асинхронно.
 * Интерфейс не блокирует пользователя на время расчёта.»
 *
 * ПОЧЕМУ ВОРКЕР, А НЕ ФОНОВАЯ ЗАДАЧА В ВЕБЕ
 *
 * Веб-запрос не владеет жизненным циклом многочасовой задачи: его убьёт таймаут
 * прокси, перезапуск при выкладке или просто закрытая вкладка. Задача,
 * привязанная к запросу, исчезает вместе с ним — и исчезает молча.
 *
 * ОСТАНОВКА ПО СИГНАЛУ — НЕ ФОРМАЛЬНОСТЬ
 *
 * Воркер, убитый посреди задачи, оставляет её в состоянии running до истечения
 * аренды: пользователь ждёт лишние минуты. Поэтому SIGTERM дорабатывает
 * текущую задачу и не берёт следующую. Выкладка становится тише на время одной
 * задачи вместо тишины на время аренды.
 *
 * ОТМЕНА ПРОВЕРЯЕТСЯ МЕЖДУ ЭТАПАМИ
 *
 * Долгая задача, не спрашивающая об отмене, доведёт до конца работу, которую
 * отменили, и потратит внешний контур на результат, которого никто не ждёт.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { bootstrap } from "@platform/bootstrap.js";
import {
  createLeaseClient,
  createPrismaClient,
  LEASE_TRANSACTION_MAX_WAIT_MS,
  withTenant,
} from "@platform/db/prisma.js";
import { LeaseWatch } from "@platform/queue/lease-watch.js";
import { CheckStopped } from "@modules/workflow/check-object.js";
import {
  CHECK_JOB_TYPE,
  computeCheck,
  parseCheckPayload,
  persistCheck,
} from "@platform/execution/check-executor.js";
import { buildProgressReporter } from "@platform/execution/check-progress.js";
import { loadPreviousEditions } from "@platform/execution/previous-edition.js";
import { capabilitiesOfWorkflow } from "@platform/config/workflow-capabilities.js";
import { JobQueue } from "@platform/queue/job-queue.js";
import type { DepthMode } from "@modules/agents/depth-mode.js";
import { recordAudit } from "@platform/security/audit.js";

// Настройки окружения читаются явно: Node не загружает .env сам, а тихо
// работающая без endpoint сборка выглядит как исправная.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

/**
 * ОДИН ВОРКЕР НА ЭКЗЕМПЛЯР, А НЕ ОДИН НА ДЕРЕВО.
 *
 * ЗАЧЕМ ЗАМОК ВООБЩЕ. 5 сентября 2026 я расплодил воркеры до ВОСЬМИ штук:
 * каждый повторный запуск не проверял, работает ли предыдущий, а старые не
 * всегда умирали от `pkill`. Каждый держит соединение с базой, собранную
 * платформу и читатели книг — по 300 МБ. Вместе с непотушенным сервером
 * разработки и юнит-наборами без потолка форков это довело давление памяти до
 * предела, и `systemd-oomd` убил рабочий стол владельца. Замок стоит против
 * ЭТОГО — против случайного дубля, запущенного человеком, забывшим о первом.
 *
 * ЧТО ЗДЕСЬ БЫЛО НАПИСАНО И БОЛЬШЕ НЕ ВЕРНО. «Второй воркер вреден по
 * существу: два воркера отбирают задачи друг у друга». Это описывало не второй
 * воркер, а ПОТЕРЮ АРЕНДЫ: продление ходило через рабочий пул, не получало
 * соединения за отведённые секунды («Unable to start a transaction in the given
 * time»), аренда истекала — и задачу законно забирал другой воркер, когда
 * деньги на модель уже потрачены. На пакете Нижнего Тагила это стоило шести
 * обращений к модели вместо одного.
 *
 * Обе причины устранены, и каждая держится набором: продление идёт ОТДЕЛЬНЫМ
 * клиентом (`createLeaseClient`, `tooling/worker-lease.test.ts`), потеря аренды
 * ОСТАНАВЛИВАЕТ обход (`LeaseWatch`), а раздача задач проверена против
 * настоящего PostgreSQL — `platform/jobs/job-repository.test.ts`, «SKIP LOCKED:
 * два воркера не берут одну задачу». Владелец сверяется и при записи
 * результата: чужую задачу закрыть нельзя.
 *
 * ЗАЧЕМ ВТОРОЙ ПОТОК НУЖЕН. На проде Проверку ставят до пяти человек, а прогон
 * экипажа идёт до часа. С одним воркером второй человек ждёт не свою работу, и
 * ждёт молча — очередь этого не объясняет.
 *
 * Поэтому замок ПЕР-ЭКЗЕМПЛЯРНЫЙ: номер приходит из
 * `STROYINTELLECT_WORKER_ID` (у службы — `%i` шаблона systemd). Случайный дубль
 * ОДНОГО экземпляра по-прежнему не стартует; законный второй — стартует. Без
 * переменной имя замка прежнее, и на машине разработчика не меняется ничего.
 *
 * Замок — файл с номером процесса В ДЕРЕВЕ ПРОЕКТА. Не в `/tmp`: контейнерный
 * воркер работает со своей базой из своего дерева, и общий замок в системной
 * папке запрещал бы законный запуск. Мёртвый номер замок не держит — иначе
 * упавший воркер запирал бы дерево навсегда.
 */
const НОМЕР_ЭКЗЕМПЛЯРА = process.env["STROYINTELLECT_WORKER_ID"] ?? "";

// Имя файла складывается из этой переменной, поэтому она проверяется, а не
// подставляется: «../../» в номере экземпляра означал бы замок за пределами
// дерева, а пустой замок — двух воркеров, не видящих друг друга.
if (НОМЕР_ЭКЗЕМПЛЯРА !== "" && !/^[A-Za-z0-9_-]{1,16}$/u.test(НОМЕР_ЭКЗЕМПЛЯРА)) {
  throw new Error(
    `STROYINTELLECT_WORKER_ID=${JSON.stringify(НОМЕР_ЭКЗЕМПЛЯРА)} не годится: из него складывается имя замка, ` +
      "поэтому допустимы только буквы, цифры, дефис и подчёркивание — до 16 знаков",
  );
}

const LOCK = join(
  process.cwd(),
  "var",
  НОМЕР_ЭКЗЕМПЛЯРА === "" ? "worker.lock" : `worker-${НОМЕР_ЭКЗЕМПЛЯРА}.lock`,
);

function захватитьЗамок(): void {
  if (existsSync(LOCK)) {
    const прежний = Number.parseInt(readFileSync(LOCK, "utf8").trim(), 10);

    if (Number.isFinite(прежний) && прежний !== process.pid) {
      let живой = false;

      try {
        // Сигнал 0 ничего не посылает: он только спрашивает, есть ли процесс.
        process.kill(прежний, 0);
        живой = true;
      } catch {
        живой = false;
      }

      if (живой) {
        process.stderr.write(
          [
            `Экземпляр «${НОМЕР_ЭКЗЕМПЛЯРА === "" ? "без номера" : НОМЕР_ЭКЗЕМПЛЯРА}» уже работает ` +
              `в этом дереве: pid ${прежний} (${LOCK}).`,
            "Это ДУБЛЬ одного экземпляра: он держит ещё 300 МБ памяти и делит соединения с первым.",
            "Законный второй поток запускается СВОИМ номером: STROYINTELLECT_WORKER_ID=2",
            "Остановить: pnpm стоп",
            "",
          ].join("\n"),
        );
        process.exit(1);
      }
    }
  }

  mkdirSync(join(process.cwd(), "var"), { recursive: true });
  writeFileSync(LOCK, String(process.pid), "utf8");
}

function отпуститьЗамок(): void {
  try {
    // Только СВОЙ замок: за время работы его мог перехватить другой процесс,
    // и снимать чужой значило бы разрешить третьего.
    if (readFileSync(LOCK, "utf8").trim() === String(process.pid)) rmSync(LOCK, { force: true });
  } catch {
    // Замка нет — снимать нечего.
  }
}

захватитьЗамок();
process.on("exit", отпуститьЗамок);

const platform = bootstrap();

/** Срок аренды. Дольше — дольше ждать после падения; короче — чаще heartbeat. */
const LEASE_SECONDS = 60;

/** Пауза, когда очередь пуста. Опрос чаще нагружает базу без выигрыша. */
const IDLE_MS = 2_000;

// Владелец аренды — он же имя в журнале. Номер экземпляра входит в него
// намеренно: когда потоков два, вопрос «кто ведёт эту задачу» задаётся при
// первом же разборе, а номер процесса на него не отвечает.
const OWNER =
  НОМЕР_ЭКЗЕМПЛЯРА === ""
    ? `${hostname()}#${process.pid}`
    : `${hostname()}/${НОМЕР_ЭКЗЕМПЛЯРА}#${process.pid}`;

let stopping = false;

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (stopping) {
      // Второй сигнал — «хватит ждать»: человек уже попросил один раз.
      process.exit(1);
    }
    stopping = true;
    console.log(`Воркер ${OWNER}: получен ${signal}, дорабатываю текущую задачу.`);
  });
}

/**
 * Арендатор задачи неизвестен до её захвата, а захват идёт под контекстом
 * арендатора — тот же замкнутый круг, что был со входом и сессией.
 *
 * Здесь он разрывается иначе: воркер обслуживает арендаторов по очереди,
 * спрашивая каждого. Список арендаторов — не арендуемые данные, и читается он
 * без контекста.
 */
async function tenantsWithWork(db: ReturnType<typeof createPrismaClient>): Promise<string[]> {
  const rows = await db.tenant.findMany({ select: { id: true } });
  return rows.map((row) => row.id);
}

/**
 * Продлевает аренду, пока идёт работа, и ЗНАЕТ, когда она потеряна.
 *
 * Продление в ОТДЕЛЬНОЙ транзакции и по таймеру: сама работа — один длинный
 * await, спросить её «ты ещё жива» изнутри нельзя.
 *
 * ЧТО ЗДЕСЬ ИЗМЕНИЛОСЬ И ПОЧЕМУ.
 *
 * Раньше неудача продления писала строку в журнал, и работа шла дальше — с
 * оговоркой «результат всё равно не запишется, `complete` проверяет владельца».
 * Оговорка верна лишь наполовину: строку задачи чужой воркер действительно
 * защищает, но ДЕНЬГИ на модель мы к тому моменту уже потратили, а ход прогона
 * писали поверх чужого. На пакете Нижнего Тагила это 166 обращений к модели за
 * один прогон.
 *
 * Теперь неудачи считаются (`LeaseWatch`), и когда аренда не подтверждалась
 * дольше собственного срока, работа ОСТАНАВЛИВАЕТСЯ через порт обхода: снаружи
 * её не прервать, но обход спрашивает об этом на границе каждого такта.
 */
async function withHeartbeat<T>(
  leaseDb: ReturnType<typeof createPrismaClient>,
  queue: JobQueue,
  tenantId: string,
  jobId: string,
  work: (аренда: LeaseWatch) => Promise<T>,
): Promise<T> {
  // Треть срока: два пропущенных продления подряд ещё не теряют аренду.
  const периодСекунд = LEASE_SECONDS / 3;
  const аренда = new LeaseWatch({ leaseSeconds: LEASE_SECONDS, everySeconds: периодСекунд });

  let сообщалиОПотере = false;

  const timer = setInterval(() => {
    const начало = Date.now();

    void withTenant(
      leaseDb,
      tenantId,
      (tx) => queue.heartbeat(tx, jobId, { owner: OWNER, now: new Date(), leaseSeconds: LEASE_SECONDS }),
      // Бюджет ожидания задан ЯВНО: умолчание в две секунды рвалось под
      // нагрузкой обхода, а ждать продлению можно почти весь свой период.
      { maxWaitMs: LEASE_TRANSACTION_MAX_WAIT_MS },
    )
      .then((held) => {
        if (held) {
          аренда.подтверждена();
          return;
        }

        // Ответ базы «строка не твоя» — факт, а не подозрение.
        аренда.отобрана();
      })
      .catch((cause: unknown) => {
        // Длительность попытки различает «пул занят» и «упало сразу»: см.
        // пояснение в `LeaseWatch.неудача`.
        аренда.неудача(String(cause), Date.now() - начало);
      })
      .finally(() => {
        const состояние = аренда.состояние();

        // О ПОТЕРЕ ГОВОРИТСЯ ОДИН РАЗ. Повторять её каждые двадцать секунд —
        // значит утопить в шуме то единственное сообщение, ради которого всё.
        if (состояние.kind === "потеряна" && !сообщалиОПотере) {
          сообщалиОПотере = true;
          console.error(
            `Воркер ${OWNER}: АРЕНДА ЗАДАЧИ ${jobId} ПОТЕРЯНА — ${состояние.reason}. ` +
              "Работа останавливается на ближайшей границе такта: задачу ведёт другой воркер.",
          );
          return;
        }

        if (состояние.kind === "под вопросом") {
          console.error(`Воркер ${OWNER}: продление аренды ${jobId} не удалось — ${состояние.reason}`);
        }
      });
  }, периодСекунд * 1000);

  try {
    return await work(аренда);
  } finally {
    clearInterval(timer);
  }
}

/**
 * Режим записи Проверки в режим глубины ответа (§5.4).
 *
 * Имена различаются намеренно: в базе латиница перечислением, в предметной
 * области — русские слова из ТЗ. Приводить базу к русским именам значило бы
 * тащить кодировку в перечисление, а домен к латинице — терять язык договора.
 */
function depthOf(mode: string | undefined): DepthMode {
  if (mode === "express") return "экспресс";
  // Агентный режим идёт стандартной глубиной: глубина — контракт на ФОРМУ
  // ответа, и менять её вместе со способом добычи материала значило бы
  // смешать два разных решения в одном слове.
  if (mode === "agentic") return "стандарт";
  // Экипаж на Codex SDK — та же стандартная глубина, по той же причине.
  if (mode === "codex") return "стандарт";
  if (mode === "expert") return "эксперт";

  return "стандарт";
}

async function runOnce(
  db: ReturnType<typeof createPrismaClient>,
  leaseDb: ReturnType<typeof createPrismaClient>,
  queue: JobQueue,
): Promise<boolean> {
  const now = new Date();

  for (const tenantId of await tenantsWithWork(db)) {
    const job = await withTenant(db, tenantId, (tx) =>
      queue.claim(tx, { owner: OWNER, now, leaseSeconds: LEASE_SECONDS }),
    );

    if (job === undefined) continue;

    console.log(`Воркер ${OWNER}: взял задачу ${job.type} (${job.id}), попытка ${job.attempts}.`);

    try {
      // Отмена проверяется ПЕРЕД работой: между постановкой и захватом мог
      // пройти час, и за этот час её могли отменить.
      const cancelled = await withTenant(db, tenantId, (tx) => queue.cancelRequested(tx, job.id));

      if (cancelled) {
        console.log(`Воркер ${OWNER}: задача ${job.id} отменена, работа не начата.`);
        return true;
      }

      if (job.type !== CHECK_JOB_TYPE) {
        // Неизвестный тип — отказ с причиной, а не молчаливое «выполнено».
        await withTenant(db, tenantId, (tx) =>
          queue.fail(tx, job.id, {
            owner: OWNER,
            now: new Date(),
            error: `тип задачи «${job.type}» воркером не поддержан: исполнитель не зарегистрирован`,
          }),
        );
        return true;
      }

      const payload = parseCheckPayload(job.payload);

      // Проверка идёт ВНЕ транзакции: она читает документы с диска и обращается
      // к модели — минуты работы. Раньше это утверждал только комментарий:
      // `withTenant` открывает транзакцию, и вся проверка шла внутри неё.
      //
      // Аренда при этом продлевается ПОКА ИДЁТ РАБОТА. Без продления соседний
      // воркер забирал задачу по истечении шестидесяти секунд и начинал ту же
      // проверку заново: на настоящем прогоне модель позвали шесть раз вместо
      // одного. Именно это очередь и должна была предотвращать.
      // Режим глубины берётся из записи Проверки (§5.4). Веб сегодня пишет
      // `standard`; когда там появится выбор, этот путь подхватит его сам.
      const checkId = job.checkId ?? job.id;

      const requested = await withTenant(db, tenantId, (tx) =>
        tx.check.findUnique({ where: { id: checkId }, select: { mode: true, workflowId: true, objectId: true } }),
      );

      /**
       * ПОВТОРНЫЙ ПРОГОН ОБЪЕКТА — РЕДАКЦИЯ, А НЕ ВТОРОЙ ПЕРВЫЙ ВЗГЛЯД (Т9.5).
       *
       * Прежние заключения ролей поднимаются ЗДЕСЬ, до прогона: исполнитель
       * работает вне транзакции и в базу не ходит. Сбой чтения не отменяет
       * прогон — он отменяет память: объект будет разобран как впервые, и об
       * этом сказано вслух, а не молча.
       */
      const previous = await (async () => {
        if (requested?.objectId === undefined) return undefined;

        try {
          const editions = await loadPreviousEditions({
            db,
            tenantId,
            objectId: requested.objectId,
            exceptCheckId: checkId,
          });
          if (editions.edition > 1) {
            console.log(
              `Воркер ${OWNER}: прогон ${checkId} — редакция ${editions.edition}; прежние заключения есть у ${editions.roles.length} ролей.`,
            );
          }
          return editions;
        } catch (cause) {
          console.error(
            `Воркер ${OWNER}: прежние редакции объекта не прочитаны — ${(cause as Error).message}. ` +
              "Прогон пойдёт как первый: роли не увидят своих прошлых заключений.",
          );
          return undefined;
        }
      })();

      /**
       * КОГО ЗВАТЬ — РЕШАЕТ ВОРКФЛОУ ПРОВЕРКИ, а не исполнитель.
       *
       * До Д2 воркфлоу влиял только на порядок тактов на экране: агентов
       * строили всех, каких умеет сборка, и `estimate-only` давал ровно тот же
       * прогон, что `full-check`. Быстрый проход — это и есть `estimate-only`,
       * то есть объявленное сужение данными.
       *
       * Причина печатается ВСЕГДА, включая «сужать не стали»: молчание не
       * позволило бы отличить полный прогон от прогона, который не сузился из-за
       * нечитаемой конфигурации.
       */
      const allowed = capabilitiesOfWorkflow(requested?.workflowId ?? "full-check");
      console.log(`Воркер ${OWNER}: состав агентов — ${allowed.reason}.`);

      if (allowed.unknownAgents.length > 0) {
        console.error(
          `Воркер ${OWNER}: агенты воркфлоу «${requested?.workflowId}» неизвестны реестру — ` +
            `${allowed.unknownAgents.join(", ")}. Их шаги в прогоне не участвуют.`,
        );
      }

      // ПРОГОН ОБЪЯВЛЯЕТ СЕБЯ ИДУЩИМ, И ДО Д2 ЭТОГО НЕ ДЕЛАЛ НИКТО.
      //
      // Статус Проверки ставился один раз — `completed` в конце. Все тридцать
      // шесть минут экран показывал «в очереди», то есть неправду: работа шла.
      // Разница не косметическая: «в очереди» читается как «воркер не взял», и
      // человек идёт проверять воркер вместо того, чтобы ждать.
      await withTenant(db, tenantId, (tx) =>
        tx.check.update({
          where: { id: checkId },
          data: { status: "running", startedAt: new Date() },
        }),
      );

      const execution = await withHeartbeat(leaseDb, queue, tenantId, job.id, (аренда) =>
        computeCheck({
          platform,
          tenantId,
          payload,
          now: new Date(),
          depth: depthOf(requested?.mode),
          // Режим передаётся как есть: исполнитель сам решает, чем смотреть —
          // циклом с инструментами или конвейером (Т9.1).
          ...(requested?.mode === undefined || requested.mode === null ? {} : { mode: requested.mode }),
          ...(allowed.narrowed ? { only: allowed.allowed } : {}),
          // Память между прогонами: роль продолжит свой тред и увидит прежнюю
          // редакцию во вводной.
          ...(previous === undefined ? {} : { previous }),
          // Ход прогона пишется по ходу, каждое событие своей транзакцией:
          // находки сметчика с пятой минуты не должны ждать тридцать шестой.
          progress: buildProgressReporter({ db, tenantId, checkId }),
          // Обход спрашивает об остановке на границе каждого такта: снаружи
          // его не прервать, `work()` в Node не прерывается.
          stopRequested: () => аренда.причинаОстановки(),
        }),
      );

      // Недоставленные отчёты о ходе — вслух. Экран, разошедшийся с фактом,
      // объясняется этой строкой, а не догадкой.
      if (execution.body.progressLost !== undefined) {
        console.error(
          `Воркер ${OWNER}: ход прогона ${checkId} записан не полностью — ` +
            execution.body.progressLost.join("; "),
        );
      }

      await withTenant(db, tenantId, async (tx) => {
        // Объект берётся из самой Проверки, а не из полезной нагрузки: в
        // нагрузке лежит ПУТЬ, а привязывать версии документов надо к записи
        // объекта в базе.
        const check = await tx.check.findUnique({
          where: { id: checkId },
          select: { objectId: true },
        });

        await persistCheck({
          tx,
          platform,
          tenantId,
          ...(check === null ? {} : { objectId: check.objectId }),
          checkId,
          outcome: execution,
          now: new Date(),
        });

        await queue.complete(tx, job.id, { owner: OWNER, now: new Date() });

        await recordAudit(tx, tenantId, {
          action: "check.finished",
          resourceKind: "check",
          resourceId: job.checkId ?? job.id,
          reason:
            `вердикт «${execution.body.verdict}»; ` +
            `смет проверено ${execution.body.totals.checked}, позиций ${execution.body.totals.positions}`,
        });
      });

      console.log(
        `Воркер ${OWNER}: проверка ${payload.objectCode} завершена — ` +
          `${execution.body.verdict}, смет ${execution.body.totals.checked}, ` +
          `позиций ${execution.body.totals.positions}.`,
      );
    } catch (cause) {
      const message = (cause as Error).message;

      /**
       * ОСТАНОВКА — НЕ ОТКАЗ, и путать их нельзя.
       *
       * Обход прекращён потому, что аренду задачи ведёт уже другой воркер.
       * Записать это как неудачу значило бы: увеличить счётчик попыток чужой
       * задачи, вернуть её в очередь с отсрочкой и объявить Проверку упавшей —
       * притом что в эту минуту её нормально доводит до конца кто-то ещё.
       *
       * Наши записи владельца всё равно не пройдут (`fail` сверяет `leaseOwner`),
       * но пытаться не нужно: попытка без права — это шум в журнале, из-за
       * которого не видно настоящих отказов.
       */
      if (cause instanceof CheckStopped) {
        console.error(
          `Воркер ${OWNER}: работа над задачей ${job.id} ПРЕКРАЩЕНА — ${cause.reason}. ` +
            "Задача не помечается неудачной: её ведёт другой воркер.",
        );
        return true;
      }

      // Отказ ПЕЧАТАЕТСЯ, а не только записывается в задачу. Молчаливый catch
      // стоил часа разбирательства: в журнале контейнера было пять попыток
      // подряд и ни слова о причине, а причина лежала в поле lastError, куда
      // никто не смотрит, пока не заподозрит неладное.
      console.error(`Воркер ${OWNER}: задача ${job.id} не выполнена — ${message}`);

      await withTenant(db, tenantId, async (tx) => {
        const outcome = await queue.fail(tx, job.id, {
          owner: OWNER,
          now: new Date(),
          error: message,
        });

        // СОСТОЯНИЕ ПРОВЕРКИ ИДЁТ ЗА СОСТОЯНИЕМ ЗАДАЧИ, А НЕ ЗАСТЫВАЕТ.
        //
        // До Д2 упавший прогон оставался «в очереди» навсегда: статус ставился
        // только на успехе. Экран сообщал «ждёт воркера» про работу, которая
        // уже провалилась пять раз, — то есть предлагал ждать вечно.
        //
        // Попытки не исчерпаны — Проверка снова «в очереди», и это правда:
        // задача вернулась в очередь с отсрочкой. Исчерпаны — `failed`.
        if (outcome === "dead" || outcome === "queued") {
          await tx.check.update({
            where: { id: job.checkId ?? job.id },
            data:
              outcome === "dead"
                ? { status: "failed", finishedAt: new Date(), phase: null }
                : { status: "queued", phase: null },
          });
        }
      });
    }

    return true;
  }

  return false;
}

async function main(): Promise<void> {
  console.log(
    `Воркер СтройИнтеллект ${OWNER}: профиль ${platform.profile}, ` +
      `источников знания ${platform.extensions.ids("knowledge-source").length}, ` +
      `операций ${platform.operations.ids().length}.`,
  );

  const db = createPrismaClient(process.env["DATABASE_URL"]);

  /**
   * ОТДЕЛЬНОЕ СОЕДИНЕНИЕ ПОД ПРОДЛЕНИЕ АРЕНДЫ.
   *
   * НАЙДЕНО В ЖУРНАЛЕ ЖИВЫХ ПРОГОНОВ: при каждой проверке объекта повторялось
   * «продление аренды не удалось — Unable to start a transaction in the given
   * time». Это не сбой базы: обход держит десятки транзакций (запись хода,
   * журнал обращений к модели, разбор), пул общий, и продлению — одному
   * короткому UPDATE — не достаётся соединения за отведённые ему секунды.
   *
   * Проигрывает при этом самое важное: аренда — единственное, что мешает
   * второму воркеру взять ту же проверку.
   *
   * Свой клиент с пулом на одно соединение эту гонку убирает целиком: работа
   * физически не может занять то, чего у неё нет.
   */
  const leaseDb = createLeaseClient(process.env["DATABASE_URL"]);
  const queue = new JobQueue();

  try {
    while (!stopping) {
      const worked = await runOnce(db, leaseDb, queue);

      if (!worked) {
        await new Promise((resolve) => setTimeout(resolve, IDLE_MS));
      }
    }
  } finally {
    await db.$disconnect();
    await leaseDb.$disconnect();
    console.log(`Воркер ${OWNER}: остановлен.`);
  }
}

await main();
