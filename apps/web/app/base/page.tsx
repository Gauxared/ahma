/**
 * НОРМАТИВНАЯ И ОПОРНАЯ БАЗА — экран Т12.
 *
 * ЗАЧЕМ ЭКРАН, ЕСЛИ РОЛИ ЧИТАЮТ БАЗУ ФАЙЛАМИ
 *
 * Требование звучит как «вся нормативка и опорная база в системе, до единой
 * строчки». Это утверждение о полноте, а утверждение о полноте проверяется
 * ТОЛЬКО числами. Поэтому экран показывает не «база загружена», а источник,
 * число строк в нём и отпечаток версии — то, что можно сверить с исходником.
 *
 * ПОИСК ПО ПОДСТРОКЕ, А НЕ ПОЛНОТЕКСТОВЫЙ. Шифр расценки ищут как он написан в
 * смете — `ГЭСН27-04-001-01`, — а словарный поиск разобрал бы его на части и
 * потерял. Наименование при этом ищется тем же способом и находится.
 */
import { createPrismaClient } from "@platform/db/prisma";

import { currentViewer } from "@web/lib/actor";
import { shellOf } from "@web/src/app-shell/shell.js";
import { Card, CardBody, CardHead } from "@web/src/ui/kit/card.js";
import { Page, PageHead } from "@web/src/ui/kit/page.js";
import { Pill } from "@web/src/ui/kit/pill.js";
import { StateDenied, StateEmpty } from "@web/src/ui/kit/states.js";
import { DataTable, type Column } from "@web/src/ui/kit/table.js";

export const dynamic = "force-dynamic";

/** Потолок выдачи объявлен числом: срез, о котором не сказано, — это ложь о полноте. */
const ПОТОЛОК = 200;

interface SourceRow {
  readonly slug: string;
  readonly kind: string;
  readonly records: number;
  readonly contentHash: string;
}

interface FoundRow {
  readonly id: string;
  readonly source: string;
  readonly section: string;
  readonly key: string;
  readonly unit: string | null;
}

const KIND_LABEL: Readonly<Record<string, string>> = {
  "нормативный-каталог": "нормативный каталог",
  "опорная-база": "опорная база",
};

/**
 * Источники общие для установки (`tenantId IS NULL`), поэтому арендатор не
 * нужен: ГЭСН одинаков у всех, и политика RLS это прямо разрешает.
 */
async function readBase(query: string): Promise<{
  readonly sources: readonly SourceRow[];
  readonly found: readonly FoundRow[];
}> {
  const db = createPrismaClient(process.env["DATABASE_URL"]);

  try {
    const sources = await db.knowledgeSource.findMany({
      orderBy: { slug: "asc" },
      // Версия — у источника: у записи `contentHash` означает отпечаток самой
      // записи, и брать его за версию книги значило бы показать случайную строку.
      select: { slug: true, kind: true, contentHash: true, _count: { select: { records: true } } },
    });

    const found =
      query === ""
        ? []
        : await db.knowledgeRecord.findMany({
            where: { key: { contains: query, mode: "insensitive" } },
            take: ПОТОЛОК,
            orderBy: { key: "asc" },
            select: { id: true, key: true, section: true, unit: true, source: { select: { slug: true } } },
          });

    return {
      sources: sources.map((source) => ({
        slug: source.slug,
        kind: source.kind,
        records: source._count.records,
        contentHash: source.contentHash ?? "",
      })),
      found: found.map((record) => ({
        id: record.id,
        source: record.source.slug,
        section: record.section,
        key: record.key,
        unit: record.unit,
      })),
    };
  } finally {
    await db.$disconnect();
  }
}

