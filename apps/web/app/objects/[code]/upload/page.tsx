/**
 * Загрузка и прогон — шаги 2 и 4 тракта, на одном экране.
 *
 * ПОЧЕМУ ВМЕСТЕ
 *
 * Потому что прогон идёт ПО ПАРТИИ, и выбирать её надо там, где её видно.
 * Раньше прогон запускался с карточки объекта полем «папка в контуре», то есть
 * человек называл серверный каталог, ничего о нём не зная. Здесь он выбирает из
 * того, что сам загрузил, и видит, сколько в партии файлов.
 *
 * ПАРТИЯ, А НЕ «ПОСЛЕДНИЕ ФАЙЛЫ»
 *
 * Сметы правят и присылают заново. Если прогон всегда брал бы «что лежит
 * сейчас», ответить на вопрос «какой комплект проверяли в июле» было бы нечем.
 * Партия неизменна, названа временем, и прогон ссылается на неё.
 *
 * ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ
 *
 * Нет полосы загрузки и нет перетаскивания файлов мышью. И то и другое требует
 * клиентского кода, а `Ф-ADR-010` разрешает его только там, где серверного
 * рендеринга не хватает. Обычная форма с `multiple` отправляет семь файлов
 * ровно так же — браузер показывает свой собственный ход отправки.
 */
import { Bot, FastForward, FileUp, Play, Users } from "lucide-react";

import { currentViewer } from "@web/lib/actor";
import { readObject } from "@web/lib/read-model";
import { ACCEPTED, MAX_FILE_BYTES, MAX_FILES, listBatchFiles, listBatches } from "@web/lib/uploads";
import { shellOf } from "@web/src/app-shell/shell.js";
import { Button } from "@web/src/ui/kit/button.js";
import { Callout } from "@web/src/ui/kit/callout.js";
import { Card, CardBody, CardHead } from "@web/src/ui/kit/card.js";
import { Field } from "@web/src/ui/kit/field.js";
import { plural, СЛОВО } from "@web/src/ui/value/format.js";
import { ScrollBox } from "@web/src/ui/kit/scroll-box.js";
import { ObjectHead } from "@web/src/ui/command/object-head.js";
import { Tract } from "@web/src/ui/command/tract.js";
import { Page, PageHead } from "@web/src/ui/kit/page.js";
import { Pill } from "@web/src/ui/kit/pill.js";
import { StateDenied, StateEmpty } from "@web/src/ui/kit/states.js";
import { DataTable, type Column } from "@web/src/ui/kit/table.js";

export const dynamic = "force-dynamic";

/** Партия в перечне: то, что нужно, чтобы её выбрать и понять, что в ней. */
interface BatchRow {
  readonly batch: string;
  readonly files: number;
  readonly bytes: number;
  readonly at: Date;
  readonly code: string;
  readonly canStart: boolean;
}

/**
 * Партий на страницу.
 *
 * Разбивка нужна не «на будущее»: сквозные наборы загружают по партии на прогон
 * и пишут в тот же рабочий каталог, что и человек, — то же свойство, что у
 * тестов очереди (`Ф-46`), и с тем же следствием. Без разбивки перечень тонет
 * в служебных партиях по два килобайта, и настоящий комплект в нём не найти.
 */
const PAGE_SIZE = 12;

function megabytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} КБ`
    : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

const COLUMNS: readonly Column<BatchRow>[] = [
  {
    key: "batch",
    title: "Партия",
    render: (row) => (
      <>
        <span className="cell-title num">{row.at.toLocaleString("ru-RU")}</span>
        <span className="cell-sub mono">{row.batch}</span>
      </>
    ),
  },
  {
    key: "files",
    title: "Файлов",
    numeric: true,
    width: "14%",
    render: (row) => (
      <>
        <span className="num">{row.files}</span>
        {/* Число файлов — вход в СОСТАВ партии, а не только счётчик. После
            распаковки архива путь файла внутри партии — единственное место, где
            живёт ответ «какой файл откуда появился», и задача называет этот
            ответ обязательным. */}
        <a
          className="cell-sub"
          href={`/objects/${encodeURIComponent(row.code)}/upload?${new URLSearchParams({ состав: row.batch }).toString()}`}
        >
          состав
        </a>
      </>
    ),
  },
  {
    key: "bytes",
    title: "Объём",
    numeric: true,
    width: "14%",
    render: (row) => <span className="num text-[var(--text-2)]">{megabytes(row.bytes)}</span>,
  },
  {
    key: "run",
    title: "Прогон",
    width: "26%",
    render: (row) =>
      row.canStart ? (
        // Форма на строку, а не одна общая с переключателями: выбранная партия
        // — это и есть предмет действия, и передавать её скрытым полем строки
        // надёжнее, чем состоянием, которого на сервере нет.
        //
        // КНОПКИ, А НЕ ПЕРЕКЛЮЧАТЕЛЬ ВИДА ПРОГОНА. Выбор из состояний, сделанный
        // до нажатия, — это лишний шаг и лишняя ошибка: нажали «Проверить», не
        // заметив, что стоит «быстрый». Вид прогона называет сама кнопка, и все
        // одинаково доступны с клавиатуры.
        //
        // Третья кнопка — АГЕНТНЫЙ режим (Т9.1). Он не подменяет конвейер:
        // конвейер быстрее и дешевле, агентный глубже и дороже, и выбор между
        // ними — решение о времени прогона, а не о технике.
        <span className="flex flex-wrap items-center gap-1.5">
          <form action="/api/checks" method="post">
            <input name="objectCode" type="hidden" value={row.code} />
            <input name="партия" type="hidden" value={row.batch} />
            <Button size="sm" type="submit" variant="primary">
              <Play aria-hidden="true" size={12} />
              Проверить
            </Button>
          </form>
          <form action="/api/checks" method="post">
            <input name="objectCode" type="hidden" value={row.code} />
            <input name="партия" type="hidden" value={row.batch} />
            <input name="режим" type="hidden" value="быстрый" />
            <Button size="sm" title="Только сметный разбор: один агент, пять-семь минут" type="submit">
              <FastForward aria-hidden="true" size={12} />
              Быстрый
            </Button>
          </form>
          <form action="/api/checks" method="post">
            <input name="objectCode" type="hidden" value={row.code} />
            <input name="партия" type="hidden" value={row.batch} />
            <input name="режим" type="hidden" value="агентный" />
            <Button
              size="sm"
              title="Агенты работают циклом с инструментами: сами читают позиции, поднимают нормативы, пересчитывают. Глубже и дольше конвейера"
              type="submit"
            >
              <Bot aria-hidden="true" size={12} />
              Агентный
            </Button>
          </form>
          {/*
            Четвёртая кнопка — ЭКИПАЖ НА CODEX SDK (spec-demo-stage-1 А1): десять
            ролей, один тред на роль, такты 0–4 с воротами, передача «БЛОК ДЛЯ».
            Тот же воркфлоу `full-check`, другой исполнитель. Для уже загруженной
            партии; при загрузке то же делает галочка в форме «Новая партия».
          */}
          <form action="/api/checks" method="post">
            <input name="objectCode" type="hidden" value={row.code} />
            <input name="партия" type="hidden" value={row.batch} />
            <input name="режим" type="hidden" value="агенты" />
            <Button
              size="sm"
              title="Экипаж ролей: Дирижёр, такты 0–4, десять ролей эталонными промптами, каждая читает папку объекта сама. Самый долгий режим"
              type="submit"
            >
              <Users aria-hidden="true" size={12} />
              Агенты
            </Button>
          </form>
        </span>
      ) : (
        <Pill label="права нет" title="Требуется право check:start" tone="plain" />
      ),
  },
];

export default async function UploadPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{
    партия?: string;
    состав?: string;
    принято?: string;
    отклонено?: string;
    итог?: string;
    страница?: string;
  }>;
}) {
  const { code } = await params;
  const result = await currentViewer();

  if (result.kind === "гость") {
    return (
      <Page>
        <PageHead title="Загрузка документов" />
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

  const shell = shellOf("S-03", result.viewer, [
    { label: code, href: `/objects/${encodeURIComponent(code)}` },
    { label: "Загрузка" },
  ], decodeURIComponent(code));

  const read = result.viewer.can("check:read");

  if (!read.allowed) {
    return shell(
      <Page>
        <PageHead title="Загрузка документов" />
        <Card>
          <CardBody>
            <StateDenied permission="check:read" reason={read.reason} />
          </CardBody>
        </Card>
      </Page>,
    );
  }

  const object = await readObject(result.viewer.actor.tenantId, code);

  if (object === undefined) {
    return shell(
      <Page>
        <PageHead title="Загрузка документов" />
        <Card>
          <CardBody>
            <StateEmpty title="Объект не найден">
              Объекта с шифром {code} у этого арендатора нет. Это утверждение об арендаторе: тот же шифр может
              существовать у другого клиента и остаться невидимым здесь.
            </StateEmpty>
          </CardBody>
        </Card>
      </Page>,
    );
  }

  const canStart = result.viewer.can("check:start").allowed;
  const batches = await listBatches(result.viewer.actor.tenantId, code);
  const { партия, состав, принято, отклонено, итог, страница } = await searchParams;
  const page = Number.parseInt(страница ?? "1", 10);

  const rows: readonly BatchRow[] = batches.map((batch) => ({ ...batch, code, canStart }));

  // Состав читается ТОЛЬКО когда партия названа в адресе: обход дерева каждой
  // из сорока четырёх партий ради одной открытой — работа впустую.
  const files = состав === undefined ? [] : await listBatchFiles(result.viewer.actor.tenantId, code, состав);

  return shell(
    <Page wide>
      <ObjectHead
        active="документы"
        code={object.code}
        name={object.name}
        note={`Шифр ${object.code} · загрузка партией: прогон идёт по выбранной партии, а не по последним файлам`}
      />

      {/* ШАГОВИК ТРАКТА. Приписка «шаг 2 тракта» стояла здесь словами в правом
          углу шапки — она сообщала номер и не сообщала ни того, что было
          первым, ни того, что будет третьим.

          Пройденным отмечен только шаг, закрытый ФАКТОМ: объект существует
          (иначе экрана бы не было), партия — если она есть. Про разбор и прогон
          этот экран не знает, и они честно впереди. */}
      <Tract
        code={object.code}
        done={rows.length === 0 ? 1 : 2}
        hint={
          rows.length === 0
            /* Число агентов НЕ пишется словом: их было девять, стало десять, и
               подпись пережила появление десятого — найдено проходом клиентским
               путём 06.09. Реестр агентов растёт манифестами, а текст экрана за
               ним не следует. */
            ? "Загрузите файлы объекта — партией. Дальше прогон читает выбранную партию, разбирает сметы и запускает агентов конвейера."
            : `Партий ${rows.length}. Прогон идёт по выбранной партии: нажмите «Проверить» в её строке — дальше разбор и агенты конвейера.`
        }
        now={2}
      />

      {/* Итог загрузки — сразу под шапкой и словами. Отклонённый файл, о
          котором не сказали, человек считает загруженным.

          Тон «info», когда принято всё, и «warn», когда что-то нет. Успешной
          загрузке отдельный цвет не нужен: подтверждение — это сообщение, а не
          событие, требующее внимания. */}
      {партия === undefined ? null : (
        <Callout
          title={`Партия принята: ${plural(Number.parseInt(принято ?? "0", 10) || 0, СЛОВО.файл)}`}
          tone={отклонено === undefined ? "info" : "warn"}
        >
          <span className="mono">{партия}</span>
          {отклонено === undefined ? null : (
            <>
              <br />
              Не принято: {отклонено}
            </>
          )}
        </Callout>
      )}

      {итог === "пусто" ? (
        <Callout title="Файлов в запросе не было" tone="warn">
          Форма отправилась без выбранных файлов — партия не заводилась.
        </Callout>
      ) : null}

      {canStart ? (
        <Card>
          <CardHead
            aside={`до ${MAX_FILE_BYTES / 1024 / 1024} МБ на файл · до ${MAX_FILES} файлов в партии`}
            note={`Принимаются любые файлы и архивы (.zip, .rar, .7z — распаковываются с сохранением структуры папок, вложенные тоже). Читаются: ${ACCEPTED.join(", ")}; остальное ложится в партию как есть и называется нечитаемым внутри, а не отвергается на двери.`}
            title="Новая партия"
          />
          <CardBody>
            <form
              action="/api/uploads"
              className="flex flex-wrap items-end gap-3"
              encType="multipart/form-data"
              method="post"
            >
              <input name="objectCode" type="hidden" value={object.code} />
              <Field className="min-w-[24rem] flex-1" label="Файлы объекта">
                <input
                  className="input-file"
                  multiple
                  name="файлы"
                  required
                  type="file"
                />
              </Field>
              <Button type="submit" variant="primary">
                <FileUp aria-hidden="true" size={13} />
                Загрузить
              </Button>
              {/*
                ГАЛОЧКА РЯДОМ С ЗАГРУЗКОЙ (spec-demo-stage-1 А2). Включена — партия
                сохраняется и той же загрузкой ставится Проверка экипажем ролей;
                человек попадает на объект с идущим прогоном. Выключена — поведение
                прежнее: партия ждёт кнопки в таблице ниже.
              */}
              <label className="meta mb-0 flex basis-full items-center gap-2 pt-1">
                <input name="через-агентов" type="checkbox" value="да" />
                Сразу провести проверку через агентов — весь процесс пройдёт экипажем ролей
              </label>
            </form>
            <p className="meta mt-2.5 mb-0">
              Партия неизменна и названа временем загрузки: повторная загрузка не затирает предыдущую, и прогон всегда
              ссылается на конкретный комплект. Один ZIP со сотней смет — штатный вход: путь файла внутри архива
              сохраняется, и связь с первоисточником не теряется. Вложенные архивы не распаковываются — причина
              называется отдельной строкой.
            </p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody>
            <StateDenied
              permission="check:start"
              reason="Загрузка меняет данные объекта, поэтому требует того же права, что и запуск Проверки."
            />
          </CardBody>
        </Card>
      )}

      {/* СОСТАВ ВЫБРАННОЙ ПАРТИИ — С ПУТЯМИ.
          Показывается только когда партия выбрана: карточка «состав ничего не
          выбрано» занимала бы место и ничего не сообщала. */}
      {состав === undefined ? null : (
        <Card>
          <CardHead
            aside={<a href={`/objects/${encodeURIComponent(code)}/upload`}>закрыть</a>}
            note="Путь — тот, что был внутри архива: он и есть ответ на «какой файл откуда появился»."
            title={`Состав партии · ${plural(files.length, СЛОВО.файл)}`}
          />
          <CardBody flush>
            {files.length === 0 ? (
              <StateEmpty title="Партия пуста">
                Каталог партии есть, файлов в нём нет. Это утверждение о партии, а не об объекте.
              </StateEmpty>
            ) : (
              <ScrollBox label="Состав партии">
                <ul className="m-0 list-none p-0">
                {files.map((file) => (
                  <li className="dash-attn dash-attn--calm" key={file.path}>
                    <span className="dash-attn__main">
                      <span className="dash-attn__title" title={file.path}>
                        {file.path}
                      </span>
                    </span>
                    <span className="num shrink-0 text-[var(--t-meta)] text-[var(--text-3)]">
                      {megabytes(file.bytes)}
                    </span>
                  </li>
                ))}
                </ul>
              </ScrollBox>
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHead
          aside={rows.length === 0 ? "партий нет" : `${plural(rows.length, СЛОВО.партия)} · прогон идёт по выбранной`}
          title="Загруженные партии"
        />
        <CardBody flush>
          <DataTable
            caption="Партии загрузки объекта: время, число файлов, объём и запуск прогона"
            columns={COLUMNS}
            empty={
              <StateEmpty title="Партий нет">
                По этому объекту ещё не загружали файлы. Это утверждение о системе: каталог арендатора пуст, а не
                недоступен.
              </StateEmpty>
            }
            paging={{
              page: Number.isFinite(page) && page > 0 ? page : 1,
              pageSize: PAGE_SIZE,
              hrefFor: (next) =>
                `/objects/${encodeURIComponent(code)}/upload?${new URLSearchParams({ страница: String(next) }).toString()}`,
            }}
            rowKey={(row) => row.batch}
            rows={rows}
          />
        </CardBody>
      </Card>
    </Page>,
  );
}
