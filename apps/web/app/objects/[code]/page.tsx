/**
 * Карточка объекта — экран §5.5 (2), поверхность `S-02`.
 *
 * ПОКАЗЫВАЕТСЯ ТО, ЧТО ЕСТЬ, И НАЗЫВАЕТСЯ ТО, ЧЕГО НЕТ
 *
 * Параметров финансирования и типа продукта §5.5 в модели данных нет.
 * Нарисовать для них пустые поля значило бы обещать раздел, которого не
 * существует; промолчать — скрыть, что экран неполон относительно договора.
 * Поэтому недостающее названо прямо на странице, а не в задачнике.
 */
import { notFound } from "next/navigation";

import { currentViewer } from "@web/lib/actor";
import { shellOf } from "@web/src/app-shell/shell.js";
import { readObject } from "@web/lib/read-model";
import type { ObjectCard } from "@web/lib/read-model";
import { listBatches } from "@web/lib/uploads";
import { AutoRefresh } from "@web/src/ui/auto-refresh.js";
import { Button, ButtonLink } from "@web/src/ui/kit/button.js";
import { Callout } from "@web/src/ui/kit/callout.js";
import { Card, CardBody, CardHead } from "@web/src/ui/kit/card.js";
import { ObjectHead } from "@web/src/ui/command/object-head.js";
import { Page } from "@web/src/ui/kit/page.js";
import { Pill, type PillTone } from "@web/src/ui/kit/pill.js";
import { StateDenied, StateEmpty, StateFailed } from "@web/src/ui/kit/states.js";
import { DataTable, type Column } from "@web/src/ui/kit/table.js";
import { plural, СЛОВО } from "@web/src/ui/value/format.js";

export const dynamic = "force-dynamic";

type CheckRow = ObjectCard["checks"][number];
type DocumentRow = ObjectCard["documents"][number];

