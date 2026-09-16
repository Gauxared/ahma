import { Landmark } from "lucide-react";

import {
  CASH,
  CHAIN,
  DECISIONS,
  FINANCIAL_RESULT,
  FRESHNESS,
  FROZEN,
  KEY_RISK,
  MILESTONES,
  OBJECT,
  OWNER_FUNDING,
  PRODUCTION_CHAIN,
  RELIABILITY,
  SCHEDULE_SLIP,
  WORKING_CAPITAL,
  type FrozenRow,
  type MilestoneRow,
} from "@web/src/preview/volkovsky.js";
import {
  DecisionList,
  Footnote,
  FreshnessBar,
  LinkChain,
  ReadingChain,
  ReliabilityList,
} from "@web/src/ui/command/blocks.js";
import { Callout } from "@web/src/ui/kit/callout.js";
import { Card, CardBody, CardHead } from "@web/src/ui/kit/card.js";
import { Pill } from "@web/src/ui/kit/pill.js";
import { StateEmpty } from "@web/src/ui/kit/states.js";
import { DataTable, type Column } from "@web/src/ui/kit/table.js";
import { Amount, Metric, ProvenanceLegend } from "@web/src/ui/value/typed-value.js";

/**
 * Штабной экран собственника — ОБРАЗЕЦ ОБЛИКА.
 *
 * Тёмная тема включается атрибутом на корне страницы, а не классом на
 * документе: обзорные штабные экраны тёмные, рабочие поверхности (реестры,
 * разбор, сравнение КП) светлые, и оба вида живут в одном приложении.
 *
 * УПРАВЛЯЮЩИХ ЭЛЕМЕНТОВ ЗДЕСЬ НЕТ, И ЭТО РЕШЕНИЕ
 *
 * Экран просится «оживить» кнопками «Пакет заказчику» и «Открыть проверку» —
 * они есть на макетах, и без них доска выглядит картинкой. Но `Ф-ADR-009`
 * трека говорит прямо: пока поверхность только читает, управляющих элементов на
 * ней нет вовсе. Кнопка, выглядящая работающей и ничего не делающая, хуже её
 * отсутствия, а на образце облика она вводила бы в заблуждение вдвойне.
 * Ощущение инструмента даётся тем, что действительно работает: раскрытием
 * происхождения у каждого числа и подсветкой строк.
 *
 * Данные — фикстура, о чём страница говорит первой строкой.
 */
export const metadata = {
  title: "Штаб собственника — образец облика",
};

/**
 * Четыре колонки, а не шесть.
 *
 * В макете их было шесть — причина, физика, сумма, дата, владелец,
 * разблокировка — и на половине ширины экрана они не помещались: таблица
 * уезжала в горизонтальную прокрутку, то есть половина колонок оказывалась за
 * кадром у того читателя, для которого экран сделан.
 *
 * Свёрнуто по смыслу, а не обрезано: причина и физика — одно наблюдение,
 * владелец и разблокировка — один ответ. Получился образец «наблюдение →
 * владелец → следующий шаг», который на трёх макетах и так был главным.
 */
const FROZEN_COLUMNS: readonly Column<FrozenRow>[] = [
  {
    key: "observation",
    title: "Что заморожено",
    width: "34%",
    render: (row) => (
      <>
        <span className="cell-title">{row.cause}</span>
        <span className="cell-sub">{row.physical}</span>
      </>
    ),
  },
  { key: "amount", title: "Сумма", numeric: true, width: "18%", render: (row) => <Amount shown={row.amount} /> },
  {
    key: "since",
    title: "С даты",
    numeric: true,
    width: "12%",
    render: (row) => <span className="num text-[var(--text-2)]">{row.since}</span>,
  },
  {
    key: "owner",
    title: "Кто закрывает и чем",
    width: "36%",
    render: (row) => (
      <>
        <span className="cell-title">{row.owner}</span>
        <span className="cell-sub">{row.unblockedBy}</span>
      </>
    ),
  },
];

