/**
 * Доска агентов — кто что сказал и в каком порядке.
 *
 * ЧЕГО НЕ БЫЛО И ПОЧЕМУ ЭТО ГЛАВНОЕ
 *
 * Ядро различает девять агентов и на курганском прогоне выдало от них сотню с
 * лишним замечаний. Рабочий экран показывал это ОДНОЙ строкой таблицы: «агент ·
 * все агенты отработали по всем сметам — смет 4, агентов 9, замечаний 176».
 * Read-модель роняла `capability`, то есть личность автора (`Ф-68`).
 *
 * Все три прототипа заказчика держатся на этом экране: тактовый конвейер сверху,
 * кросс-валидация «что убьёт проект» под ним. Их нельзя было построить не из-за
 * нехватки данных, а из-за их потери по дороге.
 *
 * ПОЧЕМУ КОНВЕЙЕР — НАВИГАЦИЯ, А НЕ КАРТИНКА
 *
 * Порядок в системе жёсткий и записан в `config/workflows/full-check.json`:
 * Людмила не начинает, пока Денчик не отдал ВОР; Ваныч не считает финмодель,
 * пока не подписан ВОР и аудит договора. Показать девять агентов списком значило
 * бы утверждать, что они независимы. Они цепочка, и разрыв цепочки — главное,
 * что экран обязан сообщить.
 *
 * КАКОЙ ПРОГОН ПОКАЗАН, И ПОРЯДОК ЗДЕСЬ СТОИЛ ДВУХ ОШИБОК
 *
 * Порядок выбора: НАЧАВШИЙСЯ прогон → свежий с артефактом → просто
 * поставленный в очередь → просто последний. Каждый шаг — след ошибки:
 *
 *  · «просто свежий» показывал только что поставленный прогон и сообщал
 *    «высказалось 0 из 9» — правду, из которой ничего не следует (`Ф-68`);
 *  · «свежий с артефактом» на двадцатой минуте нового прогона показывал
 *    ПРЕДЫДУЩИЙ: артефакт появляется в конце, значит у идущего его нет
 *    (`Ф-123`);
 *  · «любой живой» открывал Проверку, поставленную в день без воркера:
 *    задача живая, начаться не может, показать нечего (`Ф-139`).
 *
 * Показанный прогон НАЗВАН датой и ссылкой на рабочий экран; другой выбирается
 * параметром `?прогон=<id>`. Умолчание не имеет права выглядеть свойством
 * объекта.
 */
import { ArrowRight, Ban, CircleSlash, Loader } from "lucide-react";

import { currentViewer } from "@web/lib/actor";
import { readAgentsBoard, type AgentCard } from "@web/lib/agents-read-model";
import { latestCheckId, latestCheckWithArtifact, liveCheckId } from "@web/lib/latest-check";
import { AutoRefresh } from "@web/src/ui/auto-refresh.js";
import { shellOf } from "@web/src/app-shell/shell.js";
import { ButtonLink } from "@web/src/ui/kit/button.js";
import { Callout } from "@web/src/ui/kit/callout.js";
import { Card, CardBody, CardHead } from "@web/src/ui/kit/card.js";
import { ObjectHead } from "@web/src/ui/command/object-head.js";
import { Page, PageHead } from "@web/src/ui/kit/page.js";
import { Pill, type PillTone } from "@web/src/ui/kit/pill.js";
import { ScrollBox } from "@web/src/ui/kit/scroll-box.js";
import { StateDenied, StateEmpty } from "@web/src/ui/kit/states.js";

export const dynamic = "force-dynamic";

/** Тон и слово состояния — одной таблицей, чтобы они не разошлись по экрану. */
const STATE: Readonly<Record<AgentCard["state"]["kind"], { readonly label: string; readonly tone: PillTone }>> = {
  высказался: { label: "высказался", tone: "ok" },
  отказ: { label: "отказ", tone: "danger" },
  работает: { label: "работает", tone: "info" },
  "не-запускался": { label: "не запускался", tone: "plain" },
};

