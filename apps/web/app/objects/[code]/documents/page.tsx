/**
 * Загрузка и разбор документов — экран §5.5 (3), поверхность `S-03`.
 *
 * ЧТО ЗДЕСЬ ЕСТЬ И ЧЕГО НЕТ
 *
 * Есть разбор: документы объекта, их версии, состояние приобретения, число
 * извлечённых позиций. Есть переход к позициям версии.
 *
 * ЗАГРУЗКИ ФАЙЛОВ ЗДЕСЬ НЕТ, И ЭТО НАЗВАНО. Объектного хранилища в системе пока
 * нет: `storagePath` версии — путь на томе, куда файл положила Проверка,
 * запущенная по папке. Кнопка «загрузить», ведущая в никуда, была бы хуже её
 * отсутствия — экран, ВЫГЛЯДЯЩИЙ пишущим, обманывает дважды.
 *
 * ПУСТО — ЭТО ТРИ РАЗНЫХ СООБЩЕНИЯ
 *
 * «Документов нет», «объект не найден» и «база недоступна» решаются по-разному,
 * и различить их можно только назвав. Пустая таблица говорит первое, а на деле
 * может значить любое из трёх.
 */
import { FileSpreadsheet } from "lucide-react";

import { currentViewer } from "@web/lib/actor";
import { listDocuments, type DocumentRow, type VersionRow } from "@web/lib/documents-read-model";
import { shellOf } from "@web/src/app-shell/shell.js";
import { ButtonLink } from "@web/src/ui/kit/button.js";
import { Callout } from "@web/src/ui/kit/callout.js";
import { Card, CardBody, CardHead } from "@web/src/ui/kit/card.js";
import { ObjectHead } from "@web/src/ui/command/object-head.js";
import { Page } from "@web/src/ui/kit/page.js";
import { Pill, type PillTone } from "@web/src/ui/kit/pill.js";
import { StateDenied, StateEmpty, StateFailed } from "@web/src/ui/kit/states.js";
import { DataTable, type Column } from "@web/src/ui/kit/table.js";

export const dynamic = "force-dynamic";

/**
 * Как получены данные (ADR-R-019) — словом, а не кодом поля.
 *
 * `parsed` и `confirmed_by_human` — разные основания доверять числу, и §12.1д
 * требует, чтобы это было видно на экране, а не выводилось читателем из
 * английского идентификатора.
 */
const ACQUISITION: Readonly<Record<string, { readonly label: string; readonly tone: PillTone }>> = {
  parsed: { label: "разобрано", tone: "info" },
  imported: { label: "импортировано", tone: "info" },
  confirmed_by_human: { label: "подтверждено человеком", tone: "ok" },
  ocr_unconfirmed: { label: "OCR без подтверждения", tone: "warn" },
};

function formatBytes(value: number): string {
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
  return `${(value / (1024 * 1024)).toFixed(1)} МБ`;
}

function versionColumns(code: string, fileName: string): readonly Column<VersionRow>[] {
  return [
    {
      key: "revision",
      title: "Ревизия",
      numeric: true,
      width: "10%",
      render: (row) => (
        <a className="num font-semibold" href={`/objects/${encodeURIComponent(code)}/documents/${row.id}`}>
          {`№${row.revision}`}
        </a>
      ),
    },
    {
      key: "positions",
      title: "Позиций",
      numeric: true,
      width: "12%",
      render: (row) =>
        row.positions === 0 ? (
          // Ноль позиций у разобранного документа — не «пусто», а утверждение:
          // файл прочитан, а сметных строк в нём не найдено.
          <Pill label="строк нет" title="Файл разобран, сметных строк не найдено" tone="warn" />
        ) : (
          <span className="num text-[var(--text-2)]">{row.positions}</span>
        ),
    },
    {
      key: "acquisition",
      title: "Основание",
      width: "22%",
      render: (row) => {
        const view = ACQUISITION[row.acquisition] ?? { label: row.acquisition, tone: "plain" as PillTone };
        return <Pill dot label={view.label} tone={view.tone} />;
      },
    },
    {
      key: "hash",
      title: "Отпечаток",
      width: "14%",
      render: (row) => (
        <span className="mono text-[var(--t-meta)] text-[var(--text-3)]" title={row.contentHash}>
          {row.contentHash.slice(0, 8)}
        </span>
      ),
    },
    {
      key: "size",
      title: "Размер",
      numeric: true,
      width: "12%",
      render: (row) => <span className="num text-[var(--text-3)]">{formatBytes(row.byteSize)}</span>,
    },
    {
      key: "at",
      title: "Разобрана",
      numeric: true,
      render: (row) => (
        <span className="num text-[var(--text-3)]">
          {row.createdAt.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}
        </span>
      ),
    },
  ];
}

