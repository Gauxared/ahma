/**
 * Сравнение коммерческих предложений по объекту — поверхность `S-04`.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ЭКРАН
 *
 * Расчёт был, артефакт был, входа не было: сравнение показывалось только внутри
 * той Проверки, в которой считалось, а пункт рельса «Сравнение КП» вёл на реестр
 * объектов. Из пяти пунктов, указывавших на один и тот же экран, этот был самым
 * обидным — экран существовал целиком и был недостижим.
 *
 * ПРЕДМЕТ — ОБЪЕКТ, А НЕ ПРОГОН
 *
 * Предложения сравнивают по стройке. Прогон, в котором сравнение считалось,
 * остаётся здесь происхождением: ссылка на него стоит рядом с датой, потому что
 * «откуда это число» — обязательный вопрос, а не любопытство.
 */
import { currentViewer } from "@web/lib/actor";
import { readOffers } from "@web/lib/offers-read-model";
import { shellOf } from "@web/src/app-shell/shell.js";
import { Callout } from "@web/src/ui/kit/callout.js";
import { Card, CardBody, CardHead } from "@web/src/ui/kit/card.js";
import { ObjectHead } from "@web/src/ui/command/object-head.js";
import { Page, PageHead } from "@web/src/ui/kit/page.js";
import { Pill } from "@web/src/ui/kit/pill.js";
import { StateDenied, StateEmpty } from "@web/src/ui/kit/states.js";
import { Comparison } from "@web/src/ui/command/comparison.js";

export const dynamic = "force-dynamic";

export default async function OffersPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const result = await currentViewer();

  if (result.kind === "гость") {
    return (
      <Page>
        <PageHead title="Сравнение предложений" />
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

  const shell = shellOf("S-04", result.viewer, [
    { label: code, href: `/objects/${encodeURIComponent(code)}` },
    { label: "Сравнение КП" },
  ], decodeURIComponent(code));

  const decision = result.viewer.can("check:read");

  if (!decision.allowed) {
    return shell(
      <Page>
        <PageHead title="Сравнение предложений" />
        <Card>
          <CardBody>
            <StateDenied permission="check:read" reason={decision.reason} />
          </CardBody>
        </Card>
      </Page>,
    );
  }

  const card = await readOffers(result.viewer.actor.tenantId, code);

  if (card === undefined) {
    return shell(
      <Page>
        <PageHead title="Сравнение предложений" />
        <Card>
          <CardBody>
            <StateEmpty title="Объект не найден">
              Объекта с шифром {code} у этого арендатора нет.
            </StateEmpty>
          </CardBody>
        </Card>
      </Page>,
    );
  }

  const [latest, ...earlier] = card.runs;

  return shell(
    <Page wide>
      <ObjectHead
        active="предложения"
        aside={
          latest === undefined ? null : (
            <>
              <Pill dot label={`полнота ${latest.completeness}`} tone="info" />
              <span className="meta num">{latest.producedAt.toLocaleString("ru-RU")}</span>
            </>
          )
        }
        code={card.objectCode}
        counts={{ предложения: card.runs.length }}
        name={card.objectName}
        note={`Шифр ${card.objectCode} · сравнение коммерческих предложений`}
      />

      {/* Образец назван образцом ДО таблицы, а не сноской под ней. Расчёт здесь
          настоящий, а предложения выдуманы, и читатель обязан знать это прежде,
          чем прочтёт первую цифру. */}
      {latest?.sample === true ? (
        <Callout title="Это образец, а не настоящие предложения" tone="warn">
          Предложения взяты из набора фикстур и относятся к другому объекту: расчёт разброса настоящий, входы —
          придуманные. Показывать как результат по этому объекту нельзя.
        </Callout>
      ) : null}

      {latest === undefined ? (
        <Card>
          <CardBody>
            <StateEmpty title="Сравнений по объекту не было">
              Расчёт сравнения по этому объекту не выполнялся. Это утверждение о системе: право на просмотр у вас есть,
              а артефакта операции «compare-offers» по объекту нет ни одного.
            </StateEmpty>
          </CardBody>
        </Card>
      ) : latest.comparison === null ? (
        <Card>
          <CardBody>
            <StateEmpty title="Расчёт есть, прочитать его нечем">
              Артефакт {latest.artifactId} по виду не сравнение предложений: формат тела не разобран. Молча пропустить
              его значило бы показать «сравнений не было» там, где расчёт выполнялся.
            </StateEmpty>
          </CardBody>
        </Card>
      ) : (
        <>
          {/* Происхождение стоит ВЫШЕ таблицы, а не под ней: «откуда это
              число» — первый вопрос к сравнению, а не сноска. */}
          <Card>
            <CardHead aside="происхождение расчёта" title="Откуда взято" />
            <CardBody>
              <dl className="m-0 flex flex-wrap gap-x-8 gap-y-2">
                <div className="flex items-baseline gap-2">
                  <dt className="meta">артефакт</dt>
                  <dd className="m-0 mono text-[var(--t-meta)]">{latest.artifactId}</dd>
                </div>
                <div className="flex items-baseline gap-2">
                  <dt className="meta">прогон</dt>
                  <dd className="m-0 text-[var(--t-meta)]">
                    {latest.checkId === null ? (
                      "вне прогона: расчёт выполнен операцией напрямую"
                    ) : (
                      <a href={`/objects/${encodeURIComponent(card.objectCode)}/checks/${latest.checkId}`}>
                        рабочий экран Проверки
                      </a>
                    )}
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Comparison view={latest.comparison} />
        </>
      )}

      {earlier.length === 0 ? null : (
        <Card>
          <CardHead
            aside="предложения пересчитывают: прежний расчёт не перестаёт существовать"
            title="Прежние расчёты"
          />
          <CardBody flush>
            <ul className="m-0 list-none p-0">
              {earlier.map((run) => (
                <li
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-[var(--line-2)] px-4 py-3 last:border-b-0"
                  key={run.artifactId}
                >
                  <span className="num text-[var(--t-meta)] font-semibold">
                    {run.producedAt.toLocaleString("ru-RU")}
                  </span>
                  <span className="meta">полнота {run.completeness}</span>
                  <span className="mono text-[var(--t-micro)] text-[var(--text-4)]">{run.artifactId}</span>
                  {run.checkId === null ? null : (
                    <a
                      className="ml-auto text-[var(--t-meta)]"
                      href={`/objects/${encodeURIComponent(card.objectCode)}/checks/${run.checkId}`}
                    >
                      прогон →
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </Page>,
  );
}