const MILESTONE_COLUMNS: readonly Column<MilestoneRow>[] = [
  { key: "milestone", title: "Веха", render: (row) => <span className="cell-title">{row.milestone}</span> },
  {
    key: "plan",
    title: "План",
    numeric: true,
    render: (row) => <span className="num text-[var(--text-2)]">{row.plan}</span>,
  },
  {
    key: "forecast",
    title: "Прогноз",
    numeric: true,
    render: (row) => <span className="num text-[var(--text-2)]">{row.forecast}</span>,
  },
  {
    key: "slip",
    // Громко — только отклонение: «контроль» и «уточнить» это положение дел, а
    // не исключение, и заливкой они лишь перекрикивали бы просроченные вехи.
    title: "Отклонение",
    numeric: true,
    render: (row) =>
      row.verdict === "slip" && row.slip !== undefined ? (
        <Pill label={`+${row.slip} сут`} loud title="Прогноз позже плана" tone="danger" />
      ) : row.verdict === "watch" ? (
        <Pill dot label="уточнить" title="План выражен словом «раньше»: точной даты в договоре нет" tone="warn" />
      ) : (
        <Pill dot label="контроль" title="Отклонения нет, веха под наблюдением" tone="ok" />
      ),
  },
  { key: "action", title: "Что делать", render: (row) => <span className="text-[var(--text-2)]">{row.action}</span> },
];