function formatDate(value: Date | null): string {
  return value === null ? "—" : value.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Прогонов на страницу.
 *
 * Двенадцать — как у партий загрузки: та же таблица со строкой-действием, и
 * разные числа в двух похожих перечнях читались бы как разница по смыслу.
 */
const CHECKS_PER_PAGE = 12;

/**
 * Страница берётся из адреса, а не из состояния браузера.
 *
 * Та же причина, что в журнале: вторая страница обязана открываться по ссылке,
 * иначе её нельзя ни прислать, ни вернуть кнопкой «назад». Нечисловое значение
 * — испорченная ссылка, а не ошибка ввода: показывается первая страница.
 */
function pageFrom(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

const JOB: Readonly<Record<string, { readonly label: string; readonly tone: PillTone }>> = {
  queued: { label: "в очереди", tone: "plain" },
  running: { label: "выполняется", tone: "info" },
  completed: { label: "выполнена", tone: "ok" },
  failed: { label: "сбой", tone: "danger" },
  dead: { label: "не удалась", tone: "danger" },
  cancelled: { label: "отменена", tone: "plain" },
};

const DOCUMENT_COLUMNS: readonly Column<DocumentRow>[] = [
  { key: "name", title: "Документ", render: (row) => <span className="cell-title">{row.name}</span> },
  { key: "kind", title: "Вид", width: "28%", render: (row) => <span className="text-[var(--text-2)]">{row.kind}</span> },
];

function checkColumns(code: string, canStart: boolean): readonly Column<CheckRow>[] {
  return [
    {
      key: "route",
      title: "Маршрут",
      render: (row) => (
        // Без ссылки рабочий экран существует, но недостижим — а недостижимый
        // экран не отличается от отсутствующего.
        <>
          <a className="cell-title" href={`/objects/${encodeURIComponent(code)}/checks/${row.id}`}>
            {row.workflowId}
          </a>
          <span className="cell-sub">{`${row.mode} · полнота ${row.completeness}`}</span>
        </>
      ),
    },
    {
      key: "started",
      title: "Начата",
      numeric: true,
      width: "18%",
      render: (row) => <span className="num text-[var(--text-2)]">{formatDate(row.createdAt)}</span>,
    },
    {
      key: "job",
      title: "Очередь",
      width: "22%",
      render: (row) => {
        if (row.job === null) return <span className="meta">задача не поставлена</span>;
        const view = JOB[row.job.status] ?? { label: row.job.status, tone: "plain" as PillTone };
        const alive = row.job.status === "queued" || row.job.status === "running";

        return (
          <>
            <Pill
              dot={view.tone !== "danger"}
              label={view.label + (row.job.attempts > 1 ? ` · попыток ${row.job.attempts}` : "")}
              loud={view.tone === "danger"}
              tone={view.tone}
            />
            {row.job.lastError === null || row.job.lastError === undefined ? null : (
              <span className="cell-sub">{row.job.lastError}</span>
            )}
            {/* Отмена показывается только у живой задачи: кнопка, отменяющая
                выполненное, обещает то, чего очередь не делает — отмена
                сделанного была бы переписыванием истории. */}
            {alive && canStart ? (
              <form action="/api/checks/cancel" className="mt-1.5" method="post">
                <input name="jobId" type="hidden" value={row.job.id} />
                <input name="objectCode" type="hidden" value={code} />
                <Button size="sm" type="submit" variant="outline">
                  Отменить
                </Button>
              </form>
            ) : null}
          </>
        );
      },
    },
    {
      key: "verdict",
      title: "Вердикт",
      width: "24%",
      render: (row) => (
        <>
          <span className="cell-title">{row.verdict ?? "—"}</span>
          {row.summary === null ? null : <span className="cell-sub">{row.summary}</span>}
        </>
      ),
    },
  ];
}

export default async function ObjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ поставлено?: string; отмена?: string; причина?: string; страница?: string; прогонов?: string }>;
}) {
  const { code } = await params;
  const { поставлено, отмена, причина, страница, прогонов } = await searchParams;
  const result = await currentViewer();

  if (result.kind === "гость") {
    return (
      <Page wide>
        <Card>
          <CardBody>
            <StateDenied permission="check:read" reason={`${result.reason}.`}>
              <a href="/login">Войти</a>
            </StateDenied>
          </CardBody>
        </Card>
      </Page>
    );
  }

  // Путь берётся из адреса, а не из прочитанной карточки: он нужен и в тех
  // ветвях, где карточку прочитать не удалось, — отказ по праву и сбой чтения
  // тоже происходят на конкретном объекте.
  const shell = shellOf("S-02", result.viewer, [{ label: decodeURIComponent(code) }], decodeURIComponent(code));
  const decision = result.viewer.can("check:read", { kind: "object", id: code });
  const canStart = result.viewer.can("check:start").allowed;

  if (!decision.allowed) {
    return shell(
      <Page wide>
        <Card>
          <CardBody>
            <StateDenied permission="check:read" reason={decision.reason} />
          </CardBody>
        </Card>
      </Page>,
    );
  }

  let card: ObjectCard | undefined;
  let failure: string | undefined;

  try {
    card = await readObject(result.viewer.actor.tenantId, decodeURIComponent(code));
  } catch (error) {
    failure = (error as Error).message;
  }

  if (failure !== undefined) {
    return shell(
      <Page wide>
        <Card>
          <CardBody>
            <StateFailed>{failure}</StateFailed>
          </CardBody>
        </Card>
      </Page>,
    );
  }

  if (card === undefined) notFound();

  /**
   * ЗАГРУЖЕННОЕ И РАЗОБРАННОЕ — РАЗНЫЕ ВЕЩИ, И ЭКРАН ОБЯЗАН ИХ РАЗЛИЧАТЬ.
   *
   * Пройдено руками: загрузил семь файлов двумя партиями, открыл карточку — и
   * прочитал «К объекту не загружено ни одного файла». Утверждение ложное:
   * файлы лежат в партиях, а документами они становятся только после обхода.
   * На встрече клиент прочтёт это как «загрузка не сработала».
   *
   * Партии читаются с диска — это тот же вызов, которым живёт экран загрузки,
   * и второго источника правды он не заводит.
   */
  const batches = await listBatches(result.viewer.actor.tenantId, decodeURIComponent(code));
  const uploaded = batches.reduce((sum, batch) => sum + batch.files, 0);

  return shell(
    <Page wide>
      <ObjectHead
        active="паспорт"
        code={card.code}
        counts={{ документы: card.documents.length, проверка: card.checks.length }}
        name={card.name}
        note={`Шифр ${card.code} · регион ${card.region ?? "не указан"}`}
      />

      {отмена === undefined ? null : (
        <Callout title={отмена === "да" ? "Задача отменена" : "Отменить не удалось"} tone={отмена === "да" ? "info" : "warn"}>
          {отмена === "да"
            ? "Воркер увидит отмену на ближайшем ударе сердца и остановится; уже сохранённое не откатывается."
            : (причина ?? "причина не названа")}
        </Callout>
      )}

      {/* ОБЪЯСНЕНИЕ ОТКАЗА ОТСТАЛО ОТ ПРАВИЛА НА ОДНУ ВЕРСИЮ.
          Здесь стояло «уже стоит в очереди НА СЕГОДНЯ» — формулировка второго,
          отброшенного правила, которое считало повтором любой прогон за сутки.
          Правило давно другое: повтором считается ЖИВАЯ задача — стоящая в
          очереди или выполняющаяся (`app/api/checks/route.ts`), а завершённый
          прогон новый не запрещает. Сообщение осталось прежним, и система
          объясняла отказ неправдой: висящая с вечера задача давала «на
          сегодня», а сегодняшний завершённый прогон ничего не блокировал.
          Комментарий в обработчике прямо называл эту ошибку исправленной — и
          она была исправлена в правиле, но не в словах. */}
      {/* Перенаправление с `/checks/latest` объясняет себя.
          Без этой врезки «открыть последнюю Проверку» на объекте без прогонов
          просто возвращало бы на карточку — и выглядело бы как нажатие, которое
          ничего не сделало. */}
      {прогонов === "нет" ? (
        <Callout title="Прогонов по объекту не было" tone="info">
          Открыть последнюю Проверку не удалось: её ещё не запускали. Загрузите документы и запустите первый прогон.
        </Callout>
      ) : null}

      {поставлено === undefined ? null : (
        <Callout title="Постановка в очередь" tone={поставлено === "повтор" ? "warn" : "info"}>
          {поставлено === "повтор"
            ? "По этому объекту уже есть живая Проверка ТОГО ЖЕ вида — она стоит в очереди или выполняется, и второй такой же не создано. Её состояние видно в истории ниже; завершённая Проверка новую не запрещает, а прогон другого вида (быстрый рядом с полным) разрешён."
            : поставлено === "в-очередь"
              ? "Проверка поставлена, но начнётся не сразу: по этому объекту уже идёт другой прогон, а воркер один и берёт задачи по очереди. Пока идёт первый, второй числится «в очереди» — это правда о нём, а не задержка экрана."
              : "Проверка поставлена в очередь. Обновите страницу, чтобы увидеть состояние."}
        </Callout>
      )}

      <section className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card>
          {/* Заголовок — ссылка на разбор: карточка показывает, ЧТО привязано,
              а экран разбора — что из этого извлечено. Раньше карточка была
              тупиком: список файлов без входа в позиции. */}
          <CardHead
            aside={
              <a className="font-semibold" href={`/objects/${encodeURIComponent(card.code)}/documents`}>
                разбор и позиции →
              </a>
            }
            title="Документы"
          >
            <span className="meta">{`${card.documents.length} шт.`}</span>
          </CardHead>
          <CardBody flush>
            <DataTable
              caption="Документы, привязанные к объекту"
              columns={DOCUMENT_COLUMNS}
              empty={
                uploaded === 0 ? (
                  <StateEmpty title="Документы не привязаны">К объекту не загружено ни одного файла.</StateEmpty>
                ) : (
                  <StateEmpty title="Файлы загружены, обход их ещё не читал">
                    {`В партиях лежит ${plural(uploaded, СЛОВО.файл)}. Документами они станут после прогона: он обходит папку, `}
                    {"определяет формат каждого файла и разбирает сметы в позиции."}
                  </StateEmpty>
                )
              }
              rowKey={(row) => row.name}
              rows={card.documents}
            />
          </CardBody>
        </Card>

        {canStart ? (
          <Card>
            <CardHead aside="шаг 2 тракта" title="Загрузить документы и проверить" />
            <CardBody>
              {/* ЗДЕСЬ БЫЛО ПОЛЕ «ПАПКА ОБЪЕКТА», И ОНО БЫЛО НЕВЕРНО ДВАЖДЫ.
                  По существу: браузер называл серверу каталог файловой системы,
                  который тому предписывалось прочитать. По смыслу: загрузки
                  документов в системе не было вовсе, а без неё нельзя ни
                  показать продукт, ни получить результат — файлы нечем дать.
                  Прогон переехал на экран загрузки, где он идёт по партии. */}
              <p className="m-0 text-[var(--t-body)]">
                Файлы объекта загружаются партией; прогон идёт по выбранной партии, а не по последним файлам.
              </p>
              <ButtonLink
                className="mt-3"
                href={`/objects/${encodeURIComponent(card.code)}/upload`}
                variant="primary"
              >
                Загрузка и прогон
              </ButtonLink>
            </CardBody>
          </Card>
        ) : null}
      </section>

      <Card>
        <CardHead aside="маршрут ведёт на рабочий экран" title="История проверок">
          <AutoRefresh
            active={card.checks.some((check) => check.job?.status === "queued" || check.job?.status === "running")}
          />
        </CardHead>
        <CardBody flush>
          <DataTable
            caption="История проверок объекта: маршрут, время, состояние очереди и вердикт"
            columns={checkColumns(card.code, canStart)}
            empty={<StateEmpty title="Проверок по объекту не было">Запустите первую — форма рядом.</StateEmpty>}
            /**
             * Разбивка нужна не «на будущее».
             *
             * Замерено: к концу дня работы по объекту стало 24 прогона, и
             * карточка объекта — самый тяжёлый экран продукта — перестала
             * укладываться в тридцать секунд у трёх наборов подряд. Каждая
             * строка несёт форму отмены, то есть это не просто текст.
             *
             * История прогонов растёт всегда и никогда не убывает: без
             * разбивки экран деградирует у любого работающего клиента, просто
             * не в первый месяц.
             */
            paging={{
              page: pageFrom(страница),
              pageSize: CHECKS_PER_PAGE,
              hrefFor: (page) =>
                `/objects/${encodeURIComponent(card.code)}?${new URLSearchParams({ страница: String(page) }).toString()}`,
            }}
            rowKey={(row) => row.id}
            rows={card.checks}
          />
        </CardBody>
      </Card>

      {/* Объяснение отсутствия — ПОСЛЕ данных, а не перед ними.
          Стоя первой врезкой, оно перекрикивало сам объект: пользователь
          открывал карточку и первым делом читал, чего в ней нет. Порядок
          чтения теперь честный — сначала объект, потом оговорка о его
          полноте. */}
      <Callout title="Паспорт неполон относительно §5.5" tone="info">
        Параметров финансирования и типа продукта в модели данных ещё нет. Раздел не показан, а не пуст: пустые поля
        обещали бы данные, которых система не хранит.
      </Callout>
    </Page>,
  );
}
