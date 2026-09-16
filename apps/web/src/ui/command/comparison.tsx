import { TriangleAlert } from "lucide-react";

import type { ComparisonPositionView, ComparisonView } from "@web/lib/check-read-model.js";

import { Callout } from "../kit/callout.js";
import { Card, CardBody, CardHead } from "../kit/card.js";
import { Pill } from "../kit/pill.js";
import { StateEmpty } from "../kit/states.js";
import { DataTable, type Column } from "../kit/table.js";

/**
 * Сравнение коммерческих предложений — экран §5.5 (4), поверхность `S-04`.
 *
 * ГЛАВНОЕ ЗДЕСЬ — ЧЕГО В РАСЧЁТЕ НЕТ
 *
 * §5.2 требует, чтобы несопоставимые позиции выделялись отдельно и в расчёт
 * разброса не входили. Экран обязан сделать это невозможным СЛУЧАЙНО: у каждой
 * позиции показано и число сравнимых предложений, и поимённо те, кто в расчёт
 * не вошёл, с причиной. Подрядчик, у которого позиции нет, — не подрядчик с
 * ценой ноль.
 *
 * ОТСУТСТВИЕ ОЦЕНКИ — СОСТОЯНИЕ, А НЕ ПУСТАЯ ЯЧЕЙКА
 *
 * «Оценка Системы не построена: нет наблюдений по позиции» — полноправный
 * результат. Пустая ячейка на её месте читалась бы как ноль или как недосмотр,
 * а выдуманная оценка ушла бы в переговоры фактом (§9).
 */

function money(value: string | null): string {
  if (value === null) return "—";
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value;
}

/**
 * Одна каноническая позиция.
 *
 * `.num` вешается на числа, а не на абзац: класс несёт `white-space: nowrap`, и
 * на абзаце строка отказывалась переноситься и наезжала на соседнюю колонку.
 * Поймано на экране, а не в коде.
 */
