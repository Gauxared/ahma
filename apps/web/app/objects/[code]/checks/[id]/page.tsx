import { адресаты } from "@web/lib/addressee";
import { FileText } from "lucide-react";
import { notFound } from "next/navigation";
import { Fragment } from "react";

import { currentViewer } from "@web/lib/actor.js";
import { agentRoster } from "@web/lib/agent-roles.js";
import {
  readCheck,
  type AgentRunRow,
  type ArtifactView,
  type CheckCard,
  type DocumentRow,
  type GateRow,
  type OpenQuestionView,
  type ReviewAgentView,
  type ReviewFindingView,
  type ReviewView,
  type StageRow,
  type StepRow,
  type SubjectRow,
} from "@web/lib/check-read-model.js";
import { versionsByContentHash } from "@web/lib/documents-read-model.js";
import { STRONGEST_MAX, STRONGEST_RULE, strongest, type Strongest as Strong } from "@web/lib/strongest.js";
import { AutoRefresh } from "@web/src/ui/auto-refresh.js";
import { Comparison } from "@web/src/ui/command/comparison.js";
import { Finding, SEVERITY_SCALE, byWeight, severityWord } from "@web/src/ui/command/finding.js";
import { VerdictLights } from "@web/src/ui/command/verdict.js";
import { ButtonLink } from "@web/src/ui/kit/button.js";
import { Callout } from "@web/src/ui/kit/callout.js";
import { FilterBar, FilterGroup, type FilterOption } from "@web/src/ui/kit/filters.js";
import { shellOf } from "@web/src/app-shell/shell.js";
import { ObjectHead } from "@web/src/ui/command/object-head.js";
import { checkStatusWord } from "@web/src/ui/command/check-status.js";
import { Page } from "@web/src/ui/kit/page.js";
import { Card, CardBody, CardHead } from "@web/src/ui/kit/card.js";
import { Pill, type PillTone } from "@web/src/ui/kit/pill.js";
import { StateDenied, StateEmpty, StateFailed } from "@web/src/ui/kit/states.js";
import { DataTable, type Column } from "@web/src/ui/kit/table.js";
import { formatAmountsInProse, plural, СЛОВО } from "@web/src/ui/value/format.js";

/**
 * Рабочий экран Проверки — экран §5.5 (5), поверхность `S-05`, веха Ф1.
 *
 * СВЕТЛАЯ ПОВЕРХНОСТЬ, А НЕ ШТАБНАЯ
 *
 * Это рабочий экран: по нему разбираются, почему шаг не стартовал, и читают
 * таблицы. Тёмная тема отдана обзорным штабным дашбордам (`Ф-ADR-002`).
 *
 * ТОЛЬКО ЧТЕНИЕ
 *
 * Ни «перезапустить», ни «подтвердить предмет», ни «эскалировать» здесь нет:
 * запись из веба появляется вместе с правами и CSRF в Ф4 (`Ф-ADR-009`). Кнопка,
 * выглядящая работающей и ничего не делающая, хуже её отсутствия.
 */
export const metadata = {
  title: "Проверка объекта — СтройИнтеллект",
};

const STEP_TONE: Record<StepRow["status"], PillTone> = {
  исполнен: "ok",
  заблокирован: "danger",
  "не реализован": "plain",
  "не выполнялся": "warn",
};

const SUBJECT_TONE: Record<SubjectRow["status"], PillTone> = {
  approved: "ok",
  returned: "danger",
  draft: "plain",
};

const SUBJECT_WORD: Record<SubjectRow["status"], string> = {
  approved: "подтверждён",
  returned: "возвращён",
  draft: "черновик",
};