function DocumentCard({ document, code }: { readonly document: DocumentRow; readonly code: string }) {
  return (
    <Card>
      <CardHead
        aside={`${document.versions.length} ${document.versions.length === 1 ? "версия" : "версии"}`}
        title={document.fileName}
      >
        <span className="flex items-center gap-2.5">
          <FileSpreadsheet aria-hidden="true" className="shrink-0 text-[var(--text-4)]" size={14} />
          <span className="meta">{document.kind}</span>
        </span>
      </CardHead>
      <CardBody flush>
        <DataTable
          caption={`Версии документа ${document.fileName}: ревизия, позиции, основание и отпечаток`}
          columns={versionColumns(code, document.fileName)}
          empty={
            <StateEmpty title="Версий нет">
              Документ заведён, но ни одного разбора по нему не сохранено.
            </StateEmpty>
          }
          rowKey={(row) => row.id}
          rows={document.versions}
        />
      </CardBody>
    </Card>
  );
}

export default async function DocumentsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const result = await currentViewer();

  if (result.kind === "гость") {
    return (
      <Page wide>
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

  const object = decodeURIComponent(code);
  const shell = shellOf("S-03", result.viewer, [
    { href: `/objects/${encodeURIComponent(code)}`, label: object },
  ], decodeURIComponent(code));
  const decision = result.viewer.can("check:read", { kind: "object", id: object });

  if (!decision.allowed) {
    return shell(
      <Page wide>
        <Card>
          <CardBody>
            <StateDenied permission="check:read" reason={decision.reason} />
          </CardBody>
        </Card>
      </Page>,
    );
  }

  let card;
  try {
    card = await listDocuments(result.viewer.actor.tenantId, object);
  } catch (error) {
    return shell(
      <Page wide>
        <Card>
          <CardBody>
            <StateFailed>{(error as Error).message}</StateFailed>
          </CardBody>
        </Card>
      </Page>,
    );
  }

  if (card === undefined) {
    return shell(
      <Page wide>
        <Card>
          <CardBody>
            <StateEmpty title="Объект не найден">
              {`Объекта с шифром ${object} у этого арендатора нет. Это утверждение о данных, а не об отсутствии права.`}
            </StateEmpty>
          </CardBody>
        </Card>
      </Page>,
    );
  }

  const versions = card.documents.reduce((sum, document) => sum + document.versions.length, 0);
  const positions = card.documents.reduce(
    (sum, document) => sum + document.versions.reduce((inner, version) => inner + version.positions, 0),
    0,
  );

  return shell(
    <Page wide>
      <ObjectHead
        active="документы"
        aside={
          <span className="flex flex-wrap items-baseline gap-x-6 gap-y-1.5">
            <span className="meta">{`версий ${versions}`}</span>
            <span className="meta">{`позиций ${positions}`}</span>
            <ButtonLink href={`/objects/${encodeURIComponent(card.objectCode)}/upload`} size="sm">
              Загрузить и проверить
            </ButtonLink>
          </span>
        }
        code={card.objectCode}
        counts={{ документы: card.documents.length }}
        name={card.objectName}
        note="Позиции принадлежат версии, а не файлу: правка файла — новый разбор."
      />

      {card.documents.length === 0 ? (
        <Card>
          <CardBody>
            <StateEmpty title="Документов у объекта нет">
              Разбор появляется вместе с Проверкой: она читает папку объекта, сохраняет файлы версиями и извлекает
              позиции. Запустите Проверку на карточке объекта.
            </StateEmpty>
          </CardBody>
        </Card>
      ) : (
        card.documents.map((document) => <DocumentCard code={code} document={document} key={document.id} />)
      )}

      {/* Оговорка ПОСЛЕ данных: она про способ загрузки, а не про риск. Стоя
          сверху, она читалась бы как предупреждение о негодности разбора. */}
      <Callout title="Загрузки файлов из веба здесь нет" tone="info">
        Объектного хранилища в системе пока нет: путь версии ведёт на том, куда файл положила Проверка, запущенная по
        папке. Кнопка загрузки появится вместе с хранилищем, а не раньше — управляющий элемент, ничего не делающий,
        хуже его отсутствия.
      </Callout>
    </Page>,
  );
}
