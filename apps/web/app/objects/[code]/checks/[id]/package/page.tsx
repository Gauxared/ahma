/**
 * Пакет заказчику — шаг 6 тракта и его конец.
 *
 * ПОЧЕМУ СТРОК ВСЕГДА ДЕСЯТЬ
 *
 * Пакет — это обещание: в `reference-system/output-1` десять документов, и
 * заказчик считает по этому перечню. Собирай состав из того, что отработало, — и
 * пакет молча уменьшится на неудачном прогоне, а не заметит этого никто.
 * Здесь строк всегда десять, и каждая либо даёт файл, либо называет причину.
 *
 * ПОЧЕМУ СКАЧИВАНИЕ — ФОРМА, А НЕ ССЫЛКА
 *
 * Выгрузка наружу пишется в аудит (`artifact.exported`), то есть меняет
 * состояние системы, а `GET` по определению этого не делает. Ссылка, которая
 * пишет в журнал, ломается о предзагрузку браузером: журнал наполнялся бы
 * выгрузками, которых никто не запрашивал.
 */
import { Download } from "lucide-react";

import { currentViewer } from "@web/lib/actor";
import { personOf, roleOf } from "@web/lib/agent-roles";
import { readPackage, type PackageRow } from "@web/lib/package-read-model";
import { shellOf } from "@web/src/app-shell/shell.js";
import { Button } from "@web/src/ui/kit/button.js";
import { Callout } from "@web/src/ui/kit/callout.js";
import { Card, CardBody, CardHead } from "@web/src/ui/kit/card.js";
import { ObjectHead } from "@web/src/ui/command/object-head.js";
import { Page, PageHead } from "@web/src/ui/kit/page.js";
import { Pill } from "@web/src/ui/kit/pill.js";
import { StateDenied, StateEmpty } from "@web/src/ui/kit/states.js";
import { DataTable, type Column } from "@web/src/ui/kit/table.js";

export const dynamic = "force-dynamic";

interface Row extends PackageRow {
  readonly checkId: string;
  readonly role: string | undefined;
  /** Имя агента: им подписаны замечания в протоколах заказчика. */
  readonly person: string | undefined;
}

function columns(): readonly Column<Row>[] {
  return [
    {
      key: "document",
      title: "Документ",
      render: (row) => (
        <>
          <span className="cell-title">
            <span className="num text-[var(--text-4)]">{row.ordinal}</span> {row.title}
          </span>
          <span className="cell-sub">
            {/* Имя и роль вместе: в протоколах заказчика замечания подписаны
                именем («Виктор»), а роль объясняет, почему именно он это
                сказал. Способность остаётся третьей — по ней документ ищут в
                артефакте. */}
            {row.capability === undefined
              ? "агента нет"
              : [row.person, row.role, row.capability].filter((part) => part !== undefined).join(" · ")}
          </span>
        </>
      ),
    },
    {
      key: "findings",
      title: "Замечаний",
      numeric: true,
      width: "12%",
      render: (row) =>
        row.state.kind === "готов" ? (
          <span className="num">{row.findings}</span>
        ) : (
          <span className="text-[var(--text-4)]">—</span>
        ),
    },
    {
      key: "severity",
      title: "Из них",
      width: "26%",
      render: (row) =>
        row.bySeverity.length === 0 ? (
          <span className="text-[var(--text-4)]">—</span>
        ) : (
          <span className="text-[var(--t-meta)] text-[var(--text-2)]">
            {row.bySeverity.map(([word, count]) => `${word} ${count}`).join(" · ")}
          </span>
        ),
    },
    {
      key: "state",
      title: "Состояние",
      width: "30%",
      render: (row) =>
        row.state.kind === "готов" ? (
          // Форма, а не ссылка: выгрузка пишется в аудит.
          <form
            action={`/api/checks/${encodeURIComponent(row.checkId)}/package/${encodeURIComponent(row.slug)}`}
            method="post"
          >
            <Button size="sm" type="submit" variant="outline">
              <Download aria-hidden="true" size={12} />
              {row.format}
            </Button>
          </form>
        ) : (
          // Причина словом и полностью — в подсказке. «Не собран» без причины
          // читается как поломка системы, а не как её граница.
          <Pill label="не собран" loud title={row.state.reason} tone="warn" />
        ),
    },
  ];
}

