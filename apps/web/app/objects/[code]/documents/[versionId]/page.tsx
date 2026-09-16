/**
 * Позиции одной версии документа — вторая половина экрана §5.5 (3).
 *
 * ЗДЕСЬ ПРОВЕНАНС НАСТОЯЩИЙ
 *
 * На всех прочих экранах результата число приходится сопровождать оговоркой:
 * ядро отдаёт суммы прозой внутри `detail`, и раскрыть их происхождение можно
 * только выдумав его (`Ф-22`). Здесь выдумывать нечего — у каждой позиции есть
 * `sourceRow`, строка исходного листа, и раскрытие показывает именно её.
 *
 * Поэтому этот экран — первый, на котором инвариант §12.1д выполняется без
 * оговорок, и единственный, где раскрытие можно проверить сверкой с файлом.
 *
 * ДВЕ ТЫСЯЧИ ПОЗИЦИЙ ОСТАЮТСЯ РАБОТОСПОСОБНЫМИ (§20)
 *
 * Страница нарезается `paginate` — той же функцией, что проверена тестом на
 * двух тысячах строк. Сводка над таблицей при этом считается по ВСЕЙ версии, а
 * не по показанной странице: «без шифра 3» — утверждение о смете, и посчитать
 * его по первым пятидесяти строкам значило бы соврать в числе, ради которого
 * экран открыт.
 */
import { notFound } from "next/navigation";

