/**
 * Реестр объектов — экран §5.5 (1), поверхность `S-01`.
 *
 * ПУСТОЙ СПИСОК — ЭТО СООБЩЕНИЕ, А НЕ ПУСТАЯ СТРАНИЦА
 *
 * Пустая таблица читается как «объектов нет», и это может быть правдой, а
 * может — незаданным арендатором или неподнятой базой. Разница видна только
 * если её назвать, поэтому у каждого случая свой текст и своё состояние
 * поверхности.
 */
import { FolderPlus } from "lucide-react";

import { currentViewer } from "@web/lib/actor";
import { shellOf } from "@web/src/app-shell/shell.js";
import { listObjects } from "@web/lib/read-model";
import type { ObjectRow } from "@web/lib/read-model";
import { Button } from "@web/src/ui/kit/button.js";
import { Callout } from "@web/src/ui/kit/callout.js";
import { Card, CardBody, CardHead } from "@web/src/ui/kit/card.js";
import { Field, Input } from "@web/src/ui/kit/field.js";
import { Page, PageHead } from "@web/src/ui/kit/page.js";
import { Pill } from "@web/src/ui/kit/pill.js";
import { StateDenied, StateEmpty, StateFailed } from "@web/src/ui/kit/states.js";
import { DataTable, type Column } from "@web/src/ui/kit/table.js";
import { FilterBar, FilterGroup, type FilterOption } from "@web/src/ui/kit/filters.js";
import { checkStatusWord } from "@web/src/ui/command/check-status.js";

export const dynamic = "force-dynamic";