export default async function PackagePage({
  params,
}: {
  params: Promise<{ code: string; id: string }>;
}) {
  const { code, id } = await params;
  const result = await currentViewer();

  if (result.kind === "гость") {
    return (
      <Page>
        <PageHead title="Пакет заказчику" />
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

  const shell = shellOf("S-21", result.viewer, [
    { label: code, href: `/objects/${encodeURIComponent(code)}` },
    { label: "Пакет" },
  ], decodeURIComponent(code));

  const decision = result.viewer.can("check:read");

  if (!decision.allowed) {
    return shell(
      <Page>
        <PageHead title="Пакет заказчику" />
        <Card>
          <CardBody>
            <StateDenied permission="check:read" reason={decision.reason} />
          </CardBody>
        </Card>
      </Page>,
    );
  }

  const card = await readPackage(result.viewer.actor.tenantId, code, id);

  if (card === undefined) {
    return shell(
      <Page>
        <PageHead title="Пакет заказчику" />
        <Card>
          <CardBody>
            <StateEmpty title="Проверка не найдена">
              Проверки с таким идентификатором по объекту {code} у этого арендатора нет.
            </StateEmpty>
          </CardBody>
        </Card>
      </Page>,
    );
  }

  const rows: readonly Row[] = card.rows.map((row) => ({
    ...row,
    checkId: card.checkId,
    role: row.capability === undefined ? undefined : roleOf(row.capability),
    person: row.capability === undefined ? undefined : personOf(row.capability),
  }));

  return shell(
    <Page wide>
      <ObjectHead
        active="пакет"
        aside={
          <>
            <Pill
              dot
              label={`собрано ${card.ready} из ${card.promised}`}
              tone={card.ready === card.promised ? "ok" : "warn"}
            />
            {card.producedAt === null ? null : (
              <span className="meta num">{card.producedAt.toLocaleString("ru-RU")}</span>
            )}
          </>
        }
        code={card.objectCode}
        counts={{ пакет: card.promised }}
        name={card.objectName}
        note={`Шифр ${card.objectCode} · пакет заказчику`}
      />

      {/* Один раз наверху, а не десять раз в строках.
          Прогон без обзора даёт десять одинаковых отказов, и такая таблица
          читается как поломка системы, тогда как причина у них общая: собирать
          пока нечего. «Этот документ не собрать» и «нечего собирать» — разные
          утверждения, и путать их нельзя. */}
      {card.silent ? (
        <Callout title="Собирать пока нечего" tone="warn">
          В этом прогоне не высказался ни один агент: он либо ещё идёт, либо завершился без обзора. Причина у всех
          десяти строк ниже одна и эта, а не десять разных.
        </Callout>
      ) : null}

      <Card>
        <CardHead
          aside="состав по reference-system/output-1 · один документ на агента"
          title="Документы пакета"
        />
        <CardBody flush>
          <DataTable
            caption="Документы пакета заказчику: номер, агент, замечания и состояние сборки"
            columns={columns()}
            empty={<StateEmpty title="Состав пакета пуст">Перечень документов не задан.</StateEmpty>}
            rowKey={(row) => row.slug}
            rows={rows}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHead title="Чему здесь верить" />
        <CardBody>
          <p className="m-0 text-[var(--t-body)] leading-relaxed">
            {/* «Девять из десяти» стояло здесь, пока десятого агента не было: график
                производства работ значился объявленным отсутствием. Он заведён 06.09,
                и подпись, пережившая его появление, занижала собственный результат. */}
            Каждый документ наполняет один агент: замечания в них — то, что агент сказал в{" "}
            <strong>этом</strong> прогоне, с основанием, которое он привёл. Основание — проза агента, а не расчёт: следа
            формулы под ним нет, и лист «Не покрыто» в каждой книге говорит об этом прямо.
          </p>
          <p className="meta m-0 mt-2">
            Эффекта замечания в рублях в документах нет, и это не упущение вёрстки: в контракте агента нет
            типизированного влияния, а приделать провенанс к тексту значило бы изобразить расчёт, которого не было.
          </p>
        </CardBody>
      </Card>
    </Page>,
  );
}