const SOURCE_COLUMNS: readonly Column<SourceRow>[] = [
  {
    key: "slug",
    title: "Источник",
    width: "48%",
    render: (row) => (
      <>
        <span className="cell-title">{row.slug}</span>
        <span className="cell-sub">{KIND_LABEL[row.kind] ?? row.kind}</span>
      </>
    ),
  },
  {
    key: "records",
    title: "Строк",
    numeric: true,
    width: "18%",
    render: (row) => <span className="num">{row.records.toLocaleString("ru-RU")}</span>,
  },
  {
    key: "hash",
    title: "Версия",
    width: "34%",
    render: (row) =>
      row.contentHash === "" || /^0+$/u.test(row.contentHash) ? (
        // Пустая ячейка читается как недосмотр вёрстки. Отсутствие отпечатка —
        // свойство источника, и оно называется словом.
        <Pill dot label="отпечаток не снят" tone="warn" />
      ) : (
        <span className="mono text-[var(--t-meta)] text-[var(--text-2)]">{row.contentHash.slice(0, 16)}</span>
      ),
  },
];

const FOUND_COLUMNS: readonly Column<FoundRow>[] = [
  { key: "key", title: "Строка", width: "58%", render: (row) => <span className="cell-title">{row.key}</span> },
  { key: "unit", title: "Ед.", numeric: true, width: "10%", render: (row) => <span className="num">{row.unit ?? "—"}</span> },
  {
    key: "source",
    title: "Источник · раздел",
    width: "32%",
    render: (row) => (
      <>
        <span className="cell-title">{row.source}</span>
        <span className="cell-sub">{row.section}</span>
      </>
    ),
  },
];

export default async function BasePage({
  searchParams,
}: {
  searchParams: Promise<{ запрос?: string }>;
}) {
  const result = await currentViewer();

  if (result.kind === "гость") {
    return (
      <Page wide>
        <PageHead title="База" />
        <Card>
          <CardBody>
            <StateDenied permission="вход" reason={`${result.reason}.`}>
              <a href="/login">Войти</a>
            </StateDenied>
          </CardBody>
        </Card>
      </Page>
    );
  }

  const shell = shellOf("S-06", result.viewer);
  const { запрос } = await searchParams;
  const искомое = (запрос ?? "").trim();
  const { sources, found } = await readBase(искомое);
  const total = sources.reduce((sum, source) => sum + source.records, 0);

  return shell(
    <Page wide>
      <PageHead
        note={
          sources.length === 0
            ? "Источников в базе нет"
            : `Источников ${sources.length} · строк ${total.toLocaleString("ru-RU")}`
        }
        title="Нормативная и опорная база"
      />

      <Card>
        <CardHead title="Поиск по строкам" />
        <CardBody>
          <form action="/base" className="flex flex-wrap items-center gap-3" method="get">
            <input
              aria-label="Что искать в базе"
              className="field grow"
              defaultValue={искомое}
              name="запрос"
              placeholder="шифр расценки или часть наименования"
              type="search"
            />
            <button className="btn btn--primary" type="submit">
              Найти
            </button>
          </form>

          <p className="meta mt-3">
            {искомое === ""
              ? "Введите шифр так, как он написан в смете, или часть наименования."
              : found.length === 0
                ? `По запросу «${искомое}» в базе ничего нет. Это ответ, а не сбой: норму, которой здесь нет, роль не выдаёт за проверенную.`
                : found.length === ПОТОЛОК
                  ? `Показаны первые ${ПОТОЛОК} строк — их может быть больше. Уточните запрос.`
                  : `Найдено строк: ${found.length}.`}
          </p>

          {found.length > 0 ? (
            <DataTable
              caption="Найденные строки базы"
              columns={FOUND_COLUMNS}
              empty={<StateEmpty title="Ничего не найдено" />}
              paging={{ page: 1, pageSize: 50, hrefFor: () => "#" }}
              rowKey={(row) => row.id}
              rows={found}
            />
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHead title="Источники" />
        <CardBody>
          <p className="meta mb-3">
            На эту базу опирается анализ: расценка, цена и норматив берутся отсюда, а не из памяти
            модели.
          </p>
          <DataTable
            caption="Источники базы"
            columns={SOURCE_COLUMNS}
            empty={
              <StateEmpty title="База не загружена">
                Загрузка — `pnpm tsx tooling/import-knowledge.ts`. Источники берутся обходом
                `config/crew/bases`, поэтому положенная туда книга появляется здесь без правки кода.
              </StateEmpty>
            }
            rowKey={(row) => row.slug}
            rows={sources}
          />
        </CardBody>
      </Card>
    </Page>,
  );
}