function formatDate(value: Date | null): string {
  return value === null ? "—" : value.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

const COLUMNS: readonly Column<ObjectRow>[] = [
  {
    key: "code",
    title: "Объект",
    render: (row) => (
      <>
        <a className="cell-title" href={`/objects/${encodeURIComponent(row.code)}`}>
          {row.name}
        </a>
        <span className="cell-sub">{`${row.code} · ${row.region ?? "регион не указан"}`}</span>
      </>
    ),
  },
  {
    key: "checks",
    title: "Проверок",
    numeric: true,
    width: "12%",
    render: (row) => <span className="num text-[var(--text-2)]">{row.checksTotal}</span>,
  },
  {
    key: "last",
    title: "Последняя",
    numeric: true,
    width: "20%",
    render: (row) => <span className="num text-[var(--text-2)]">{formatDate(row.lastCheckAt)}</span>,
  },
  {
    key: "status",
    title: "Состояние",
    width: "20%",
    render: (row) => {
      if (row.lastStatus === null) {
        return <span className="meta">проверок не было</span>;
      }
      const view = checkStatusWord(row.lastStatus);
      return <Pill dot={view.tone !== "danger"} label={view.label} loud={view.tone === "danger"} tone={view.tone} />;
    },
  },
];

export default async function ObjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ отказ?: string; статус?: string; регион?: string }>;
}) {
  const result = await currentViewer();

  if (result.kind === "гость") {
    return (
      <Page wide>
        <PageHead title="Реестр объектов" />
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

  const shell = shellOf("S-01", result.viewer);
  const decision = result.viewer.can("check:read");

  if (!decision.allowed) {
    // Отказ, а не пустой список: пустой список читается как «объектов нет», то
    // есть как утверждение о системе, а не о правах смотрящего.
    return shell(
      <Page wide>
        <PageHead title="Реестр объектов" />
        <Card>
          <CardBody>
            <StateDenied permission="check:read" reason={decision.reason} />
          </CardBody>
        </Card>
      </Page>,
    );
  }

  let objects: readonly ObjectRow[] = [];
  let failure: string | undefined;

  try {
    objects = await listObjects(result.viewer.actor.tenantId);
  } catch (error) {
    // «Список пуст» и «база недоступна» — разные положения дел, и решать по ним
    // нужно разное. Поэтому причина показывается целиком.
    failure = (error as Error).message;
  }

  const { отказ, статус, регион } = await searchParams;
  // Заведение объекта — то же право, что запуск Проверки: тот, кто ставит
  // прогон и грузит документы, заводит и объект, для которого это делает.
  const canCreate = result.viewer.can("check:start");

  const statuses = new Map<string, number>();
  const regions = new Map<string, number>();

  for (const obj of objects) {
    const s = obj.lastStatus ?? "нет";
    const r = obj.region ?? "не указан";
    statuses.set(s, (statuses.get(s) ?? 0) + 1);
    regions.set(r, (regions.get(r) ?? 0) + 1);
  }

  const statusOptions: FilterOption[] = Array.from(statuses.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([val, count]) => ({ value: val, label: val === "нет" ? "проверок не было" : checkStatusWord(val as any).label, count }));
    
  const regionOptions: FilterOption[] = Array.from(regions.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([val, count]) => ({ value: val, label: val, count }));

  const shown = objects.filter(
    (obj) =>
      (статус === undefined || (obj.lastStatus ?? "нет") === статус) &&
      (регион === undefined || (obj.region ?? "не указан") === регион)
  );
  
  const href = (next: { readonly status?: string | undefined; readonly region?: string | undefined }): string => {
    const query = new URLSearchParams();
    const nextStatus = "status" in next ? next.status : статус;
    const nextRegion = "region" in next ? next.region : регион;
    if (nextStatus !== undefined) query.set("статус", nextStatus);
    if (nextRegion !== undefined) query.set("регион", nextRegion);
    const tail = query.toString();
    return tail === "" ? "/objects" : `/objects?${tail}`;
  };
  
  const filtered = статус !== undefined || регион !== undefined;

  return shell(
    <Page wide>
      <PageHead note="Объекты арендатора и состояние последней Проверки по каждому." title="Реестр объектов" />

      {отказ === undefined ? null : (
        <Callout title="Объект не заведён" tone="danger">
          {отказ}
        </Callout>
      )}

      {/* ЗАВЕДЕНИЕ ОБЪЕКТА — ПЕРВЫЙ ШАГ ТРАКТА, И ЕГО ЗДЕСЬ НЕ БЫЛО.
          Объекты появлялись только наполнением контура: на встрече это значит,
          что материалы клиента некуда положить, пока кто-то не сходит в
          консоль. Форма над списком, а не под ним: на пустом реестре она и
          есть единственное, что можно сделать. */}
      {canCreate.allowed ? (
        <Card>
          <CardHead
            aside="шифр попадает в адрес объекта"
            note="После заведения система ведёт на загрузку документов — это следующий шаг тракта, и искать объект в списке для этого не нужно."
            title="Новый объект"
          />
          <CardBody>
            <form action="/api/objects" className="form-grid" method="post">
              <Field hint="Латиница, цифры, дефис: KRG-1" label="Шифр">
                <Input
                  autoComplete="off"
                  name="шифр"
                  pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,31}"
                  placeholder="KRG-2"
                  required
                  type="text"
                />
              </Field>
              <Field label="Имя объекта">
                <Input autoComplete="off" name="имя" placeholder="ЖДПП Зауралье" required type="text" />
              </Field>
              <Field hint="Необязательно" label="Регион">
                <Input autoComplete="off" name="регион" placeholder="Курганская обл." type="text" />
              </Field>
              <div className="form-grid__actions">
                <Button type="submit" variant="primary">
                  <FolderPlus aria-hidden="true" size={13} />
                  Завести объект
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      {objects.length > 0 && (statusOptions.length > 1 || regionOptions.length > 1) ? (
        <div className="toolbar">
          <FilterBar {...(filtered ? { reset: href({ status: undefined, region: undefined }) } : {})}>
            {statusOptions.length > 1 ? (
              <FilterGroup
                active={статус}
                allCount={objects.length}
                allLabel="любое состояние"
                hrefFor={(val) => href({ status: val })}
                label="Состояние"
                options={statusOptions}
              />
            ) : null}
            {regionOptions.length > 1 ? (
              <FilterGroup
                active={регион}
                allCount={objects.length}
                allLabel="все регионы"
                hrefFor={(val) => href({ region: val })}
                label="Регион"
                options={regionOptions}
              />
            ) : null}
          </FilterBar>
        </div>
      ) : null}

      <Card>
        <CardHead 
          aside={filtered ? `${shown.length} из ${objects.length} шт.` : `${objects.length} шт.`} 
          title="Объекты арендатора" 
        />
        <CardBody flush>
          {failure !== undefined ? (
            <StateFailed>{failure}</StateFailed>
          ) : (
            <DataTable
              caption="Объекты арендатора: шифр, число проверок и состояние последней"
              columns={COLUMNS}
              empty={
                filtered ? (
                  <StateEmpty title="Под отбор ничего не подошло">
                    Объектов с таким отбором нет. <a href={href({ status: undefined, region: undefined })}>Снять отбор</a>.
                  </StateEmpty>
                ) : (
                  <StateEmpty title="Объектов у арендатора нет">
                    {canCreate.allowed
                      ? "Заведите объект формой выше — и загрузите в него документы клиента."
                      : "Заведение объекта требует того же права, что запуск Проверки, и его у вас нет."}
                  </StateEmpty>
                )
              }
              rowKey={(row) => row.code}
              rows={shown}
            />
          )}
        </CardBody>
      </Card>
    </Page>,
  );
}