export default function OwnerViewPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]" data-theme="dark">
      {/* Пометка тонкой строкой, а не жёлтой плашкой во всю ширину: она обязана
          быть замечена, но не обязана быть первым, что видит глаз. Прежняя
          заливка перетягивала внимание с главного показателя. */}
      <p className="m-0 flex flex-wrap items-center justify-center gap-2 border-b border-[var(--line)] bg-[var(--surface-sunken)] px-4 py-1.5 text-center text-[var(--t-micro)] text-[var(--text-3)]">
        <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
        <span>
          <strong className="font-bold text-[var(--brand)]">Образец облика.</strong> Данные — фикстура с макетов, не из
          базы: объект нового клиента ещё не заведён.
        </span>
      </p>

      <header className="flex flex-wrap items-center gap-x-8 gap-y-4 border-b border-[var(--line)] bg-[var(--surface)] px-7 py-4">
        <div className="flex items-center gap-3.5">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 items-center justify-center rounded-[var(--r-sm)] border border-[var(--brand-line)] bg-[var(--brand-soft)] text-[var(--brand)]"
          >
            <Landmark size={19} strokeWidth={1.9} />
          </span>
          <div>
            <h1 className="text-[21px] font-bold tracking-[-0.025em]">{OBJECT.name}</h1>
            <p className="meta m-0">{`${OBJECT.subtitle} · шифр ${OBJECT.code} · договор ${OBJECT.contract}`}</p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-2.5">
          <FreshnessBar items={FRESHNESS} />
          {/* Отпечаток входов вместо надписи «v5.2 FIX» из макета: версия сборки
              ничего не говорит о том, на чём посчитан экран, а отпечаток говорит. */}
          <span className="flex items-center gap-2.5 rounded-[var(--r-sm)] border border-[var(--brand-line)] bg-[var(--brand-soft)] px-3 py-1.5">
            <span className="eyebrow text-[var(--brand)]">Собственник</span>
            <span className="mono text-[var(--t-micro)] text-[var(--text-3)]">{OBJECT.snapshotDigest}</span>
          </span>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1640px] flex-col gap-5 px-7 py-6">
        <section className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div>
            <p className="eyebrow text-[var(--brand)]">Первый экран собственника</p>
            <div className="mt-2.5">
              <ReadingChain steps={[...CHAIN]} />
            </div>
            <p className="meta mt-2.5 mb-0 max-w-[62ch]">
              Только управленческие отклонения — то, что меняет кассу, срок или требует решения собственника.
            </p>
          </div>
          <Callout title="Ключевой риск" tone="warn">
            {KEY_RISK}
          </Callout>
        </section>

        {/* Шесть показателей, но НЕ шесть первых мест.
            Главный — касса: цепочка чтения начинается с денег. Он и шире
            остальных (1.45fr против 1fr), и на ступень крупнее кеглем. В макете
            все шесть стояли одним весом на всю ширину монитора: глазу было негде
            начать, а подписи ломались в три строки. */}
        <section className="grid grid-cols-1 items-stretch gap-3.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-[minmax(290px,1.45fr)_repeat(5,minmax(178px,1fr))]">
          <Metric
            badge={{ tone: "ok", text: "Контроль" }}
            emphasis
            label="Касса"
            note="Свободный остаток. Производство подпирается довнесением собственника."
            shown={CASH}
          />
          <Metric
            badge={{ tone: "warn", text: "Сверка" }}
            label="Вложения собственника"
            note="Оценка штаба даёт 1,47 млн ₽. До сверки это расхождение, а не чистый факт."
            shown={OWNER_FUNDING}
          />
          <Metric badge={{ tone: "danger", text: "Критично" }} label="Оборотка до платежа" shown={WORKING_CAPITAL} />

          <div className="card h-full">
            <div className="flex items-start gap-2 px-4 pt-3.5">
              <span className="eyebrow min-w-0 flex-1 pt-px">Деньги в производстве</span>
              <Pill className="shrink-0" label="Разрыв" loud tone="danger" />
            </div>
            <div className="px-4 pb-4 pt-3">
              <LinkChain links={PRODUCTION_CHAIN} />
              <p className="meta mt-2.5 mb-0">
                Физика КЖ выполнена, но подтверждённого КС-2 с рублями нет: цепочка рвётся на предъявлении.
              </p>
            </div>
          </div>

          <Metric badge={{ tone: "plain", text: "Н/Д" }} label="Финрезультат" shown={FINANCIAL_RESULT} />
          <Metric
            badge={{ tone: "danger", text: "Критично" }}
            label="Срок"
            note="Договор 26.08.2026, прогноз сдачи с биологией 27.01.2027."
            shown={SCHEDULE_SLIP}
          />
        </section>

        <section className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card>
            <CardHead aside="управленческий разрез, не бухгалтерский" title="А · Где заморожены деньги" />
            <CardBody flush>
              <DataTable
                caption="Где заморожены деньги: наблюдение, сумма, дата и ответственный"
                columns={FROZEN_COLUMNS}
                empty={
                  <StateEmpty title="Замороженного объёма нет">
                    Все выполненные объёмы закрыты документами.
                  </StateEmpty>
                }
                rowKey={(row) => row.id}
                rows={FROZEN}
              />
              <ProvenanceLegend className="px-4 pt-3" />
              <Footnote>
                Пока не подписаны ВОР и КС-2 и не оформлены письма по допработам, весь физический объём остаётся без
                денег. Суммы без расценки показаны причиной отсутствия, а не нулём: ноль здесь читался бы как «денег не
                заморожено».
              </Footnote>
            </CardBody>
          </Card>

          <div className="flex flex-col gap-5">
            <Card>
              <CardHead aside="план против прогноза" title="Б · Сроки и критические вехи" />
              <CardBody flush>
                <DataTable
                  caption="Критические вехи: план, прогноз, отклонение и действие"
                  columns={MILESTONE_COLUMNS}
                  empty={<StateEmpty title="Вехи не заданы">Договорный график не загружен.</StateEmpty>}
                  rowKey={(row) => row.id}
                  rows={MILESTONES}
                />
                <Footnote>
                  «Раньше» в колонке плана означает, что договор точной даты не содержит: передача земли или геодезия
                  должна быть подтверждена актом. Это не пропуск в данных, а свойство договора.
                </Footnote>
              </CardBody>
            </Card>

            <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
              <Card>
                <CardHead aside="с ценой невыполнения" title="В · Решения на сегодня" />
                <CardBody flush>
                  <DecisionList decisions={DECISIONS} />
                </CardBody>
              </Card>

              <Card>
                <CardHead aside="на чём стоит экран" title="Г · Надёжность данных" />
                <CardBody flush>
                  <ReliabilityList items={RELIABILITY} />
                  <Footnote>
                    Квадрант отвечает на вопрос «чему здесь можно верить». Две последние строки — не пробел в отчёте, а
                    объявленное отсутствие расчёта.
                  </Footnote>
                </CardBody>
              </Card>
            </div>
          </div>
        </section>
      </main>

      <footer className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1.5 border-t border-[var(--line)] bg-[var(--surface)] px-7 py-4">
        <span className="text-[var(--t-meta)] font-semibold text-[var(--brand)]">
          Строим точно · Управляем цифрово
        </span>
        <span className="meta">{OBJECT.customer}</span>
        <span className="meta ml-auto">
          {`Отпечаток входов ${OBJECT.snapshotDigest} · экран собран из канонических артефактов прогона`}
        </span>
      </footer>
    </div>
  );
}