function Position({ position }: { readonly position: ComparisonPositionView }) {
  return (
    <Card>
      <CardHead
        aside={position.quantity === null ? undefined : `объём ${position.quantity}`}
        title={position.canonicalId}
      >
        {position.comparable === null ? null : (
          <Pill className="ml-3" dot label={`сравнимых ${position.comparable}`} tone="info" />
        )}
      </CardHead>

      <CardBody flush>
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 px-4 py-3.5 lg:grid-cols-2">
          <div>
            <p className="eyebrow m-0">Разброс по итогам</p>
            {position.spreadReason !== null ? (
              <p className="meta mt-1.5 mb-0 max-w-[52ch]">{position.spreadReason}</p>
            ) : (
              <p className="m-0 mt-1.5 text-[var(--t-body)]">
                <span className="num font-semibold">{money(position.min)}</span>
                {" · медиана "}
                <span className="num text-[17px] font-bold">{money(position.median)}</span>
                {" · "}
                <span className="num font-semibold">{money(position.max)}</span>
                <span className="meta"> ₽</span>
                {position.ratio === null ? null : (
                  <span className="meta">{` · разброс ×${position.ratio}`}</span>
                )}
              </p>
            )}
          </div>

          <div>
            <p className="eyebrow m-0">Цена за единицу</p>
            {/* Причина берётся у расчёта, а не сочиняется по отсутствию числа.
                Первая версия писала «объём позиции не определён» всегда, когда
                медианы нет, — и врала на позиции с объёмом 1400, где дело было
                в единственном предложении. */}
            {position.unitMedian === null ? (
              <p className="meta mt-1.5 mb-0 max-w-[52ch]">
                {position.unitSpreadReason ?? "не считалась"}
              </p>
            ) : (
              <p className="m-0 mt-1.5 text-[var(--t-body)]">
                <span className="num">{money(position.unitMin)}</span>
                {" · "}
                <span className="num text-[17px] font-bold">{money(position.unitMedian)}</span>
                {" · "}
                <span className="num">{money(position.unitMax)}</span>
                <span className="meta"> ₽/ед.</span>
              </p>
            )}
          </div>
        </div>

        {/* Поимённо, а не числом: «в расчёт не вошли двое» не позволяет
            проверить, кто именно и почему. */}
        {position.excluded.length === 0 ? null : (
          <p className="meta m-0 border-t border-[var(--line-2)] px-4 py-2.5">
            <span className="font-semibold text-[var(--warn)]">В расчёт разброса не вошли: </span>
            {position.excluded.map((item) => `${item.source} (${item.reason})`).join(" · ")}
          </p>
        )}

        {position.anomalies.length === 0 ? null : (
          <ul className="m-0 list-none border-t border-[var(--line-2)] p-0">
            {position.anomalies.map((anomaly) => (
              <li className="flex items-baseline gap-2.5 bg-[var(--danger-soft)] px-4 py-2.5" key={anomaly.source}>
                <TriangleAlert aria-hidden="true" className="shrink-0 translate-y-0.5 text-[var(--danger)]" size={13} />
                <span className="text-[var(--t-meta)]">
                  <span className="font-semibold">{`аномалия · ${anomaly.source}`}</span>
                  {`: ${money(anomaly.amount)} ₽, влияние `}
                  <span className="font-semibold text-[var(--danger)]">{`${money(anomaly.impact)} ₽`}</span>
                  {` (×${anomaly.ratio} к медиане)`}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-[var(--line-2)] px-4 py-3">
          <p className="eyebrow m-0">Оценка Системы</p>
          {position.estimateReason !== null ? (
            <p className="meta mt-1.5 mb-0 max-w-[70ch]">
              <span className="font-semibold text-[var(--text-2)]">не построена. </span>
              {position.estimateReason}
            </p>
          ) : (
            <>
              <p className="m-0 mt-1.5 text-[var(--t-body)]">
                <span className="num text-[17px] font-bold">{money(position.estimateUnitPrice)}</span>
                <span className="meta">{` ₽/ед. · диапазон ${money(position.estimateLow)}–${money(position.estimateHigh)} ₽/ед.`}</span>
                {position.estimateTotal === null ? null : (
                  <span className="meta">{` · на объём ${money(position.estimateTotal)} ₽`}</span>
                )}
              </p>
              {position.estimateSources.length === 0 ? null : (
                <p className="meta m-0 mt-1">{`источники: ${position.estimateSources.join(", ")}`}</p>
              )}
              {position.deviationCategory === null ? null : (
                <p className="meta m-0 mt-2">
                  <span className="font-semibold text-[var(--text-2)]">{`отклонение: ${position.deviationCategory}. `}</span>
                  {position.deviationBasis}
                  {position.deviationRemedy === null ? null : (
                    <span className="block mt-0.5">{`что делать: ${position.deviationRemedy}`}</span>
                  )}
                </p>
              )}
            </>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

export function Comparison({ view }: { readonly view: ComparisonView }) {
  const contractorColumns: readonly Column<ComparisonView["contractors"][number]>[] = [
    { key: "name", title: "Подрядчик", render: (row) => <span className="cell-title">{row.contractor}</span> },
    { key: "note", title: "Состав", render: (row) => <span className="text-[var(--text-2)]">{row.note}</span> },
    {
      key: "total",
      title: "Итог",
      numeric: true,
      width: "20%",
      render: (row) => <span className="num font-semibold">{`${money(row.total)} ₽`}</span>,
    },
    {
      key: "matched",
      title: "Из них сопоставлено",
      numeric: true,
      width: "22%",
      render: (row) => <span className="num text-[var(--text-2)]">{`${money(row.matchedAmount)} ₽`}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHead aside={`${view.offersTotal} предложения`} title={`Предложения · ${view.objectName}`} />
        <CardBody flush>
          <DataTable
            caption="Предложения подрядчиков: итог и сопоставленная часть"
            columns={contractorColumns}
            empty={<StateEmpty title="Предложений нет">Набор пуст.</StateEmpty>}
            rowKey={(row) => row.contractor}
            rows={view.contractors}
          />
        </CardBody>
      </Card>

      {/* Расчёт остановлен — это не «пока не посчитано», а отказ считать по
          неподтверждённому. Разброс по догадкам выдал бы догадку за факт. */}
      {view.ready ? null : (
        <Callout title="Разброс не посчитан: ждёт подтверждения человеком" tone="warn">
          <p className="m-0">
            {`Неоднозначных сопоставлений: ${view.pending.length}. Пока они не подтверждены, разброс не считается —
            иначе догадка ушла бы в переговоры фактом (ADR-R-013).`}
          </p>
          <ul className="mt-2 mb-0 pl-5">
            {view.pending.map((record) => (
              <li key={record.offerLine}>
                <span className="font-semibold">{record.offerLine}</span>
                {` — ${record.explanation}`}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {view.unmatched.length === 0 ? null : (
        <Card>
          <CardHead aside="§5.2: в расчёт разброса не входят" title={`Не сопоставлены · ${view.unmatched.length}`} />
          <CardBody flush>
            <ul className="m-0 list-none p-0">
              {view.unmatched.map((record) => (
                <li className="border-b border-[var(--line-2)] px-4 py-2.5 last:border-b-0" key={record.offerLine}>
                  <span className="cell-title">{record.offerLine}</span>
                  <span className="cell-sub">{record.explanation}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {view.positions.map((position) => (
        <Position key={position.canonicalId} position={position} />
      ))}
    </div>
  );
}
