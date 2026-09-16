/**
 * Журнал — экран §5.5 (6), поверхность `S-06`.
 *
 * ЭТОТ ЭКРАН СУЩЕСТВУЕТ РАДИ ПРОВЕРКИ ПРАВА
 *
 * Он единственный в §5.5 с ограничением по роли. Пока такого экрана нет,
 * разграничение прав нечем проверить: код есть, применения нет — ровно то
 * состояние, в котором область знания однажды оказалась декоративной.
 *
 * ОТКАЗ НЕ ПРИТВОРЯЕТСЯ ПУСТОТОЙ
 *
 * Пользователю без права показывается ОТКАЗ, а не пустой журнал. Пустой журнал
 * читается как «событий не было» — утверждение о системе, тогда как на деле это
 * утверждение о правах смотрящего.
 */
import { RefreshCw } from "lucide-react";

import { createPrismaClient, withTenant } from "@platform/db/prisma";

import { currentViewer } from "@web/lib/actor";
import { shellOf } from "@web/src/app-shell/shell.js";
import { ButtonLink } from "@web/src/ui/kit/button.js";
import { Card, CardBody, CardHead } from "@web/src/ui/kit/card.js";
import { Page, PageHead } from "@web/src/ui/kit/page.js";
import { FilterBar, FilterGroup, type FilterOption } from "@web/src/ui/kit/filters.js";
import { StateDenied, StateEmpty } from "@web/src/ui/kit/states.js";
import { DataTable, type Column } from "@web/src/ui/kit/table.js";
import { plural, СЛОВО } from "@web/src/ui/value/format.js";

export const dynamic = "force-dynamic";

interface Event {
  readonly id: string;
  readonly action: string;
  readonly resourceKind: string;
  readonly resourceId: string | null;
  readonly at: Date;
}

/**
 * Отбор журнала.
 *
 * ПОЧЕМУ ОН ЗДЕСЬ ОБЯЗАТЕЛЕН, А НЕ ЖЕЛАТЕЛЕН
 *
 * Замерено на живом контуре: из 1198 событий арендатора 932 — `session.started`.
 * То есть журнал без отбора на 78 % состоит из входов, и «последние 200 записей»
 * — это почти всегда двести логинов. Экран, заведённый ради проверки права,
 * показывал единственное, чего никто не ищет.
 */
interface Journal {
  /** Показанные события: последние `CAP` из отобранных. */
  readonly events: readonly Event[];
  /** Сколько отобранных всего — может быть больше показанных. */
  readonly matched: number;
  readonly total: number;
  readonly actions: readonly FilterOption[];
  readonly kinds: readonly FilterOption[];
}

/**
 * Потолок выборки.
 *
 * Он был и раньше (`take: 200`), но молча: подпись обещала «последние 200
 * записей», а сколько их всего — не говорила. Теперь потолок и общее число
 * стоят рядом, потому что «200 из 932» и «200 из 200» — разные утверждения.
 */
const CAP = 200;

async function readJournal(
  tenantId: string,
  filter: { readonly action: string | undefined; readonly kind: string | undefined },
): Promise<Journal> {
  const db = createPrismaClient(process.env["DATABASE_URL"]);

  // Условие собирается без ключей с `undefined`: при `exactOptionalPropertyTypes`
  // «нет отбора» и «отбор по неизвестному значению» — разные вещи, и первое не
  // имеет права превратиться во второе.
  const where = {
    ...(filter.action === undefined ? {} : { action: filter.action }),
    ...(filter.kind === undefined ? {} : { resourceKind: filter.kind }),
  };

  try {
    return await withTenant(db, tenantId, async (tx) => {
      const [events, matched, total, byAction, byKind] = await Promise.all([
        tx.auditEvent.findMany({ where, orderBy: { at: "desc" }, take: CAP }),
        tx.auditEvent.count({ where }),
        tx.auditEvent.count(),
        // Числа на пилюлях считаются по ВСЕМУ журналу, а не по показанной
        // странице: пилюля обещает, сколько есть, — иначе отбор предлагается
        // вслепую и приводит в пустоту.
        tx.auditEvent.groupBy({ by: ["action"], _count: { _all: true } }),
        tx.auditEvent.groupBy({ by: ["resourceKind"], _count: { _all: true } }),
      ]);

      return {
        events,
        matched,
        total,
        actions: options(byAction.map((row) => ({ value: row.action, count: row._count._all }))),
        kinds: options(byKind.map((row) => ({ value: row.resourceKind, count: row._count._all }))),
      };
    });
  } finally {
    await db.$disconnect();
  }
}

/** Значения отбора: сначала частые, при равенстве — по алфавиту. */
function options(rows: readonly { readonly value: string; readonly count: number }[]): readonly FilterOption[] {
  return [...rows]
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value, "ru"))
    .map((row) => ({ value: row.value, label: row.value, count: row.count }));
}

const COLUMNS: readonly Column<Event>[] = [
  {
    key: "at",
    title: "Время",
    numeric: true,
    width: "20%",
    render: (row) => <span className="num text-[var(--text-2)]">{row.at.toLocaleString("ru-RU")}</span>,
  },
  { key: "action", title: "Действие", width: "30%", render: (row) => <span className="cell-title">{row.action}</span> },
  {
    key: "resource",
    title: "Предмет",
    render: (row) => (
      <>
        <span className="text-[var(--text-2)]">{row.resourceKind}</span>
        {row.resourceId === null ? null : <span className="cell-sub mono">{row.resourceId}</span>}
      </>
    ),
  },
];

/**
 * Страница журнала берётся из адреса.
 *
 * Не из состояния в браузере: экран серверный, и вторая страница обязана
 * открываться по ссылке — иначе её нельзя ни прислать коллеге, ни вернуться на
 * неё кнопкой «назад». Нечисловое значение — не ошибка ввода, а испорченная
 * ссылка: показывается первая страница, а не отказ.
 */
