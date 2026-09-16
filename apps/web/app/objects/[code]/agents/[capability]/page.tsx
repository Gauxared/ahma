/**
 * Замечания одного агента.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ЭКРАН, А НЕ РАСКРЫТИЕ НА ДОСКЕ
 *
 * У ГИПа на курганском прогоне сорок шесть замечаний, у ПТО тридцать. Раскрытие
 * плитки превратило бы доску в полотно, на котором не видно ни конвейера, ни
 * кросс-валидации, — а доска существует ради них. Плюс адрес: «покажи, что
 * сказал Виктор» — это ссылка, которую пересылают.
 *
 * ПОРЯДОК — ПО ВАЖНОСТИ, А НЕ ПО ПОРЯДКУ ОТВЕТА МОДЕЛИ
 *
 * Агент отдаёт замечания в том порядке, в каком их сформулировал, и этот порядок
 * ничего не значит. Читателю нужно тяжёлое сверху.
 *
 * ОСНОВАНИЕ ПОКАЗАНО ЦЕЛИКОМ И НАЗВАНО ПРОЗОЙ
 *
 * ТЗ §9: замечание без основания — не вывод. Но основание здесь — текст,
 * который написал агент, а не след расчёта, и подписано оно именно так.
 * Обрезать его многоточием значило бы спрятать единственное, чем замечание
 * можно проверить.
 */
import { currentViewer } from "@web/lib/actor";
import { agentOf, readAgentsBoard } from "@web/lib/agents-read-model";
import type { ReviewFindingView } from "@web/lib/check-read-model";
import { versionsByContentHash } from "@web/lib/documents-read-model";
import { latestCheckId, latestCheckWithArtifact, liveCheckId } from "@web/lib/latest-check";
import { AutoRefresh } from "@web/src/ui/auto-refresh.js";
import { shellOf } from "@web/src/app-shell/shell.js";
import { ButtonLink } from "@web/src/ui/kit/button.js";
import { Callout } from "@web/src/ui/kit/callout.js";
import { FilterBar, FilterGroup, type FilterOption } from "@web/src/ui/kit/filters.js";
import { Card, CardBody, CardHead } from "@web/src/ui/kit/card.js";
import { Finding, SEVERITY_SCALE, byWeight, severityWord } from "@web/src/ui/command/finding.js";
import { VerdictLights, Verdicts } from "@web/src/ui/command/verdict.js";
import { Page, PageHead } from "@web/src/ui/kit/page.js";
import { StateDenied, StateEmpty } from "@web/src/ui/kit/states.js";
import { plural, СЛОВО } from "@web/src/ui/value/format.js";