import { currentViewer } from "@web/lib/actor";
import { readVersion, type PositionView, type RevisionView, type VersionCard } from "@web/lib/documents-read-model";
import { shellOf } from "@web/src/app-shell/shell.js";
import { Button } from "@web/src/ui/kit/button.js";
import { Callout } from "@web/src/ui/kit/callout.js";
import { Card, CardBody, CardHead } from "@web/src/ui/kit/card.js";
import { Field, Input } from "@web/src/ui/kit/field.js";
import { Page, PageHead } from "@web/src/ui/kit/page.js";
import { Pill } from "@web/src/ui/kit/pill.js";
import { StateDenied, StateEmpty, StateFailed } from "@web/src/ui/kit/states.js";
import { DataTable, TableNote, type Column } from "@web/src/ui/kit/table.js";
import { formatDecimal } from "@web/src/ui/value/format.js";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function pageFrom(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Колонки позиции.
 *
 * Числовые объявлены `numeric`, а не выровнены руками: табулярные цифры и
 * правый край — свойство колонки, а не украшение ячейки.
 *
 * Происхождение открывается у КАЖДОЙ строки, и это `<details>`, а не всплывающая
 * подсказка: подсказку нельзя ни выделить, ни прочитать с клавиатуры.
 */
/**
 * Ревизии предмета — цепочкой, а не списком.
 *
 * Показывается ЧТО прочитал разбор и во что это исправили: спор с подрядчиком
 * идёт именно об этом, и ответ «система читает так, человек исправил вот на
 * это» — единственный, который защищает обе стороны.
 *
 * Подтверждение предлагается только для НЕПОДПИСАННОЙ правки: разбор
 * подтверждения не требует, иначе подтверждать пришлось бы каждую из сотен
 * строк, и подпись обесценилась бы (ADR-R-019).
 */
function Revisions({
  revisions,
  code,
  versionId,
  ordinal,
  canWrite,
}: {
  readonly revisions: readonly RevisionView[];
  readonly code: string;
  readonly versionId: string;
  readonly ordinal: string;
  readonly canWrite: boolean;
}) {
  return (
    <ol className="m-0 mt-2.5 list-none border-t border-[var(--line-2)] p-0 pt-2.5">
      {revisions.map((revision) => (
        <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1" key={revision.id}>
          <Pill
            dot
            label={revision.origin}
            tone={revision.origin === "правка" ? "info" : "plain"}
          />
          <span className="num text-[var(--t-meta)] font-semibold text-[var(--text)]">{revision.value}</span>
          <span className="meta">{revision.field}</span>
          {revision.author === null ? null : <span className="meta">{revision.author}</span>}
          {revision.reason === null ? null : <span className="meta">{`причина: ${revision.reason}`}</span>}
          {revision.confirmedBy !== null ? (
            <Pill dot label={`подтвердил ${revision.confirmedBy}`} tone="ok" />
          ) : revision.origin === "правка" && canWrite ? (
            <form action="/api/positions/confirm" className="inline" method="post">
              <input name="objectCode" type="hidden" value={code} />
              <input name="versionId" type="hidden" value={versionId} />
              <input name="revisionId" type="hidden" value={revision.id} />
              <input name="ordinal" type="hidden" value={ordinal} />
              {/* Хэш ИЗ ПОКАЗАННОГО, а не из базы на момент нажатия: ядро сверит
                  их и откажет, если предмет успел измениться. */}
              <input name="contentHash" type="hidden" value={revision.contentHash} />
              <Button size="sm" type="submit" variant="outline">
                Подтвердить
              </Button>
            </form>
          ) : revision.origin === "правка" ? (
            <Pill dot label="ждёт подтверждения" tone="warn" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function columnsFor(
  card: VersionCard,
  code: string,
  versionId: string,
  canWrite: boolean,
  /** Строка листа, названная ссылкой из замечания. `null` — ссылки не было. */
  marked: number | null,
): readonly Column<PositionView>[] {
  return [
    {
      key: "ordinal",
      title: "№",
      numeric: true,
      width: "7%",
      render: (row) => <span className="num text-[var(--text-3)]">{row.ordinal}</span>,
    },
    {
      key: "name",
      title: "Позиция",
      width: "38%",
      render: (row) => (
        <>
          <span className="cell-title">{row.sourceName}</span>
          <span className="cell-sub">
            {`раздел ${row.section}`}
            {row.sheet === null || row.sheet.trim() === "" ? "" : ` · лист ${row.sheet}`}
          </span>
          {/*
            УРОВЕНЬ ДОВЕРИЯ СТОИТ ПРИ ПОЗИЦИИ, А НЕ В ЛЕГЕНДЕ ВНИЗУ (Т11).
            Позиция, поднятая ролью из ведомости объёмов, считается наравне с
            разобранной по форме 421/пр — в сходимости, гейтах и поиске
            двойного счёта. Отличие ровно одно: структуру назвала модель, а не
            форма. Человек, глядящий на строку, обязан видеть это здесь, иначе
            он примет распознанное за разобранное.
          */}
          {row.acquisition === "agent_normalized" ? (
            <Pill
              className="mt-1"
              dot
              label="ориентир · распознано ролью"
              title="Структуру документа распознала роль экипажа, значения взяты из документа. Считается наравне с разобранным, но проверяется человеком."
              tone="warn"
            />
          ) : null}
        </>
      ),
    },
    {
      key: "basis",
      title: "Шифр нормы",
      width: "16%",
      render: (row) =>
        row.basis.trim() === "" ? (
          // Пустой шифр — не пустая ячейка. «Позиция не сопоставлена» это вывод
          // разбора, и он обязан быть виден: пустота читается как недосмотр
          // вёрстки, а не как результат.
          <Pill dot label="не сопоставлена" title="Разбор не нашёл шифра нормы для этой позиции" tone="warn" />
        ) : (
          <span className="mono text-[var(--t-meta)] text-[var(--text-2)]">{row.basis}</span>
        ),
    },
    {
      key: "quantity",
      title: "Кол-во",
      numeric: true,
      width: "11%",
      render: (row) =>
        row.quantity === null ? (
          <span className="meta" title="Разбор не извлёк количество из этой строки">
            н/д
          </span>
        ) : (
          <span className="num text-[var(--text-2)]">{`${row.quantity} ${row.unit}`}</span>
        ),
    },
    {
      key: "amount",
      title: "Сумма",
      unit: "₽",
      numeric: true,
      width: "12%",
      // В таблице — ЧТО ПРОЧИТАЛ РАЗБОР, даже когда значение исправлено.
      // Показать здесь последнюю правку значило бы затереть разобранное: спор с
      // подрядчиком идёт как раз о том, что система прочитала в документе, и
      // ответ обязан содержать обе версии. Исправленное живёт в раскрытии.
      /**
       * Суммы может не быть вовсе: в смете без стоимостной части позиция несёт
       * шифр, единицу и объём, а денег в ней нет. «0,00 ₽» здесь объявило бы
       * работу бесплатной, поэтому прочерк и подпись под ним.
       */
      render: (row) =>
        row.amount === null ? (
          <span className="text-[var(--muted)]" title="в смете нет стоимостной части">
            —
          </span>
        ) : (
          <span className="num font-semibold text-[var(--text)]">{formatDecimal(row.amount)}</span>
        ),
    },
    {
      key: "source",
      title: "Откуда и правки",
      width: "16%",
      render: (row) => (
        <details className="disclosure" open={row.sourceRow === marked}>
          <summary>
            {`лист, строка ${row.sourceRow}`}
            {/* СЛОВО, А НЕ ТОЛЬКО ПОЛОСА. Строка, найденная по ссылке из
                замечания, помечена краем — но цвет не имеет права быть
                единственным сигналом, и пилюля отвечает на вопрос «почему эта
                строка выделена» там же, где выделение. */}
            {row.sourceRow === marked ? <Pill className="ml-1.5" dot label="из замечания" tone="info" /> : null}
            {row.revisions.length === 0 ? null : (
              <span className="ml-1.5 num text-[var(--t-micro)] font-bold text-[var(--info)]">
                {`+${row.revisions.length}`}
              </span>
            )}
          </summary>
          <dl className="disclosure__body">
            <dt>Строка листа</dt>
            <dd className="num">{row.sourceRow}</dd>
            <dt>Раздел</dt>
            <dd>{row.section}</dd>
            <dt>Наименование в источнике</dt>
            <dd>{row.sourceName}</dd>
            <dt>Единица</dt>
            <dd>{row.unit}</dd>
          </dl>

          {row.revisions.length === 0 ? null : (
            <Revisions
              canWrite={canWrite}
              code={code}
              ordinal={row.ordinal}
              revisions={row.revisions}
              versionId={versionId}
            />
          )}

          {canWrite ? (
            /* Правка живёт ЗДЕСЬ, а не отдельным экраном: происхождение,
               история и исправление — про одну и ту же строку, и разносить их
               значит заставлять человека сверять номер позиции глазами. */
            <form
              action="/api/positions/revise"
              className="mt-2.5 flex flex-wrap items-end gap-2.5 border-t border-[var(--line-2)] pt-2.5"
              method="post"
            >
              <input name="objectCode" type="hidden" value={code} />
              <input name="versionId" type="hidden" value={versionId} />
              <input name="ordinal" type="hidden" value={row.ordinal} />
              <input name="field" type="hidden" value="сумма" />
              <input name="parsedValue" type="hidden" value={row.amount ?? ""} />
              <input name="unit" type="hidden" value="₽" />
              <input name="document" type="hidden" value={card.fileName} />
              <input name="locator" type="hidden" value={`лист, строка ${row.sourceRow}`} />
              <Field className="w-[9rem]" label="Сумма">
                <Input defaultValue={row.amount ?? ""} name="value" required type="text" />
              </Field>
              <Field className="min-w-[12rem] flex-1" hint="без причины правка не сохранится" label="Причина">
                <Input name="reason" placeholder="уточнено по РД" required type="text" />
              </Field>
              <Button size="sm" type="submit" variant="outline">
                Исправить
              </Button>
            </form>
          ) : null}
        </details>
      ),
      },
  ];
}

export default async function VersionPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string; versionId: string }>;
  searchParams: Promise<{
    страница?: string;
    правка?: string;
    подтверждение?: string;
    причина?: string;
    позиция?: string;
    строка?: string;
  }>;
}) {
  const { code, versionId } = await params;
  const { страница, правка, подтверждение, причина, позиция, строка } = await searchParams;
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

  const object = decodeURIComponent(code);
  const shell = shellOf("S-03", result.viewer, [
    { href: `/objects/${encodeURIComponent(code)}`, label: object },
    { href: `/objects/${encodeURIComponent(code)}/documents`, label: "Документы" },
  ], decodeURIComponent(code));
  const decision = result.viewer.can("check:read", { kind: "object", id: object });
  // Правка — мутация, и право на неё то же, что на запуск Проверки: и то и
  // другое меняет состояние объекта. Без права формы не рисуются вовсе, а не
  // рисуются отключёнными: отключённая форма приглашает заполнить и отказывает
  // после.
  const canWrite = result.viewer.can("check:start").allowed;

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

  let card;
  try {
    card = await readVersion(result.viewer.actor.tenantId, object, versionId);
  } catch (error) {
    return shell(
      <Page wide>
        <Card>
          <CardBody>
            <StateFailed>{(error as Error).message}</StateFailed>
          </CardBody>
        </Card>
      </Page>,
    );
  }

  if (card === undefined) notFound();

  /**
   * СТРОКА, НАЗВАННАЯ ССЫЛКОЙ ИЗ ЗАМЕЧАНИЯ (веха Д3).
   *
   * Задача показа требует: нажал на вывод — дошёл до листа и строки исходного
   * файла. Дойти мешала разбивка на страницы: строка 312 лежит на седьмой
   * странице, и ссылка на первую отправляла читателя листать.
   *
   * Поэтому страница ВЫЧИСЛЯЕТСЯ по строке — но только когда её не назвали
   * явно: человек, ушедший со ссылки листать дальше, обязан листать, а не
   * возвращаться на страницу замечания.
   */
  const запрошенаСтрока = Number.parseInt(строка ?? "", 10);
  const строкаЛиста =
    Number.isFinite(запрошенаСтрока) && card.positions.some((position) => position.sourceRow === запрошенаСтрока)
      ? запрошенаСтрока
      : null;

  const местоСтроки =
    строкаЛиста === null ? -1 : card.positions.findIndex((position) => position.sourceRow === строкаЛиста);

  const страницаСтроки = местоСтроки === -1 ? undefined : String(Math.floor(местоСтроки / PAGE_SIZE) + 1);

  return shell(
    <Page wide>
      <PageHead
        aside={
          <span className="flex flex-wrap items-baseline gap-x-6 gap-y-1.5">
            <span className="meta">{`позиций ${card.version.positions}`}</span>
            <span className="meta">{`разделов ${card.sections.length}`}</span>
            {card.unmatched === 0 ? (
              <Pill dot label="все сопоставлены" tone="ok" />
            ) : (
              <Pill label={`без шифра ${card.unmatched}`} loud tone="warn" />
            )}
            {card.awaitingConfirmation === 0 ? null : (
              // §12: сильный вердикт заблокирован до подтверждения критичных
              // ревизий. Число здесь — не украшение, а то, что блокирует.
              <Pill label={`ждут подписи ${card.awaitingConfirmation}`} loud tone="warn" />
            )}
          </span>
        }
        note={`${card.kind} · ревизия №${card.version.revision} · отпечаток ${card.version.contentHash.slice(0, 8)}`}
        title={card.fileName}
      />

      {/* Итог мутации — словами, а не молчанием. Молчаливый возврат оставляет
          человека гадать, сохранилось ли, и он жмёт второй раз. */}
      {/* Почему открылась именно эта страница — словами. Прыжок разбивки без
          объяснения читается как сбой: человек нажал на замечание и оказался
          на седьмой странице, не понимая, отчего. */}
      {строкаЛиста === null ? (
        строка === undefined ? null : (
          <Callout title="Строка из замечания в этой версии не нашлась" tone="warn">
            {`Замечание указывало на строку ${строка} листа, а в разобранных позициях этой версии такой строки нет. Возможно, замечание относится к другой ревизии документа: разбор правку файла не затирает, у каждой ревизии свои позиции.`}
          </Callout>
        )
      ) : (
        <Callout title={`Показана строка ${строкаЛиста} — по ссылке из замечания`} tone="info">
          Страница выбрана по этой строке, сама строка помечена краем и словом «из замечания», а её раскрытие уже
          открыто. Дальше листается как обычно: ссылки страниц ведут по номеру, а не возвращают сюда.
        </Callout>
      )}

      {правка === undefined ? null : (
        <Callout
          title={правка === "да" ? "Правка сохранена ревизией" : "Правку сохранить не удалось"}
          tone={правка === "да" ? "info" : "warn"}
        >
          {правка === "да"
            ? `Позиция ${позиция ?? ""} исправлена. Разбор при этом не затёрт: обе версии значения остались, и правка ждёт подтверждения человеком.`
            : (причина ?? "причина не названа")}
        </Callout>
      )}

      {подтверждение === undefined ? null : (
        <Callout
          title={подтверждение === "да" ? "Ревизия подтверждена" : "Подтвердить не удалось"}
          tone={подтверждение === "да" ? "info" : "warn"}
        >
          {подтверждение === "да"
            ? `Подпись поставлена под значением позиции ${позиция ?? ""}. Она относится к тому значению, которое было показано, и не переносится на последующие правки.`
            : (причина ?? "причина не названа")}
        </Callout>
      )}

      {card.siblings.length > 1 ? (
        <Card>
          <CardHead aside="разбор неизменен: правка файла даёт новую ревизию" title="Ревизии этого документа" />
          <CardBody>
            <ul className="m-0 flex list-none flex-wrap gap-2.5 p-0">
              {card.siblings.map((sibling) => (
                <li key={sibling.id}>
                  {/* Тон `info`, а не `brand`.
                      Знак клиента не окрашивает данные — правило записано рядом
                      с самим токеном, и здесь оно нарушалось: открытая ревизия —
                      состояние документа, а не принадлежность клиенту. С золотым
                      знаком нарушение было незаметным; с чёрно-красным бейдж
                      прочитался бы тревогой рядом с настоящей тревогой. */}
                  {sibling.id === card.version.id ? (
                    <Pill label={`№${sibling.revision} — открыта`} tone="info" />
                  ) : (
                    <a
                      className="text-[var(--t-meta)] font-semibold"
                      href={`/objects/${encodeURIComponent(code)}/documents/${sibling.id}`}
                    >
                      {`№${sibling.revision}`}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHead
          aside={`страница по ${PAGE_SIZE} строк`}
          title="Извлечённые позиции"
        />
        <CardBody flush>
          <DataTable
            caption="Позиции сметы: номер, наименование, шифр нормы, количество, сумма и строка исходного листа"
            columns={columnsFor(card, code, versionId, canWrite, строкаЛиста)}
            rowClass={(row) => (row.sourceRow === строкаЛиста ? "row--marked" : undefined)}
            rowId={(row) => `строка-${row.sourceRow}`}
            empty={
              <StateEmpty title="Позиций нет">
                Версия сохранена, но сметных строк разбор в ней не нашёл. Это результат разбора, а не пробел в данных.
              </StateEmpty>
            }
            paging={{
              page: pageFrom(страница ?? страницаСтроки),
              pageSize: PAGE_SIZE,
              hrefFor: (page) =>
                `/objects/${encodeURIComponent(code)}/documents/${versionId}?${new URLSearchParams({
                  страница: String(page),
                }).toString()}`,
            }}
            rowKey={(row) => row.id}
            rows={card.positions}
          />
          <TableNote>
            Числа показаны как в источнике: десятичными строками, а не приведёнными к машинному числу. Приведение
            завело бы второе округление и разошлось бы с расчётным модулем на копейку там, где сходимость обязана
            быть нулевой.
          </TableNote>
        </CardBody>
      </Card>

      {card.sections.length > 1 ? (
        <Card>
          <CardHead aside="в порядке появления в листе" title="Разделы версии" />
          <CardBody>
            <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0">
              {card.sections.map(([section, count]) => (
                <li className="flex items-baseline gap-2" key={section}>
                  <span className="text-[var(--t-body)]">{section}</span>
                  <span className="num text-[var(--t-meta)] text-[var(--text-3)]">{count}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </Page>,
  );
}