const PAGE_SIZE = 50;

function pageFrom(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Пустая строка в адресе — это «отбора нет», а не «отбери по пустому».
 *
 * Ссылка «все» ставит параметр пустым, чтобы адрес оставался предсказуемым;
 * если бы пустое значение доходило до запроса, «все» отбирало бы события с
 * пустым действием, которых нет, и кнопка сброса приводила бы в пустоту.
 */
function valueFrom(raw: string | undefined): string | undefined {
  const trimmed = (raw ?? "").trim();
  return trimmed === "" ? undefined : trimmed;
}

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ страница?: string; действие?: string; предмет?: string }>;
}) {
  const result = await currentViewer();

  if (result.kind === "гость") {
    return (
      <Page wide>
        <PageHead title="Журнал" />
        <Card>
          <CardBody>
            <StateDenied permission="audit:read" reason={`${result.reason}.`}>
              <a href="/login">Войти</a>
            </StateDenied>
          </CardBody>
        </Card>
      </Page>
    );
  }

  const shell = shellOf("S-06", result.viewer);
  const decision = result.viewer.can("audit:read");

  if (!decision.allowed) {
    return shell(
      <Page wide>
        <PageHead title="Журнал" />
        <Card>
          <CardBody>
            <StateDenied permission="audit:read" reason={`${decision.reason}.`}>
              По ТЗ §4 журнал доступен администратору. Вы вошли как {result.viewer.displayName}
              {result.viewer.roleIds.length > 0 ? ` (роли: ${result.viewer.roleIds.join(", ")})` : " (ролей нет)"}.
            </StateDenied>
          </CardBody>
        </Card>
      </Page>,
    );
  }

  const { страница, действие, предмет } = await searchParams;
  const action = valueFrom(действие);
  const kind = valueFrom(предмет);
  const journal = await readJournal(result.viewer.actor.tenantId, { action, kind });

  /**
   * Адрес пересобирается целиком, а не правится по месту: отбор и страница
   * связаны — сменив отбор, оставаться на седьмой странице бессмысленно,
   * потому что она относилась к другому списку.
   */
  const href = (next: { readonly action?: string | undefined; readonly kind?: string | undefined; readonly page?: number }): string => {
    const query = new URLSearchParams();
    const nextAction = "action" in next ? next.action : action;
    const nextKind = "kind" in next ? next.kind : kind;
    if (nextAction !== undefined) query.set("действие", nextAction);
    if (nextKind !== undefined) query.set("предмет", nextKind);
    if (next.page !== undefined && next.page > 1) query.set("страница", String(next.page));
    const tail = query.toString();
    return tail === "" ? "/journal" : `/journal?${tail}`;
  };

  const filtered = action !== undefined || kind !== undefined;
  const capped = journal.matched > CAP;

  return shell(
    <Page wide>
      <PageHead note={`Доступ разрешён: ${decision.via}`} title="Журнал" />

      {/* ОТБОР — СТРОКА, А НЕ КАРТОЧКА.
          Под отбор была отведена целая карточка с заголовком «Отбор»: рамка,
          поля 16 px, заголовок 13 px — сто с лишним пикселей высоты на то, что
          у Домовея занимает одну строку в 32 px (`.dir-toolbar`). Карточка
          говорит «это блок данных», а отбор — не данные, а орган управления
          над ними.

          Справа — действие, как у Домовея («Обновить» + первичное действие).
          Журнал живёт: события приходят, пока экран открыт. */}
      <div className="toolbar">
        <FilterBar {...(filtered ? { reset: href({ action: undefined, kind: undefined, page: 1 }) } : {})}>
            <FilterGroup
              active={action}
              allCount={journal.total}
              allLabel="все действия"
              hrefFor={(value) => href({ action: value, page: 1 })}
              label="Действие"
              options={journal.actions}
            />
            <FilterGroup
              active={kind}
              allCount={journal.total}
              allLabel="все предметы"
              hrefFor={(value) => href({ kind: value, page: 1 })}
              label="Предмет"
              options={journal.kinds}
            />
        </FilterBar>
        <span className="toolbar__actions">
          <ButtonLink href={href({ page: pageFrom(страница) })} size="sm" variant="outline">
            <RefreshCw aria-hidden="true" size={12} />
            Обновить
          </ButtonLink>
        </span>
      </div>

      <Card>
        <CardHead
          aside={
            capped
              ? `показаны последние ${CAP} из ${journal.matched} · глубина хранения не менее 12 месяцев (§11)`
              : `${journal.matched} из ${plural(journal.total, СЛОВО.запись)} · глубина хранения не менее 12 месяцев (§11)`
          }
          title="События арендатора"
        />
        <CardBody flush>
          <DataTable
            caption="Журнал событий: время, действие и предмет"
            columns={COLUMNS}
            empty={
              filtered ? (
                <StateEmpty title="Под отбор ничего не подошло">
                  Событий с таким отбором в журнале нет. Это утверждение об отборе, а не о системе: всего записей —{" "}
                  {journal.total}. <a href={href({ action: undefined, kind: undefined, page: 1 })}>Снять отбор</a>.
                </StateEmpty>
              ) : (
                <StateEmpty title="Записей нет">
                  Журнал пуст: событий по этому арендатору ещё не происходило. Это утверждение о системе — право на
                  просмотр у вас есть.
                </StateEmpty>
              )
            }
            paging={{
              page: pageFrom(страница),
              pageSize: PAGE_SIZE,
              hrefFor: (page) => href({ page }),
            }}
            rowKey={(row) => row.id}
            rows={journal.events}
          />
        </CardBody>
      </Card>
    </Page>,
  );
}