function formatMoment(value: Date | null): string {
  if (value === null) return "—";
  return value.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const SUBJECT_COLUMNS: readonly Column<SubjectRow>[] = [
  { key: "id", title: "Предмет", render: (row) => <span className="cell-title">{row.id}</span> },
  {
    key: "status",
    title: "Состояние",
    render: (row) => (
      <>
        <Pill dot={row.status !== "returned"} label={SUBJECT_WORD[row.status]} loud={row.status === "returned"} tone={SUBJECT_TONE[row.status]} />
        {row.reason === null ? null : <span className="cell-sub">{row.reason}</span>}
      </>
    ),
  },
  {
    key: "returned",
    title: "Возвратов",
    numeric: true,
    width: "12%",
    render: (row) => <span className="num text-[var(--text-2)]">{row.returnedCount}</span>,
  },
  {
    key: "updated",
    title: "Обновлён",
    numeric: true,
    width: "22%",
    render: (row) => <span className="num text-[var(--text-2)]">{formatMoment(row.updatedAt)}</span>,
  },
];


const DOCUMENT_TONE: Readonly<Record<string, PillTone>> = {
  проверен: "ok",
  сверен: "info",
  // «Прочитан» — работа сделана, просто не разбор в позиции: подшивка РД,
  // договор, записка. Тон спокойный, но не такой же, как у «не поддержан»:
  // это разные исходы, и на экране они не должны выглядеть одним.
  прочитан: "info",
  "не поддержан": "plain",
  отказ: "danger",
};

/**
 * Гейты — списком, а не таблицей, и итог СЛЕВА.
 *
 * Таблица ставила колонку «Итог» справа: у гейта §12.1а объяснение на две
 * строки, и пилюля оказывалась в девятистах пикселях от того, что она судит.
 * Читатель, дойдя до конца объяснения, вёл пальцем по экрану обратно — а
 * ответов всего два, и он нужен ПЕРВЫМ: сначала «пройден», потом «почему».
 *
 * Объяснение при этом не сокращено ни на знак. «Δ 7,52 ₽ при гранулярности
 * шкалы 10 ₽ — объясняется округлением источника» и есть ответ на вопрос
 * «почему пройден»; спрятать его в подсказку значило бы оставить читателя с
 * одной зелёной галочкой.
 */
function Gate({ gate }: { readonly gate: GateRow }) {
  return (
    <li className={`gate ${gate.passed ? "gate--ok" : "gate--fail"}`}>
      {gate.passed ? <Pill dot label="пройден" tone="ok" /> : <Pill label="не пройден" loud tone="danger" />}
      <span className="gate__body">
        <span className="gate__name">{`${gate.id} · ${gate.name}`}</span>
        {gate.detail === "" ? null : <span className="gate__detail">{formatAmountsInProse(gate.detail)}</span>}
      </span>
    </li>
  );
}

const DOCUMENT_COLUMNS: readonly Column<DocumentRow>[] = [
  {
    key: "file",
    title: "Документ",
    render: (row) => (
      <>
        <span className="cell-title">{row.path}</span>
        {row.reason === null ? null : <span className="cell-sub">{row.reason}</span>}
      </>
    ),
  },
  { key: "kind", title: "Вид", width: "16%", render: (row) => <span className="text-[var(--text-2)]">{row.kind}</span> },
  {
    key: "readout",
    title: "Что взято",
    width: "20%",
    /**
     * ЧТО СИСТЕМА ВЗЯЛА ИЗ ФАЙЛА, А НЕ ТОЛЬКО ЧТО НЕ ВЗЯЛА.
     *
     * У подшивки в четыре мегабайта единственным числом на экране было
     * «позиций 0» — и читалось оно как «пусто». На деле из неё прочитано
     * 158 000 знаков текстового слоя и отправлено агентам двенадцать листов
     * картинками, и оба тома названы в замечаниях поимённо.
     */
    render: (row) =>
      row.readout === null ? (
        <span className="meta">—</span>
      ) : (
        <>
          <span className="cell-title num">{`${plural(row.readout.pages, СЛОВО.страница)}`}</span>
          <span className="cell-sub num">
            {`${row.readout.chars.toLocaleString("ru-RU")} знаков`}
            {row.readout.sheets === null || row.readout.sheets === 0
              ? ""
              : ` · ${plural(row.readout.sheets, СЛОВО.лист)} агенту`}
          </span>
        </>
      ),
  },
  {
    key: "status",
    title: "Состояние",
    width: "20%",
    render: (row) => (
      <Pill
        dot={row.status !== "отказ"}
        label={row.status}
        loud={row.status === "отказ"}
        tone={DOCUMENT_TONE[row.status] ?? "plain"}
      />
    ),
  },
];


/**
 * Что показать клиенту — три-пять сильных выводов.
 *
 * ПРЯМОЕ ТРЕБОВАНИЕ ЗАДАЧИ, КОТОРОЕ НЕ ВЫПОЛНЯЛОСЬ
 *
 * «Не нужно выдавать клиенту 100 выводов, нужны 3–5 сильных». Система даёт 167
 * замечаний и умеет отобрать критичные — двадцать. Ни 167, ни 20 на встрече не
 * читают: отбор по важности сокращает список, но не делает его разговором.
 *
 * ПЕРВОЙ КАРТОЧКОЙ ЭКРАНА, И ЭТО НЕ ВОПРОС ВКУСА
 *
 * Экран Проверки открывают в двух положениях: разбираются в прогоне и
 * показывают клиенту. Второе — тот случай, ради которого продукт покупают, и в
 * нём у читателя минуты. Гейты, документы и такты объясняют, ПОЧЕМУ система так
 * решила; этот перечень говорит, ЧТО именно показать.
 *
 * ПРАВИЛО ОТБОРА ПОКАЗАНО РЯДОМ
 *
 * Перечень «самое важное», собранный неизвестно как, — мнение системы, за
 * которое нельзя спросить. Правило живёт одной строкой в `strongest.ts` и
 * печатается здесь дословно оттуда: разойтись им негде.
 */
function Strongest({
  items,
  objectCode,
  checkId,
  hrefOf,
}: {
  readonly items: readonly Strong[];
  readonly objectCode: string;
  readonly checkId: string;
  readonly hrefOf: (finding: ReviewFindingView) => string | null;
}) {
  return (
    <Card>
      <CardHead
        aside={items.length === 0 ? "показывать нечего" : `${items.length} из ${STRONGEST_MAX}`}
        note={STRONGEST_RULE}
        title="Что показать клиенту"
      />
      <CardBody flush>
        {items.length === 0 ? (
          <StateEmpty title="Сильных выводов нет">
            Ни одно замечание прогона не несёт координаты в исходном файле, а вывод, который нельзя показать в
            документе, на встрече не работает. Полный перечень замечаний — ниже.
          </StateEmpty>
        ) : (
          <ol className="m-0 list-none p-0">
            {items.map((item, index) => (
              <Finding
                author={item.person}
                finding={item.finding}
                href={hrefOf(item.finding)}
                key={`${item.capability}/${index}`}
                ordinal={index + 1}
              />
            ))}
          </ol>
        )}
      </CardBody>
      <div className="card__foot">
        <p className="meta m-0">
          {`Разговор ведут по этому перечню, разбираются — по полному. Каждый вывод открывается у своего агента: `}
          <a href={`/objects/${encodeURIComponent(objectCode)}/agents?прогон=${encodeURIComponent(checkId)}`}>
            доска агентов →
          </a>
        </p>
      </div>
    </Card>
  );
}

/**
 * Замечания прогона — ПО АГЕНТАМ, свёрнуто, с отбором по важности.
 *
 * ЧТО ЗДЕСЬ БЫЛО НЕВЕРНО ПО СУЩЕСТВУ, А НЕ ПО ВИДУ
 *
 * Карточка называлась «Обзор сметчика» и показывала замечания ВСЕХ ДЕВЯТИ
 * агентов: разрез шёл по документу, а `capability` при группировке терялась. На
 * курганском прогоне это 167 замечаний под подписью одного человека — то есть
 * экран приписывал сметчику выводы ГИПа, экономиста и договорника. Ошибка не в
 * оформлении: подпись под чужим выводом это и есть неправда.
 *
 * ЧТО БЫЛО НЕВЕРНО ПО ВИДУ
 *
 * Сто шестьдесят семь замечаний шли одним плоским списком В ПОРЯДКЕ ОТВЕТА
 * МОДЕЛИ: «сведение», «критично», «средняя», «средняя» — то есть блокер стоял
 * между двумя примечаниями. Экран растягивался на три десятка прокруток, и
 * прочитать его целиком нельзя было даже теоретически.
 *
 * Теперь по агенту на блок, блоки свёрнуты, внутри блока — тяжёлое сверху.
 * Свёрнутость — родная `<details>`, без клиентского кода: экран остаётся
 * серверным, а состояние раскрытия не надо ни хранить, ни восстанавливать.
 */
function AgentFindings({
  review,
  objectCode,
  checkId,
  chosen,
  hrefOf,
}: {
  readonly review: ReviewView;
  readonly objectCode: string;
  readonly checkId: string;
  readonly chosen: string | undefined;
  readonly hrefOf: (finding: ReviewFindingView) => string | null;
}) {
  const roster = agentRoster();
  const shownTotal =
    chosen === undefined
      ? review.findings
      : review.agents.reduce(
          (sum, agent) => sum + agent.findings.filter((finding) => finding.severity === chosen).length,
          0,
        );

  return (
    <Card>
      <CardHead
        aside={
          chosen === undefined
            ? `${plural(review.findings, СЛОВО.замечание)} · ${plural(review.agents.length, СЛОВО.агент)}`
            : // Слово, а не ключ: `critical` — это то, чем важность называется
              // в артефакте, а не то, чем её называет человек.
              `${shownTotal} из ${review.findings} · отбор: ${severityWord(chosen)[0]}`
        }
        note="Разрез по автору: замечание без автора не обсуждается — первое, что спрашивают, это кто его дал. Группы свёрнуты, число и важности видны в заголовке; отбор по важности раскрывает их сам."
        title="Замечания агентов"
      />

      <CardBody flush>
        {review.agents.map((agent) => {
          const identity = roster.get(agent.capability);
          const shown = agent.findings.filter((finding) => chosen === undefined || finding.severity === chosen);

          if (shown.length === 0) return null;

          return (
            /**
             * СВЁРНУТО, ПОКА НЕ СПРОСИЛИ. И это не прятание данных.
             *
             * Первая версия раскрывала агентов с критичным — у ГИПа их два, а
             * замечаний сорок шесть, и экран снова уходил на шесть прокруток.
             * Раскрытие «тяжёлого» агента показывает не тяжёлое, а ВСЁ, что он
             * сказал.
             *
             * Число и важности видны в свёрнутом заголовке, то есть спрятано
             * не сведение, а его объём. А отбор по важности раскрывает группы
             * сам: «покажи только критичные» даёт двадцать замечаний с
             * авторами — ровно тот разговор, который на встрече и ведут.
             */
            <details className="agroup" key={agent.capability} open={chosen !== undefined}>
              <summary className="agroup__head">
                <span className="agroup__person">{identity?.person ?? agent.capability}</span>
                <span className="meta">{identity?.role ?? agent.capability}</span>
                <span className="agroup__marks">
                  {agent.bySeverity.map(([word, count]) => (
                    <Pill
                      dot
                      key={word}
                      label={`${word}: ${count}`}
                      tone={
                        word === "критические" || word === "высокие" ? "danger" : word === "средние" ? "warn" : "info"
                      }
                    />
                  ))}
                </span>
              </summary>

              {/* Ссылка ВНУТРИ раскрытия, а не в его заголовке: нажатие на
                  заголовок сворачивает блок, и ссылка в нём делала бы два
                  разных дела от одного щелчка. */}
              <p className="agroup__link">
                <a href={`/objects/${encodeURIComponent(objectCode)}/agents/${encodeURIComponent(agent.capability)}?прогон=${encodeURIComponent(checkId)}`}>
                  {`Экран агента: вердикт по предметам, переход к строке листа, что проверить человеку →`}
                </a>
              </p>

              <ol className="m-0 list-none p-0">
                {/* Ключ по номеру, а не по тексту: одно и то же замечание могут
                    дать два агента, и текст перестаёт быть уникальным. */}
                {[...shown].sort(byWeight).map((finding, index) => (
                  <Finding finding={finding} href={hrefOf(finding)} key={`${index}/${finding.severity}`} />
                ))}
              </ol>
            </details>
          );
        })}
      </CardBody>
    </Card>
  );
}

/**
 * Результат операции.
 *
 * Гейты показываются с их собственным объяснением: «Δ 7.52 ₽ при гранулярности
 * шкалы 10 ₽ — объясняется округлением источника» — это и есть ответ на вопрос
 * «почему пройден», и прятать его в подсказку значило бы оставить читателя с
 * одной зелёной галочкой.
 */
function Artifact({ artifact }: { readonly artifact: ArtifactView }) {
  // Сравнение КП — своя поверхность §5.5 (4) и свой разбор.
  if (artifact.comparison !== null) {
    return <Comparison view={artifact.comparison} />;
  }

  if (!artifact.parsed) {
    return (
      <Card>
        <CardHead aside={`v${artifact.operationVersion}`} title={`Операция «${artifact.operationId}»`} />
        <CardBody>
          <StateEmpty title="Тело операции экран не разбирает">
            Артефакт сохранён и доступен по идентификатору, но его структура этому экрану неизвестна. Показать её
            наугад значило бы выдать догадку за результат.
          </StateEmpty>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHead
        aside={`${artifact.operationId} v${artifact.operationVersion} · полнота ${artifact.completeness}`}
        title="Результат обхода объекта"
      >
        {artifact.verdict === null ? null : (
          <Pill
            className="ml-3"
            dot={artifact.verdict === "принято"}
            label={artifact.verdict}
            loud={artifact.verdict !== "принято"}
            tone={artifact.verdict === "принято" ? "ok" : "danger"}
          />
        )}
      </CardHead>

      <CardBody flush>
        {artifact.totals.length === 0 ? null : (
          // Плитками, а не строкой пар: семь величин подряд одним кеглем
          // читались как подпись, и главные из них — сколько смет прочитано и
          // сколько позиций извлечено — тонули между служебными.
          <dl className="totals">
            {artifact.totals.map(([word, value]) => (
              <div className="totals__cell" key={word}>
                <dt className="totals__word">{word}</dt>
                <dd className="totals__value num">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {artifact.gates.length === 0 ? (
          <StateEmpty title="Гейтов нет">Операция не объявляла договорных критериев.</StateEmpty>
        ) : (
          <ul className="gates">
            {artifact.gates.map((gate) => (
              <Gate gate={gate} key={gate.id} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * Документы объекта — своей карточкой, а не хвостом карточки гейтов.
 *
 * Они стояли второй таблицей внутри «Результата обхода», без заголовка и без
 * счётчика: восемь строк вида «не поддержан» приезжали сразу после девяти
 * гейтов, и граница между «что проверено» и «чем проверено» пропадала.
 */
function Documents({ documents }: { readonly documents: readonly DocumentRow[] }) {
  // «Прочитан» входит в отработанные: из документа взято то, что из него берут.
  // Считать иначе значило бы объявить непрочитанной подшивку, которую агенты
  // цитируют поимённо.
  const parsed = documents.filter(
    (row) => row.status === "проверен" || row.status === "сверен" || row.status === "прочитан",
  ).length;

  return (
    <Card>
      <CardHead
        aside={`${plural(documents.length, СЛОВО.файл)} · разобрано ${parsed}`}
        note="Неразобранный файл назван неразобранным и с причиной: «принято и потеряно» третьим состоянием быть не может."
        title="Документы объекта"
      />
      <CardBody flush>
        <DataTable
          caption="Документы объекта: вид, состояние разбора и причина пропуска"
          columns={DOCUMENT_COLUMNS}
          empty={<StateEmpty title="Документов нет">В папке объекта не нашлось ни одного файла.</StateEmpty>}
          rowKey={(row) => row.path}
          rows={documents}
        />
      </CardBody>
    </Card>
  );
}

const RUN_TONE: Record<AgentRunRow["status"], PillTone> = {
  выполняется: "info",
  исполнен: "ok",
  отказ: "danger",
};

/**
 * Ход прогона — то, что видно, ПОКА он идёт.
 *
 * ЗАЧЕМ КАРТОЧКА, КОТОРОЙ НЕ БЫЛО. Прогон по семи файлам идёт тридцать шесть
 * минут, а ориентир встречи — начать показывать через двадцать-тридцать. Экран
 * до Д2 показывал результат только целиком: двадцать минут разговора система
 * молчала, хотя сметчик высказался на пятой минуте.
 *
 * ПОЧЕМУ ЭТО НЕ ДУБЛЬ ДОСКИ АГЕНТОВ. Доска отвечает «кто что сказал» и
 * группирует по тактам конвейера. Здесь — ЛЕНТА: кто когда высказался, в
 * порядке событий, с предметом. На встрече читают именно её: «сметчик — на
 * пятой минуте, экономист — на девятой».
 *
 * Карточка живёт и после завершения: время, за которое агент высказался, —
 * факт прогона, а не индикатор загрузки. Гасить его по завершении значило бы
 * прятать единственный замер, по которому видно, где прогон стоит.
 */
/**
 * ТАЙМЛАЙН ХОДА: КТО КОГДА РАБОТАЛ И СКОЛЬКО ЭТО ЗАНЯЛО.
 *
 * ЗАЧЕМ. Лента отвечала «кто высказался», но не отвечала на вопрос, который
 * задают, глядя на идущий прогон: ГДЕ ОН СЕЙЧАС и сколько это тянется. Владелец
 * 09.09.2026: «непонятно, когда закончится и на какой стадии». Полоса делает
 * видимым то, чего в списке не видно ни при какой внимательности: что роли идут
 * ПОСЛЕДОВАТЕЛЬНО, такт за тактом, и что длинная роль — это не зависание.
 *
 * ОКНО — от начала прогона до его конца, а у идущего — до текущего момента.
 * Проценты считаются на сервере: полоса не должна требовать скрипта, а
 * страница и так обновляется сама.
 */
function окноПрогона(card: CheckCard): { readonly начало: number; readonly длина: number } {
  const времена = card.runs.flatMap((run) => [run.startedAt, run.finishedAt]).filter((t): t is Date => t !== null);
  const начало = card.startedAt?.getTime() ?? Math.min(...времена.map((t) => t.getTime()));
  const конец = card.finishedAt?.getTime() ?? Date.now();

  // Ноль в знаменателе даёт `Infinity` в ширине: у прогона, начатого секунду
  // назад, окно ещё пустое.
  return { начало, длина: Math.max(конец - начало, 1000) };
}

/** Длительность словами: минуты, а секунды — только пока их меньше минуты. */
function длительность(от: Date | null, до: Date | null): string {
  if (от === null) return "";

  const мс = (до?.getTime() ?? Date.now()) - от.getTime();
  if (мс < 60_000) return `${Math.max(Math.round(мс / 1000), 1)} с`;

  return `${Math.round(мс / 60_000)} мин`;
}

function Progress({ card }: { readonly card: CheckCard }) {
  const working = card.runs.filter((run) => run.status === "выполняется").length;
  const said = card.runs.filter((run) => run.status !== "выполняется").length;
  const окно = окноПрогона(card);

  return (
    <Card>
      <CardHead
        aside={
          card.live
            ? `${said} высказалось, ${working} работает`
            : `${plural(said, СЛОВО.запись)} хода: кто когда высказался`
        }
        note="Ход прогона по агентам, свежее сверху. Замечания доступны до конца прогона: полный обход идёт десятки минут, а первый агент высказывается на пятой минуте."
        title="Ход прогона"
      />
      {/* Этап здесь НЕ повторяется: он уже назван в шапке объектного экрана
          строкой «этап». Два одинаковых слова на расстоянии сантиметра читаются
          как два разных сообщения — я это уже получал на заголовках. */}

      <CardBody flush>
        {card.documentsTotal === null ? null : (
          <p className="meta m-0 border-b border-[var(--line-2)] px-4 py-2.5">
            {`документов разобрано ${card.documentsDone ?? 0} из ${card.documentsTotal}`}
          </p>
        )}

        <ul className="m-0 list-none p-0">
          {card.runs.map((run) => (
            <li
              className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3.5 border-b border-[var(--line-2)] px-4 py-2.5 last:border-b-0"
              key={`${run.capability}/${run.subject}`}
            >
              <Pill
                className="mt-px shrink-0"
                dot={run.status !== "отказ"}
                label={run.status}
                loud={run.status === "отказ"}
                tone={RUN_TONE[run.status]}
              />
              <div className="min-w-0">
                <p className="m-0 flex flex-wrap items-baseline gap-x-2.5">
                  {/* ИМЕНЕМ, А НЕ СПОСОБНОСТЬЮ. «Людмила высказалась» — то, что
                      произносят на встрече; `estimate_review` требует перевода,
                      и переводить его читателю не должно быть нужно. */}
                  <span className="text-[var(--t-body)] font-semibold">{run.person}</span>
                  {run.person === run.capability ? null : <span className="meta">{run.capability}</span>}
                  {/* Предмет — файлом, а не путём: путь объекта здесь ничего не
                      добавляет, а имя сметы отвечает на вопрос «по чему». */}
                  <span className="meta">{run.subject.split("/").pop() ?? run.subject}</span>
                  {run.scope === null ? null : <span className="meta">{`предмет — ${run.scope}`}</span>}
                </p>

                {run.error === null ? null : (
                  <p className="m-0 mt-1 text-[var(--t-meta)] text-[var(--danger)]">{run.error}</p>
                )}

                {run.bySeverity.length === 0 ? (
                  <p className="meta m-0 mt-1">
                    {run.status === "выполняется"
                      ? "агент работает: что нашёл, пока не сказал"
                      : run.status === "отказ"
                        ? "замечаний нет, потому что агент не смог"
                        : "агент отработал и замечаний не нашёл"}
                  </p>
                ) : (
                  <p className="m-0 mt-1 flex flex-wrap items-center gap-2">
                    {run.bySeverity.map(([word, count]) => (
                      <Pill
                        dot
                        key={word}
                        label={`${word}: ${count}`}
                        tone={word === "критические" || word === "высокие" ? "danger" : word === "средние" ? "warn" : "info"}
                      />
                    ))}
                  </p>
                )}
              </div>

              {/* Время именно ОКОНЧАНИЯ у высказавшегося и НАЧАЛА у работающего:
                  вопрос про них разный. «Высказался в 14:23» — факт, «работает
                  с 14:12» — длительность, которую человек считает сам. */}
              <span className="num meta shrink-0 text-right">
                {run.status === "выполняется"
                  ? run.startedAt === null
                    ? "—"
                    : `с ${formatMoment(run.startedAt)}`
                  : formatMoment(run.finishedAt)}
                {run.startedAt === null ? null : (
                  <span className="block text-[var(--ink-muted)]">{длительность(run.startedAt, run.finishedAt)}</span>
                )}
              </span>

              {/* ПОЛОСА ЗАНЯТОСТИ — во всю ширину строки, под текстом.
                  Она показывает то, чего в списке не видно: последовательность
                  тактов и то, что длинная роль работает, а не висит. */}
              {run.startedAt === null ? null : (
                <span
                  aria-hidden="true"
                  className="col-span-3 mt-1.5 block h-[3px] rounded-full bg-[var(--line-2)]"
                >
                  <span
                    className={`block h-full rounded-full ${
                      run.status === "отказ" ? "bg-[var(--danger)]" : run.status === "выполняется" ? "bg-[var(--accent)]" : "bg-[var(--ok)]"
                    }`}
                    style={{
                      marginLeft: `${Math.min(Math.max(((run.startedAt.getTime() - окно.начало) / окно.длина) * 100, 0), 99).toFixed(1)}%`,
                      width: `${Math.min(
                        Math.max(
                          (((run.finishedAt?.getTime() ?? Date.now()) - run.startedAt.getTime()) / окно.длина) * 100,
                          1,
                        ),
                        100,
                      ).toFixed(1)}%`,
                    }}
                  />
                </span>
              )}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function Step({ step }: { readonly step: StepRow }) {
  return (
    <li className="grid grid-cols-[auto_1fr] gap-x-3.5 border-b border-[var(--line-2)] px-4 py-3 last:border-b-0">
      <Pill
        className="mt-px shrink-0"
        dot={step.status !== "заблокирован"}
        label={step.status}
        loud={step.status === "заблокирован"}
        tone={STEP_TONE[step.status]}
      />
      <div className="min-w-0">
        <p className="m-0 flex flex-wrap items-baseline gap-x-2.5">
          <span className="text-[var(--t-body)] font-semibold">{step.agent}</span>
          <span className="meta">{step.produces.join(" · ")}</span>
        </p>

        {step.doneAt === null ? null : (
          <p className="meta m-0 mt-1">
            {`исполнен ${formatMoment(step.doneAt)}`}
            {step.attempts !== null && step.attempts > 1 ? ` · попыток ${step.attempts}` : ""}
          </p>
        )}

        {/* Отказ с ценой ошибки человек обдумывает; отказ без причины — обходит.
            Поэтому последствие показывается рядом с непройденным предусловием,
            а не прячется в подсказку. */}
        {step.blocks.length === 0 ? null : (
          <ul className="mt-2 flex list-none flex-col gap-1.5 p-0">
            {step.blocks.map((block) => (
              <li className="rounded-[var(--r-sm)] bg-[var(--danger-soft)] px-3 py-2" key={block.subject}>
                <p className="m-0 text-[var(--t-meta)]">
                  <span className="font-semibold">{`предмет «${block.subject}»`}</span>
                  {`: ожидается ${block.expected.join(" или ")}, сейчас ${block.actual}`}
                </p>
                {block.consequence === undefined ? null : (
                  <p className="m-0 mt-1 text-[var(--t-meta)] font-semibold text-[var(--danger)]">
                    {`последствие нарушения: ${block.consequence}`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function Stage({ stage }: { readonly stage: StageRow }) {
  const done = stage.steps.filter((step) => step.status === "исполнен").length;

  return (
    <Card>
      <CardHead aside={`${done} из ${stage.steps.length} исполнено`} title={`${stage.id} · ${stage.name}`} />
      <CardBody flush>
        <ul className="m-0 list-none p-0">
          {stage.steps.map((step) => (
            <Step key={step.agent} step={step} />
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/**
 * Что проверить человеку — СВЕДЁННОЕ по всем агентам прогона.
 *
 * Восьмая графа формы результата жила только на экране одного агента: чтобы
 * собрать список поручений по прогону, надо было обойти девять экранов и
 * сложить их в голове. А спрашивают его именно по прогону — «что мы должны
 * сделать до понедельника», а не «что просил экономист».
 *
 * Склейка по тексту и владельцу — та же, что внутри агента: один и тот же
 * вопрос по четырём сметам задаётся четыре раза, а поручение остаётся одним.
 */
function collectQuestions(
  agents: readonly ReviewAgentView[],
  roster: ReturnType<typeof agentRoster>,
): readonly (readonly [OpenQuestionView, string])[] {
  const collected: (readonly [OpenQuestionView, string])[] = [];

  for (const agent of agents) {
    const who = roster.get(agent.capability)?.person ?? agent.capability;

    for (const question of agent.openQuestions) {
      if (
        collected.some(([known]) => known.question === question.question && known.owner === question.owner)
      ) {
        continue;
      }
      collected.push([question, who]);
    }
  }

  return collected;
}

/** Поручения по адресату, тяжёлые адресаты сверху. */
function byOwner(
  questions: readonly (readonly [OpenQuestionView, string])[],
): readonly (readonly [string, readonly (readonly [OpenQuestionView, string])[]])[] {
  const byWhom = new Map<string, (readonly [OpenQuestionView, string])[]>();

  for (const item of questions) {
    // Поручение ДВОИМ попадает к обоим: «Заказчик и руководитель проекта» —
    // это два получателя, а не третий, которого не существует.
    for (const кому of адресаты(item[0].owner)) {
      const bucket = byWhom.get(кому);
      if (bucket === undefined) byWhom.set(кому, [item]);
      else bucket.push(item);
    }
  }

  return [...byWhom.entries()].sort(
    (left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0], "ru"),
  );
}

export default async function CheckPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string; id: string }>;
  searchParams: Promise<{ важность?: string }>;
}) {
  const { code, id } = await params;
  const viewer = await currentViewer();

  if (viewer.kind === "гость") {
    return (
      <main className="mx-auto max-w-[1280px] px-6 py-8">
        <StateDenied permission="check:read" reason={viewer.reason} />
      </main>
    );
  }

  const shell = shellOf("S-05", viewer.viewer, [
    { href: `/objects/${encodeURIComponent(code)}`, label: decodeURIComponent(code) },
    { label: "Проверка" },
  ], decodeURIComponent(code));
  const decision = viewer.viewer.can("check:read");

  if (!decision.allowed) {
    return shell(
      <Page wide>
        <StateDenied permission="check:read" reason={decision.reason} />
      </Page>,
    );
  }

  let card;
  try {
    card = await readCheck(viewer.viewer.actor.tenantId, code, id);
  } catch (error) {
    return shell(
      <Page wide>
        <StateFailed>{(error as Error).message}</StateFailed>
      </Page>,
    );
  }

  if (card === undefined) notFound();

  const allSteps = card.stages.flatMap((stage) => stage.steps);
  const steps = allSteps.length;
  const derived = allSteps.filter((step) => step.derived).length;

  /**
   * Обзор берётся у ПЕРВОГО артефакта, у которого он есть.
   *
   * Артефакты отсортированы свежим сверху, и у прогона их бывает несколько:
   * обход объекта и сравнение КП. Разрез по агентам живёт только у первого, и
   * склеивать замечания двух разных операций значило бы сложить в один список
   * выводы о разных предметах.
   */
  const review = card.artifacts.find((artifact) => artifact.review !== null)?.review ?? null;
  const roster = agentRoster();
  const questions = review === null ? [] : collectQuestions(review.agents, roster);

  /**
   * Переход к строке ПРОВЕРЕННОЙ версии — тот же расчёт, что на экране агента.
   *
   * Один расчёт на два экрана: разойдись они, одна и та же находка вела бы в
   * разные документы в зависимости от того, откуда на неё нажали.
   */
  const versions = await versionsByContentHash(viewer.viewer.actor.tenantId, code);

  const адресСтроки = (finding: ReviewFindingView): string | null => {
    const source = finding.source;
    if (source === null || source.row === null || source.contentHash === null) return null;

    const versionId = versions.get(source.contentHash);
    if (versionId === undefined) return null;

    return `/objects/${encodeURIComponent(code)}/documents/${versionId}?${new URLSearchParams({
      строка: String(source.row),
    }).toString()}#строка-${source.row}`;
  };

  const сильные =
    review === null
      ? []
      : strongest(
          review.agents.flatMap((agent) =>
            agent.findings.map((finding) => ({
              finding,
              capability: agent.capability,
              person: roster.get(agent.capability)?.person ?? agent.capability,
            })),
          ),
        );

  const { важность } = await searchParams;
  // Отбор ПО ВАЖНОСТИ — тот же орган и тот же параметр адреса, что на экране
  // агента. Разные имена параметра на двух экранах одного продукта заставляли
  // бы читателя учить два языка отбора.
  const chosen =
    важность !== undefined && review !== null && review.agents.some((agent) => agent.findings.some((finding) => finding.severity === важность))
      ? важность
      : undefined;

  const severityCounts: readonly FilterOption[] =
    review === null
      ? []
      : SEVERITY_SCALE.filter(([key]) =>
          review.agents.some((agent) => agent.findings.some((finding) => finding.severity === key)),
        ).map(([key, word]) => ({
          value: key,
          label: word,
          count: review.agents.reduce(
            (sum, agent) => sum + agent.findings.filter((finding) => finding.severity === key).length,
            0,
          ),
        }));

  const filterHref = (value: string | undefined): string => {
    const base = `/objects/${encodeURIComponent(card.objectCode)}/checks/${encodeURIComponent(card.id)}`;
    return value === undefined ? base : `${base}?${new URLSearchParams({ важность: value }).toString()}`;
  };

  return shell(
    <Page wide>
      <ObjectHead
        active="проверка"
        aside={
          <>
            <dl className="m-0 flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <div className="flex items-baseline gap-2">
                <dt className="meta">режим</dt>
                <dd className="m-0 text-[var(--t-meta)] font-semibold">{card.mode}</dd>
              </div>
              {/* БЫСТРЫЙ ПОМЕЧЕН БЫСТРЫМ, и это требование вехи, а не украшение:
                  прогон на одном агенте, выглядящий как полная Проверка, —
                  худшее из возможных, потому что выглядит убедительно. */}
              {card.fast ? (
                <div className="flex items-baseline gap-2">
                  <dt className="meta">вид</dt>
                  <dd className="m-0">
                    <Pill dot label="быстрый проход" tone="warn" />
                  </dd>
                </div>
              ) : null}
              <div className="flex items-baseline gap-2">
                <dt className="meta">состояние</dt>
                <dd className="m-0">
                  <Pill dot label={checkStatusWord(card.status).label} tone={checkStatusWord(card.status).tone} />
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="meta">полнота</dt>
                {/* Класс полноты — не украшение: сводный вывод §5.3 имеет право
                    нести только `full` (ADR-R-022). */}
                <dd className="m-0">
                  <Pill dot label={card.completeness} tone={card.completeness === "full" ? "ok" : "warn"} />
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="meta">начата</dt>
                <dd className="num m-0 text-[var(--t-meta)]">{formatMoment(card.createdAt)}</dd>
              </div>
              {/* Этап — только у идущего прогона: у завершённого он пуст, и это
                  не пробел, а отсутствие предмета. */}
              {card.phase === null ? null : (
                <div className="flex items-baseline gap-2">
                  <dt className="meta">этап</dt>
                  <dd className="m-0 text-[var(--t-meta)] font-semibold">{card.phase}</dd>
                </div>
              )}
              {/* ОЧЕРЕДЬ. Воркер один: поставленная Проверка ждёт своей очереди,
                  и «в очереди» без числа впереди стоящих — это половина ответа.
                  Точного времени не знает никто, а «перед вами две» — знание, с
                  которым человек решает: ждать или снять чужую. */}
              {card.status === "queued" ? (
                <div className="flex items-baseline gap-2">
                  <dt className="meta">очередь</dt>
                  <dd className="m-0 text-[var(--t-meta)] font-semibold">
                    {card.queueAhead === 0
                      ? "следующая на воркере"
                      : `${plural(card.queueAhead, СЛОВО.проверка)} впереди`}
                  </dd>
                </div>
              ) : null}
            </dl>
            {/* Опрос идёт, только пока прогон живой, и сам себя прекращает. */}
            <AutoRefresh active={card.live} />
            {/* КНОПКА ВЕДЁТ НА ПАКЕТ ЭТОГО ПРОГОНА, А ВКЛАДКА — ПОСЛЕДНЕГО.
                Это разные адреса, и разница существенна при чтении старого
                прогона: вкладка увела бы к свежему пакету молча. Кнопки
                «Агенты» здесь больше нет — она стала вкладкой, а два входа в
                одно место рядом друг с другом читаются как два разных. */}
            <ButtonLink
              href={`/objects/${encodeURIComponent(card.objectCode)}/checks/${encodeURIComponent(card.id)}/package`}
              size="sm"
              variant="primary"
            >
              <FileText aria-hidden="true" size={12} />
              Пакет этого прогона
            </ButtonLink>
          </>
        }
        code={card.objectCode}
        name={card.objectName}
        note={`${card.workflowName} · прогон ${card.id.slice(0, 8)}`}
      />

      {/* Не отказ, а сведение. Красная рамка «не удалось получить данные»
          сообщала бы о сбое там, где сбоя нет: Проверка запущена операцией
          напрямую, а не воркфлоу из конфигурации, поэтому тактов у неё и не
          должно быть. Отличать «сломалось» от «так устроено» — обязанность
          экрана, иначе читатель идёт чинить исправное. */}
      {/* Кого НЕ ЗВАЛИ — поимённо. «Проверка без Ваныча» и «Ваныч не нашёл
          замечаний» — противоположные утверждения, и без этой врезки читатель
          не может их различить: на доске агентов оба выглядят как молчание. */}
      {card.fast ? (
        <Callout title="Это быстрый проход, а не полная Проверка" tone="warn">
          {`Воркфлоу «${card.workflowName}» зовёт не всех агентов: не участвуют ${card.notInvited.join(", ")}. ` +
            "Их молчание здесь означает «не звали», а не «замечаний нет». Полный прогон быстрый не отменяет и не подменяет: " +
            "он ставится отдельно и имеет свой адрес."}
        </Callout>
      ) : null}

      {card.workflowMissing ? (
        <Callout title="Тактов у этой Проверки нет" tone="info">
          {`Она запущена операцией «${card.workflowId}» напрямую, а не воркфлоу из config/workflows. Результат операции ниже; протокол тактов 0–4 показывается только для Проверок, запущенных воркфлоу.`}
        </Callout>
      ) : null}

      {/* ИДУЩИЙ ПРОГОН БЕЗ ЕДИНОЙ ЗАПИСИ ХОДА — ЭТО НЕ «ПУСТО», А «ЖДЁТ».
          Пустой каркас на этом месте читался бы как сбой: человек идёт чинить
          исправное. Отличать «ещё не начали» от «сломалось» обязан экран. */}
      {card.live && card.runs.length === 0 ? (
        <Callout title="Прогон поставлен, ход ещё не начался" tone="info">
          {card.status === "queued"
            ? "Задача стоит в очереди: воркер её ещё не взял. Первые записи хода появятся, как только начнётся обход папки — экран обновляется сам."
            : "Воркер взял задачу и идёт по папке объекта. Агенты появятся здесь по одному, каждый в момент, когда высказался, — ждать конца прогона не нужно."}
        </Callout>
      ) : null}

      {/* УЗКАЯ КОЛОНКА В ПИКСЕЛЯХ, А НЕ ВО `fr`.
          Правая колонка была `1fr` при левой `1.55fr` — почти пятьсот пикселей
          под одну карточку «Предметов нет». Ниже неё шли три десятка прокруток
          левой колонки против пустоты справа. `.split` — тот же приём, что на
          экране агента: 320–380 px, «липко», в одну колонку ниже 1100 px. */}
      <div className="split">
        <div className="flex flex-col gap-4">
          {/* ХОД ПРОГОНА ВЫШЕ РЕЗУЛЬТАТА, пока прогон идёт: пока он не кончился,
              единственное, что можно прочитать, — это он. У завершённого
              главное — результат, и лента уходит под него. */}
          {card.live && card.runs.length > 0 ? <Progress card={card} /> : null}

          {/* ПЕРВОЙ КАРТОЧКОЙ У ЗАВЕРШЁННОГО ПРОГОНА — то, ради чего экран
              открывают на встрече. У идущего выше стоит ход: пока прогон не
              кончился, перечень неполон, и объявлять его «тем, что показать»
              значило бы предложить пятёрку из первых высказавшихся. */}
          {review === null ? null : (
            <Strongest checkId={card.id} hrefOf={адресСтроки} items={сильные} objectCode={card.objectCode} />
          )}

          {card.artifacts.map((artifact) => (
            <Fragment key={artifact.id}>
              <Artifact artifact={artifact} />
              {artifact.documents.length === 0 ? null : <Documents documents={artifact.documents} />}
            </Fragment>
          ))}

          {/* ОТБОР СТОИТ ВПЛОТНУЮ К ТОМУ, ЧТО ОТБИРАЕТ.
              Сначала он стоял под шапкой экрана — над результатом обхода,
              документами и тактами, то есть в трёх карточках от списка, на
              который влияет. Орган управления, оторванный от своих данных,
              читается как отбор всего экрана. */}
          {severityCounts.length < 2 ? null : (
            <div className="toolbar">
              <FilterBar {...(chosen === undefined ? {} : { reset: filterHref(undefined) })}>
                <FilterGroup
                  active={chosen}
                  allCount={review?.findings ?? 0}
                  allLabel="все замечания"
                  hrefFor={(value) => filterHref(value)}
                  label="Важность"
                  options={severityCounts}
                />
              </FilterBar>
            </div>
          )}

          {review === null ? null : (
            <AgentFindings
              checkId={card.id}
              chosen={chosen}
              hrefOf={адресСтроки}
              objectCode={card.objectCode}
              review={review}
            />
          )}

          {!card.live && card.runs.length > 0 ? <Progress card={card} /> : null}

          {card.stages.map((stage) => (
            <Stage key={stage.id} stage={stage} />
          ))}
        </div>

        <aside className="split__aside">
          {/* ЧТО ПРОВЕРИТЬ ЧЕЛОВЕКУ — ПЕРВЫМ В ПАНЕЛИ, и это не вопрос вкуса.
              Из всего, что есть на экране, поручения — единственное, что
              читатель уносит с собой. Остальное объясняет прогон, а это
              задаёт работу. */}
          {questions.length === 0 ? null : (
            <Card>
              <CardHead
                aside={`${questions.length} шт. · ${byOwner(questions).length} адресатов`}
                note="Сведено по всем агентам прогона и сгруппировано по адресату: поручают человеку, а не прогону. Вопрос без владельца и срока — не поручение, а пожелание (ТЗ §9)."
                title="Что проверить человеку"
              />
              <CardBody flush>
                {/* ПО АДРЕСАТУ, А НЕ СПЛОШНЫМ СПИСКОМ.
                    На курганском прогоне поручений восемьдесят пять. Списком
                    это полторы тысячи пикселей в колонке 340 px — стена, из
                    которой нельзя вынуть свою часть. А вынимают её именно по
                    адресату: «что от проектировщика», «что от ПТО». */}
                {byOwner(questions).map(([owner, items]) => (
                  <details className="agroup" key={owner}>
                    <summary className="agroup__head">
                      <span className="agroup__person">{owner}</span>
                      <span className="agroup__marks">
                        <Pill dot label={`${items.length} шт.`} tone="info" />
                      </span>
                    </summary>
                    <ul className="m-0 list-none p-0">
                      {items.map(([question, who]) => (
                        <li className="crit crit--info" key={`${question.owner}/${question.question}`}>
                          <span className="crit__body">
                            <span className="crit__statement">{question.question}</span>
                            <span className="crit__basis">{`срок: ${question.dueBy} · просит ${who}`}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </CardBody>
            </Card>
          )}

          {/* СВЕТОФОРЫ ОБЪЕКТНЫХ АГЕНТОВ. Вердикт по объекту целиком —
              «идём / не идём» — лежал внутри ста шестидесяти семи замечаний
              одной строкой прозы и терялся там полностью. */}
          {review === null || review.agents.length === 0 ? null : (
            <Card>
              <CardHead
                aside={plural(review.agents.length, СЛОВО.агент)}
                note="Светофор ставит сам агент. Где он его не поставил, класс назван неназванным."
                title="Итог по агентам"
              />
              <CardBody flush>
                <VerdictLights
                  verdicts={review.agents.flatMap((agent) => {
                    const who = roster.get(agent.capability)?.person ?? agent.capability;

                    return agent.verdicts.map((verdict) => ({
                      ...verdict,
                      /**
                       * Подпись — АВТОР И ПРЕДМЕТ, оба.
                       *
                       * Одним автором подписывать нельзя: у Денчика четыре
                       * вердикта по четырём сметам, и три «не принимать»
                       * подряд под одним именем читаются как повтор строки, а
                       * не как четыре решения по четырём документам. Одним
                       * предметом — тоже: по одной смете высказываются трое.
                       */
                      subject: verdict.subject === "" ? who : `${who} · ${verdict.subject}`,
                    }));
                  })}
                />
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHead aside="общие предметы гейтов" title="Состояние предметов" />
            <CardBody flush>
              <DataTable
                caption="Предметы гейтов: состояние, число возвратов и время обновления"
                columns={SUBJECT_COLUMNS}
                empty={
                  <StateEmpty title="Предметов нет">
                    Прогон не дошёл до создания предметов либо воркфлоу их не заводит.
                  </StateEmpty>
                }
                rowKey={(row) => row.id}
                rows={card.subjects}
              />
            </CardBody>
          </Card>

          {card.artifactsTotal === 0 ? (
            <Card>
              <CardHead aside="канонические результаты" title="Артефакты" />
              <CardBody flush>
                <StateEmpty title="Артефактов нет">
                  {card.agentRunsTotal === 0
                    ? "Ни один агент не отработал: шаги, дошедшие до исполнения, не производят канонических артефактов без настроенного endpoint модели."
                    : "Прогоны агентов есть, но артефакты не сохранены."}
                </StateEmpty>
              </CardBody>
            </Card>
          ) : null}

          {/* Признак вычисленности обязателен. «Заблокирован» прочитанный и
              «заблокирован» вычисленный — разные утверждения: первое говорит,
              что так БЫЛО, второе — что так ЕСТЬ по конечному состоянию. */}
          {steps === 0 ? null : (
            <p className="meta m-0">
              {`Из ${steps} шагов ${derived} показаны с вычисленным состоянием: база хранит только исполненные шаги, а блокировки выведены из состояния предметов тем же предикатом, которым пользуется протокол.`}
            </p>
          )}
        </aside>
      </div>
    </Page>,
  );
}