/**
 * Ссылка на экран агента ВНУТРИ ТОГО ЖЕ ПРОГОНА.
 *
 * Доска принимает `?прогон=<id>` и честно показывает выбранный прогон, а ссылки
 * на агентов его теряли: экран агента выбирал прогон заново, по своему
 * умолчанию. Пока идёт новая проверка, умолчание — идущий прогон, и клик по
 * плитке с двенадцатью замечаниями открывал экран, где их ноль.
 *
 * Читатель при этом не сделал ничего, что означало бы смену прогона. Ошибка
 * того же вида, что уже исправляли на самой доске: экран отвечает не на тот
 * вопрос и выглядит исправным.
 */
function экранАгента(code: string, capability: string, checkId: string | undefined): string {
  const адрес = `/objects/${encodeURIComponent(code)}/agents/${encodeURIComponent(capability)}`;

  return checkId === undefined ? адрес : `${адрес}?прогон=${encodeURIComponent(checkId)}`;
}

function AgentTile({
  agent,
  code,
  checkId,
}: {
  readonly agent: AgentCard;
  readonly code: string;
  readonly checkId: string | undefined;
}) {
  const state = STATE[agent.state.kind];
  const spoke = agent.state.kind === "высказался" || agent.state.kind === "отказ";
  // Открывать имеет смысл и работающего, если он уже что-то сказал: на этом
  // держится вся Д2 — читать находки до конца прогона.
  const readable = spoke || agent.findings.length > 0;

  const inner = (
    <>
      <span className="agent__head">
        <span className="agent__person">{agent.person}</span>
        <Pill dot={!spoke} label={state.label} loud={agent.state.kind === "отказ"} tone={state.tone} />
      </span>
      <span className="agent__role">{agent.role}</span>

      {/* Замечания по важности, а не одним числом: «11 замечаний» и «11
          замечаний, из них 8 критичных» — разные сообщения.

          Третья формулировка появилась вместе с ходом прогона: у работающего
          агента «замечаний не нашёл» было бы обещанием, которого никто не
          давал. Он ещё думает. */}
      {agent.bySeverity.length === 0 ? (
        <span className="agent__quiet">
          {agent.state.kind === "не-запускался"
            ? "замечаний нет, потому что агент не работал"
            : agent.state.kind === "работает"
              ? agent.state.since === null
                ? "агент работает: что нашёл, пока не сказал"
                : `агент работает с ${agent.state.since.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}: что нашёл, пока не сказал`
              : // ОТКАЗ — ЧЕТВЁРТАЯ ФОРМУЛИРОВКА, и её здесь не было: агент с
                // отказом попадал в ветку «отработал и замечаний не нашёл», то
                // есть плитка сообщала об исправной работе там, где агент не
                // смог. Пилюля рядом говорила «отказ» — два разных ответа на
                // один вопрос в одной плитке.
                agent.state.kind === "отказ"
                ? "замечаний нет, потому что агент не смог"
                : "агент отработал и замечаний не нашёл"}
        </span>
      ) : (
        <span className="agent__severity">
          {agent.bySeverity.map(([word, count]) => (
            <span className="agent__severity-item" key={word}>
              <span className="num">{count}</span> {word}
            </span>
          ))}
        </span>
      )}

      {/* ПРЕДВАРИТЕЛЬНОЕ ПОМЕЧЕНО СЛОВОМ. Замечание из хода прогона может
          измениться вместе с переигранной попыткой агента; замечание из
          артефакта — нет. Показать их одинаково значило бы обесценить второе. */}
      {agent.preliminary ? (
        <span className="agent__quiet">предварительно: прогон идёт, артефакт ещё не собран</span>
      ) : null}

      {/* Предусловие СЛОВАМИ. В воркфлоу оно записано как `вор:approved`, и в
          таком виде человеку не говорит ничего. */}
      {agent.requires.length === 0 ? null : (
        <span className="agent__waits">
          {agent.requires.map((need) => (
            <span className="agent__wait" key={need.subject}>
              <ArrowRight aria-hidden="true" size={10} />
              {/* Формулировка выбрана так, чтобы не требовать падежа: реестр
                  хранит имя в именительном («Денчик»), и «от Денчик» читалось
                  неграмотно. Склонять имена кодом — заводить правила русской
                  морфологии ради подписи; тире их не требует. */}
              {need.from === undefined
                ? `ждёт «${need.subject}»`
                : `ждёт «${need.subject}» — производит ${need.from}`}
            </span>
          ))}
        </span>
      )}
    </>
  );

  // Ссылкой становится только тот, у кого есть что открыть: экран замечаний
  // агента, который не работал, показал бы пустоту, названную его именем.
  return readable ? (
    <a className="agent agent--open" href={экранАгента(code, agent.capability, checkId)}>
      {inner}
    </a>
  ) : (
    <span className="agent" title={agent.state.kind === "не-запускался" ? agent.state.reason : undefined}>
      {inner}
    </span>
  );
}