export const dynamic = "force-dynamic";

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string; capability: string }>;
  searchParams: Promise<{ прогон?: string; важность?: string }>;
}) {
  const { code, capability } = await params;
  const result = await currentViewer();

  if (result.kind === "гость") {
    return (
      <Page>
        <PageHead title="Замечания агента" />
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

  const boardTrail = `/objects/${encodeURIComponent(code)}/agents`;
  const agentHref = `${boardTrail}/${encodeURIComponent(capability)}`;
  const decision = result.viewer.can("check:read");

  if (!decision.allowed) {
    return shellOf("агенты", result.viewer, [{ label: code }, { label: "Агенты" }], decodeURIComponent(code))(
      <Page>
        <PageHead title="Замечания агента" />
        <Card>
          <CardBody>
            <StateDenied permission="check:read" reason={decision.reason} />
          </CardBody>
        </Card>
      </Page>,
    );
  }

  const { прогон, важность } = await searchParams;
  const tenantId = result.viewer.actor.tenantId;
  // Выбор прогона — ТОТ ЖЕ, что на доске, и порядок тот же: идущий, потом
  // свежий с артефактом, потом просто последний. Разойдись они — переход с
  // доски на агента уводил бы в другой прогон, и замечания на двух экранах
  // оказались бы разными при одинаковых заголовках.
  const checkId =
    прогон ??
    // Порядок: НАЧАВШИЙСЯ прогон → свежий с артефактом → просто поставленный →
    // просто последний. Стоящий в очереди идёт после артефакта намеренно: у
    // него показать нечего, а у прогона с артефактом есть что.
    (await liveCheckId(tenantId, code, { started: true })) ??
    (await latestCheckWithArtifact(tenantId, code)) ??
    (await liveCheckId(tenantId, code)) ??
    (await latestCheckId(tenantId, code));
  const board = checkId === undefined ? undefined : await readAgentsBoard(tenantId, code, checkId);
  const agent = board === undefined ? undefined : agentOf(board, capability);

  const shell = shellOf("агенты", result.viewer, [
    { label: code, href: `/objects/${encodeURIComponent(code)}` },
    { label: "Агенты", href: boardTrail },
    { label: agent?.person ?? capability },
  ], decodeURIComponent(code));

  if (board === undefined || agent === undefined) {
    return shell(
      <Page>
        <PageHead title="Замечания агента" />
        <Card>
          <CardBody>
            <StateEmpty title="Агент не найден в этом прогоне">
              Способности «{capability}» в прогоне по объекту {code} нет — ни в тактах воркфлоу, ни среди
              высказавшихся. <a href={boardTrail}>Открыть доску агентов</a>.
            </StateEmpty>
          </CardBody>
        </Card>
      </Page>,
    );
  }

  const sorted = [...agent.findings].sort(byWeight);

  /**
   * Адрес строки ПРОВЕРЕННОЙ версии — или `null`, если дойти нельзя.
   *
   * Ссылка появляется, ТОЛЬКО когда есть всё: строка, отпечаток разобранного
   * файла и версия с этим отпечатком в базе. Ссылка, ведущая в никуда, хуже её
   * отсутствия; ссылка, ведущая в ПОХОЖЕЕ место, хуже обеих — до Т6.4 переход
   * искал самую свежую ревизию по имени файла, и после перезаливки сметы он
   * молча приводил к другим строкам.
   *
   * Чего именно не хватило, видно из самого замечания: координата рядом
   * остаётся словами, а отпечаток версии показан подписью.
   */
  const versions = await versionsByContentHash(tenantId, code);

  const адресСтроки = (finding: ReviewFindingView): string | null => {
    const source = finding.source;
    if (source === null || source.row === null || source.contentHash === null) return null;

    const versionId = versions.get(source.contentHash);
    if (versionId === undefined) return null;

    return `/objects/${encodeURIComponent(code)}/documents/${versionId}?${new URLSearchParams({
      строка: String(source.row),
    }).toString()}#строка-${source.row}`;
  };

  /**
   * ОТБОР ПО ВАЖНОСТИ — ССЫЛКАМИ, КАК В ЖУРНАЛЕ.
   *
   * У Людмилы восемнадцать замечаний, у ГИПа сорок шесть. На встрече из них
   * выбирают три-пять сильных, и «покажи только критичные» — это то, что
   * произносят вслух. Без отбора это делается прокруткой и памятью.
   *
   * Отбор живёт в адресе: отобранный список обязан открываться по ссылке,
   * иначе его нельзя ни прислать, ни вернуть кнопкой «назад».
   */
  const chosen = важность === undefined ? undefined : важность;
  const shown = chosen === undefined ? sorted : sorted.filter((finding) => finding.severity === chosen);

  // Число берётся по ВСЕМ замечаниям агента, а не по показанным: отбор без
  // числа — предложение вслепую, а число от показанного всегда равнялось бы
  // самому себе.
  const counts: readonly FilterOption[] = SEVERITY_SCALE.filter(([key]) =>
    sorted.some((finding) => finding.severity === key),
  ).map(([key, word]) => ({
    value: key,
    label: word,
    count: sorted.filter((finding) => finding.severity === key).length,
  }));

  const filterHref = (value: string | undefined): string => {
    const query = new URLSearchParams();
    if (прогон !== undefined) query.set("прогон", прогон);
    if (value !== undefined) query.set("важность", value);
    const tail = query.toString();

    return tail === "" ? agentHref : `${agentHref}?${tail}`;
  };

  return shell(
    <Page wide>
      <PageHead
        aside={
          <>
            {agent.bySeverity.map(([word, count]) => (
              <span className="meta" key={word}>
                <span className="num font-semibold text-[var(--text-2)]">{count}</span> {word}
              </span>
            ))}
            {/* Пока прогон идёт, экран устаревает сам: агент может добавить
                замечания по следующей смете, пока его читают. */}
            <AutoRefresh active={board.live} />
            <ButtonLink href={boardTrail} size="sm">
              Доска агентов
            </ButtonLink>
          </>
        }
        note={`${agent.role} · ${agent.capability} · объект ${board.objectCode}`}
        title={agent.person}
      />

      {agent.state.kind === "отказ" ? (
        <Callout title="Агент отказался" tone="danger">
          Он запускался и не смог — это не «замечаний нет».
          <ul className="m-0 mt-1.5 pl-5">
            {agent.state.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      {/* ПРЕДВАРИТЕЛЬНОЕ ПОМЕЧЕНО И ЗДЕСЬ, а не только на доске. Замечания
          читают на этом экране, и умолчать о том, что прогон ещё идёт, значило
          бы выдать запись о попытке за окончательный результат. */}
      {agent.preliminary ? (
        <Callout title="Прогон ещё идёт: замечания предварительные" tone="info">
          Они взяты из хода прогона, а не из его артефакта: агент высказался, но обход объекта не закончен. Попытка
          агента может быть переиграна — тогда эти замечания заменятся. Из артефакта они уже не меняются.
        </Callout>
      ) : null}

      {agent.state.kind === "работает" ? (
        <Callout title="Агент работает прямо сейчас" tone="info">
          {agent.state.since === null
            ? "Он взялся за предмет и ещё не ответил."
            : `Он взялся за предмет в ${agent.state.since.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} и ещё не ответил.`}{" "}
          Показанное ниже — то, что он успел сказать по другим предметам, а не итог его работы.
        </Callout>
      ) : null}

      {/* ВЕРДИКТ — ПОЛОСОЙ ВО ВСЮ ШИРИНУ, А НЕ В УЗКОЙ КОЛОНКЕ.
          Он стоял в панели контекста и был там нечитаем: четыре вердикта по
          сметам, склеенные в абзац, дают в колонке 340 px шестьдесят строк —
          выше экрана, то есть «липкость» панели не работала даже как приём.
          Сеткой во всю ширину те же четыре вердикта читаются одним взглядом.

          Выше замечаний, а не под ними: замечания на вердикт опираются, и
          читать их прежде него значит читать доводы прежде утверждения. То,
          что держит вердикт на виду ПРИ ПРОКРУТКЕ, уехало в панель справа —
          но не прозой, а светофорами (`VerdictLights`). */}
      <Card>
        <CardHead
          aside={
            agent.verdicts.length === 0
              ? "вердикта нет"
              : `${plural(agent.verdicts.length, СЛОВО.предмет)} · охват: ${agent.scope ?? "не объявлен"}`
          }
          note="Светофор ставит сам агент. Где он его не поставил, класс назван неназванным: досчитывать вывод за агента нельзя."
          title="Вердикт агента"
        />
        <CardBody>
          {agent.verdicts.length === 0 ? (
            <StateEmpty title="Вердикт не выдан">
              {agent.state.kind === "не-запускался"
                ? "Агент не работал — итога по предмету он не давал."
                : "Агент высказался замечаниями, но итога не сформулировал."}
            </StateEmpty>
          ) : (
            <Verdicts verdicts={agent.verdicts} />
          )}
        </CardBody>
      </Card>

      {/* ДВУХКОЛОННЫЙ РАЗРЕЗ: СПИСОК СЛЕВА, КОНТЕКСТ СПРАВА.
          Числа Домовея (`.vc-layout`): узкая колонка в пикселях, широкая во
          `fr`, переход в одну колонку на 1100 px. */}
      {/* Строка отбора — над данными и одной строкой, как `.dir-toolbar`
          Домовея: чипы слева, действие справа. Карточки под неё не отводится:
          отбор — орган управления, а не блок данных. */}
      {counts.length < 2 ? null : (
        <div className="toolbar">
          <FilterBar {...(chosen === undefined ? {} : { reset: filterHref(undefined) })}>
            <FilterGroup
              active={chosen}
              allCount={sorted.length}
              allLabel="все замечания"
              hrefFor={(value) => filterHref(value)}
              label="Важность"
              options={counts}
            />
          </FilterBar>
        </div>
      )}

      <div className="split">
        <Card>
          <CardHead
            aside={
              chosen === undefined
                ? `${sorted.length} шт. · тяжёлое сверху`
                  // Слово, а не ключ: `critical` — это то, чем важность
                  // называется в артефакте, а не то, чем её называет человек.
                : `${shown.length} из ${sorted.length} · отбор: ${severityWord(chosen)[0]}`
            }
            note="Основание — проза агента, а не след расчёта: так и подписано."
            title="Замечания"
          />
          <CardBody flush>
            {shown.length === 0 ? (
              <StateEmpty title="Замечаний нет">
                {agent.state.kind === "работает"
                  ? "Агент работает и пока ничего не сказал. Это утверждение о минуте, а не об объекте: экран обновится, когда он ответит."
                  : "Агент отработал и замечаний не нашёл. Это утверждение об объекте, а не о прогоне: если бы агент не работал, экран сказал бы это иначе."}
              </StateEmpty>
            ) : (
              /* Тон — полосой по краю строки, номер — у пилюли. Разметка общая
                 с рабочим экраном Проверки (`Finding`): два списка одних и тех
                 же замечаний, набранные по-разному, читались как два разных
                 списка.
                 Ограничиваем высоту списка, чтобы его скроллбар был рядом со списком,
                 а не на краю всего экрана (Task 2). */
              <ol className="m-0 list-none p-0 max-h-[70vh] overflow-y-auto overscroll-contain">
                {shown.map((finding, index) => (
                  <Finding
                    finding={finding}
                    href={адресСтроки(finding)}
                    key={`${finding.severity}-${index}`}
                    ordinal={index + 1}
                  />
                ))}
              </ol>
            )}
          </CardBody>
        </Card>

        <aside className="split__aside">
          {/* СВЕТОФОРЫ, А НЕ ПРОЗА. Прокручивая сорок шесть замечаний, читатель
              возвращается к вердикту с одним вопросом — «по какой смете
              красный». Это четыре короткие строки, и им «липкость» панели
              подходит; полутора тысячам знаков — нет. Полный текст стоит
              полосой выше, и дублировать его здесь незачем. */}
          {agent.verdicts.length === 0 ? null : (
            <Card>
              <CardHead
                aside={plural(agent.verdicts.length, СЛОВО.предмет)}
                note="Итог по каждому предмету одним взглядом. Полный текст — в карточке вердикта выше."
                title="Итог по предметам"
              />
              <CardBody flush>
                <VerdictLights verdicts={agent.verdicts} />
              </CardBody>
            </Card>
          )}

          {/* ЧТО ПРОВЕРИТЬ ЧЕЛОВЕКУ — восьмая графа формы результата (Д3).
              Её не было на экране вовсе: агент задавал вопросы, оболочка их
              складывала, а девять портов отбрасывали. Рядом с вердиктом, а не
              внутри замечаний: у поручения владелец и срок, а не важность. */}
          <Card>
            <CardHead
              aside={agent.openQuestions.length === 0 ? "вопросов нет" : `${agent.openQuestions.length} шт.`}
              note="Вопрос без владельца и срока — не поручение, а пожелание (ТЗ §9)."
              title="Что проверить человеку"
            />
            <CardBody flush>
              {agent.openQuestions.length === 0 ? (
                <StateEmpty title="Открытых вопросов нет">
                  {agent.state.kind === "не-запускался"
                    ? "Агент не работал — спрашивать ему было нечего."
                    : "Агент отработал и вопросов к человеку не оставил: всё, что нужно, он проверил сам."}
                </StateEmpty>
              ) : (
                <ul className="m-0 list-none p-0">
                  {agent.openQuestions.map((question) => (
                    <li className="crit crit--info" key={`${question.owner}/${question.question}`}>
                      <span className="crit__body">
                        <span className="crit__statement">{question.question}</span>
                        <span className="crit__basis">{`кому: ${question.owner} · срок: ${question.dueBy}`}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>

    </Page>,
  );
}