export default async function AgentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ прогон?: string }>;
}) {
  const { code } = await params;
  const result = await currentViewer();

  if (result.kind === "гость") {
    return (
      <Page>
        <PageHead title="Агенты" />
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

  const shell = shellOf("агенты", result.viewer, [
    { label: code, href: `/objects/${encodeURIComponent(code)}` },
    { label: "Агенты" },
  ], decodeURIComponent(code));

  const decision = result.viewer.can("check:read");

  if (!decision.allowed) {
    return shell(
      <Page>
        <PageHead title="Агенты" />
        <Card>
          <CardBody>
            <StateDenied permission="check:read" reason={decision.reason} />
          </CardBody>
        </Card>
      </Page>,
    );
  }

  const { прогон } = await searchParams;
  const tenantId = result.viewer.actor.tenantId;
  // По умолчанию — свежий прогон С АРТЕФАКТОМ: доска про то, что сказали
  // агенты, и открывать её на пустом прогоне значит показывать «0 из 9».
  // Если таких нет вовсе, берётся просто последний — и он сам скажет, что
  // собирать нечего.
  // ИДУЩИЙ ПРОГОН ГЛАВНЕЕ ЗАВЕРШЁННОГО, и это не мелочь порядка. Артефакт
  // появляется в конце, значит у идущего прогона его нет — и выбор «свежий с
  // артефактом» показывал на двадцатой минуте ПРЕДЫДУЩИЙ прогон, с его
  // находками и датой недельной давности.
  const checkId =
    прогон ??
    // Порядок: НАЧАВШИЙСЯ прогон → свежий с артефактом → просто поставленный →
    // просто последний. Стоящий в очереди идёт после артефакта намеренно: у
    // него показать нечего, а у прогона с артефактом есть что.
    (await liveCheckId(tenantId, code, { started: true })) ??
    (await latestCheckWithArtifact(tenantId, code)) ??
    (await liveCheckId(tenantId, code)) ??
    (await latestCheckId(tenantId, code));

  if (checkId === undefined) {
    return shell(
      <Page>
        <PageHead title="Агенты" />
        <Card>
          <CardBody>
            <StateEmpty title="Прогонов по объекту не было">
              Доска агентов показывает конкретный прогон, а прогонов по этому объекту ещё не было. Загрузите документы
              и запустите первый.
            </StateEmpty>
          </CardBody>
        </Card>
      </Page>,
    );
  }

  const board = await readAgentsBoard(tenantId, code, checkId);

  if (board === undefined) {
    return shell(
      <Page>
        <PageHead title="Агенты" />
        <Card>
          <CardBody>
            <StateEmpty title="Прогон не найден">
              Прогона {checkId} по объекту {code} у этого арендатора нет.
            </StateEmpty>
          </CardBody>
        </Card>
      </Page>,
    );
  }

  const run = `/objects/${encodeURIComponent(board.objectCode)}/checks/${encodeURIComponent(board.checkId)}`;

  return shell(
    <Page wide>
      <ObjectHead
        active="агенты"
        aside={
          <>
            <Pill
              dot
              label={`высказалось ${board.spoke} из ${board.total}`}
              tone={board.spoke === board.total ? "ok" : "warn"}
            />
            {/* РАБОТАЮЩИЕ — ОТДЕЛЬНЫМ ЧИСЛОМ, а не внутри «высказалось».
                Пока прогон идёт, вопрос у человека один: движется ли. Одно
                число «высказалось 3 из 9» на него не отвечает — оно
                одинаково у идущего прогона и у брошенного. */}
            {board.working === 0 ? null : (
              <Pill dot label={`работает ${board.working}`} tone="info" />
            )}
            {board.phase === null ? null : <span className="meta">{`идёт: ${board.phase}`}</span>}
            {board.documentsTotal === null ? null : (
              <span className="meta num">
                {`документов ${board.documentsDone ?? 0} из ${board.documentsTotal}`}
              </span>
            )}
            {board.finishedAt === null ? null : (
              <span className="meta num">{board.finishedAt.toLocaleString("ru-RU")}</span>
            )}
            <AutoRefresh active={board.live} />
            <ButtonLink href={run} size="sm">
              Рабочий экран
            </ButtonLink>
          </>
        }
        code={board.objectCode}
        counts={{ агенты: board.total }}
        name={board.objectName}
        note={`Шифр ${board.objectCode} · прогон ${board.workflowId}`}
      />

      {/* Быстрый проход назван быстрым И ЗДЕСЬ: доску открывают, чтобы увидеть
          девять агентов, и семь молчащих плиток без объяснения читаются как
          «система не сработала», а не как «их не звали». */}
      {board.fast ? (
        <Callout title="Это быстрый проход: зовут не всех агентов" tone="warn">
          Воркфлоу «{board.workflowId}» не зовёт: {board.notInvited.join(", ")}. Их плитки молчат потому, что их не
          запускали, — а не потому, что они не нашли замечаний. Полный прогон ставится отдельно и быстрым не
          подменяется.
        </Callout>
      ) : null}

      {board.workflowMissing ? (
        <Callout title="Порядок такта показать нечем" tone="warn">
          Воркфлоу «{board.workflowId}» в конфигурации не найден: такты и предусловия неизвестны. Агенты ниже
          перечислены без порядка — это утверждение о конфигурации, а не о прогоне.
        </Callout>
      ) : null}

      {/* КРОСС-ВАЛИДАЦИЯ ПЕРВОЙ. На всех трёх прототипах «что убьёт проект»
          стоит выше перечня агентов, и это правильно: читатель решает, а не
          изучает состав команды. */}
      {/* Тон — у КАРТОЧКИ, а не в каждой строке: критичны здесь все, и знак «⚠»
          двадцать раз подряд ничего не различал. Приём Домовея — `.kpi.--red`
          с полосой 3 px по левому краю блока. */}
      <Card className={board.critical.length === 0 ? undefined : "card--danger"}>
        <CardHead
          aside={board.critical.length === 0 ? "критичных замечаний нет" : "критичное от всех агентов, с автором"}
          note="Замечания важности «критично» от всех агентов прогона, с автором и тактом."
          title="Что убьёт проект"
        />
        <CardBody flush>
          {/* У списка своя высота и своя прокрутка: замечаний бывает двадцать, и
              без ограничения перечень агентов уезжал на второй экран — до
              состава команды никто не доскролливал. Число берётся от экрана
              (`--dash-list-h`), а не выдумано.

              Комментарий стоит ЗДЕСЬ, а не внутри ветки ниже: комментарий
              первым элементом ветки тернарника — недопустимый JSX, и я делал
              эту ошибку уже трижды. */}
          {board.critical.length === 0 ? (
            <StateEmpty title="Критичных замечаний нет">
              Ни один из высказавшихся агентов не поставил критичное замечание. Это утверждение о прогоне: агентов
              высказалось {board.spoke} из {board.total}.
            </StateEmpty>
          ) : (
            <ScrollBox label="Что убьёт проект">
              <ul className="m-0 list-none p-0">
              {board.critical.map((item, index) => (
                <li className="crit" key={`${item.capability}-${index}`}>
                  <span className="crit__body">
                    <span className="crit__statement">{item.finding.statement}</span>
                    {/* ОСНОВАНИЕ ОБЯЗАТЕЛЬНО, и оно проза агента, а не расчёт:
                        так и подписано. */}
                    <span className="crit__basis">
                      {item.finding.basis === "" ? "основание не приведено агентом" : item.finding.basis}
                    </span>
                    {/* ОТКУДА ВЗЯТО (Д3) — здесь это нужнее всего: «что убьёт
                        проект» читают на встрече, и первый вопрос клиента к
                        такому выводу — «откуда». Переход к строке живёт на
                        экране агента; тут — координата и уровень доверия. */}
                    <span className="crit__source">
                      {item.finding.source === null ? (
                        <span className="meta">основание текстовое: координаты агент не назвал</span>
                      ) : (
                        <>
                          <span className="meta num">{item.finding.source.where}</span>
                          <span className="meta">{item.finding.source.status}</span>
                          {item.finding.document === "" ? null : (
                            <span className="meta mono">{item.finding.document}</span>
                          )}
                        </>
                      )}
                    </span>
                  </span>
                  <span className="crit__author">
                    <a href={экранАгента(board.objectCode, item.capability, checkId)}>
                      {item.person}
                    </a>
                    <span className="crit__tact">{item.tact ?? "вне тактов"}</span>
                  </span>
                </li>
              ))}
              </ul>
            </ScrollBox>
          )}
        </CardBody>
      </Card>

      {/* ТАКТОВЫЙ КОНВЕЙЕР. Порядок задан воркфлоу, а не порядком карточек. */}
      {board.tacts.map((tact) => (
        <Card key={tact.id}>
          <CardHead
            aside={`${tact.agents.filter((agent) => agent.state.kind === "высказался" || agent.state.kind === "отказ").length} из ${tact.agents.length} высказалось`}
            title={`${tact.id} · ${tact.name}`}
          />
          <CardBody>
            <div className="agents">
              {tact.agents.map((agent) => (
                <AgentTile agent={agent} code={board.objectCode} checkId={checkId} key={agent.capability} />
              ))}
            </div>
          </CardBody>
        </Card>
      ))}

      {board.offPipeline.length === 0 ? null : (
        <Card>
          <CardHead aside="прогон запущен операцией напрямую, вне тактов" title="Вне конвейера" />
          <CardBody>
            <div className="agents">
              {board.offPipeline.map((agent) => (
                <AgentTile agent={agent} code={board.objectCode} checkId={checkId} key={agent.capability} />
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHead title="Чему здесь верить" />
        <CardBody>
          <p className="m-0 text-[var(--t-body)] leading-relaxed">
            Замечание — то, что агент сказал в <strong>этом</strong> прогоне, с основанием, которое он привёл.
            Основание — <strong>проза агента, а не расчёт</strong>: следа формулы под ним нет, и спросить его не у
            чего. Числа на плитках — счётчики замечаний, тоже не расчёты.
          </p>
          <p className="meta m-0 mt-2 flex items-baseline gap-2">
            <CircleSlash aria-hidden="true" className="shrink-0 translate-y-0.5" size={12} />
            <span>
              Эффекта замечания в рублях здесь нет, и это не упущение вёрстки: в контракте агента нет типизированного
              влияния. Приделать провенанс к прозе значило бы изобразить расчёт, которого не было.
            </span>
          </p>
          <p className="meta m-0 mt-1.5 flex items-baseline gap-2">
            <Ban aria-hidden="true" className="shrink-0 translate-y-0.5" size={12} />
            <span>
              «Не запускался», «работает» и «замечаний не нашёл» — три разных утверждения, и плитка различает их
              словом. Первое — о прогоне, второе — о минуте, третье — об объекте.
            </span>
          </p>
          {board.preliminary ? (
            <p className="meta m-0 mt-1.5 flex items-baseline gap-2">
              <Loader aria-hidden="true" className="shrink-0 translate-y-0.5" size={12} />
              <span>
                Часть замечаний помечена <strong>предварительными</strong>: они взяты из хода прогона, а не из его
                артефакта. Прогон идёт, попытка агента может быть переиграна, и тогда его замечания заменятся. Из
                артефакта они уже не меняются.
              </span>
            </p>
          ) : null}
        </CardBody>
      </Card>
    </Page>,
  );
}
