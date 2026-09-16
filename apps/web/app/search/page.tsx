/**
 * Поиск по объектам и документам.
 *
 * ЭКРАН ПОЯВИЛСЯ ВМЕСТЕ СО СТРОКОЙ ПОИСКА, А НЕ ПОСЛЕ НЕЁ
 *
 * У прототипов заказчика в шапке стоит поиск («Поиск по смете, коллизиям,
 * рычагам, документам…»), и у Pulse тоже. Соблазн был поставить такую же
 * строку и оставить её неподключённой — но поиск, который ничего не находит, та
 * же ловушка, что кнопка без обработчика (`Ф-ADR-009`).
 *
 * Поэтому ищется то, что в системе действительно есть: объекты по шифру и
 * названию, документы по имени файла. Смет по содержанию и коллизий тут нет — и
 * экран об этом говорит, а не делает вид, что нашёл всё.
 *
 * ПОИСК НЕ ОБХОДИТ РАЗГРАНИЧЕНИЕ
 *
 * Запросы идут через `withTenant`, как и весь остальной веб. Поиск — самый
 * заметный способ достать чужое: он принимает произвольную строку и возвращает
 * всё похожее, поэтому изоляция здесь не «тоже нужна», а нужна в первую очередь.
 */
import { Building2, FileSpreadsheet, Search as SearchIcon } from "lucide-react";

import { createPrismaClient, withTenant } from "@platform/db/prisma";

import { currentViewer } from "@web/lib/actor";
import { shellOf } from "@web/src/app-shell/shell.js";
import { Card, CardBody, CardHead } from "@web/src/ui/kit/card.js";
import { Page, PageHead } from "@web/src/ui/kit/page.js";
import { StateDenied, StateEmpty } from "@web/src/ui/kit/states.js";

export const dynamic = "force-dynamic";

interface Hit {
  readonly kind: "объект" | "документ";
  readonly title: string;
  readonly note: string;
  readonly href: string;
}

/** Максимум находок на вид: экран поиска не заменяет реестр. */
const LIMIT = 20;

async function find(tenant: string, query: string): Promise<readonly Hit[]> {
  const db = createPrismaClient(process.env["DATABASE_URL"]);

  try {
    return await withTenant(db, tenant, async (tx) => {
      const [objects, documents] = await Promise.all([
        tx.projectObject.findMany({
          where: {
            OR: [
              { code: { contains: query, mode: "insensitive" } },
              { name: { contains: query, mode: "insensitive" } },
            ],
          },
          take: LIMIT,
          orderBy: { code: "asc" },
        }),
        tx.document.findMany({
          where: { fileName: { contains: query, mode: "insensitive" } },
          take: LIMIT,
          orderBy: { createdAt: "desc" },
          include: { object: { select: { code: true } } },
        }),
      ]);

      return [
        ...objects.map(
          (object): Hit => ({
            kind: "объект",
            title: object.name,
            note: `шифр ${object.code}${object.region === null ? "" : ` · ${object.region}`}`,
            href: `/objects/${encodeURIComponent(object.code)}`,
          }),
        ),
        ...documents.map(
          (document): Hit => ({
            kind: "документ",
            title: document.fileName,
            note: `${document.kind} · объект ${document.object.code}`,
            href: `/objects/${encodeURIComponent(document.object.code)}/documents`,
          }),
        ),
      ];
    });
  } finally {
    await db.$disconnect();
  }
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const result = await currentViewer();

  if (result.kind === "гость") {
    return (
      <Page>
        <PageHead note="Требуется вход: поиск идёт по данным арендатора." title="Поиск" />
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

  // Поиск живёт в шапке, а не в рельсе: подсвечивать нечего, зато путь
  // обязан называть место — иначе шапка подписывает экран чужим разделом.
  const shell = shellOf("", result.viewer, [{ label: "Поиск" }]);
  const decision = result.viewer.can("check:read");

  if (!decision.allowed) {
    return shell(
      <Page>
        <PageHead title="Поиск" />
        <Card>
          <CardBody>
            <StateDenied permission="check:read" reason={decision.reason} />
          </CardBody>
        </Card>
      </Page>,
    );
  }

  // Пустой запрос — не ошибка и не «ничего не найдено»: искать ещё нечего.
  const hits = query === "" ? [] : await find(result.viewer.actor.tenantId, query);

  return shell(
    <Page>
      <PageHead
        note="Объекты по шифру и названию, документы по имени файла. Содержимое смет и коллизии поиском пока не охвачены."
        title={query === "" ? "Поиск" : `Поиск: ${query}`}
      />

      <Card>
        <CardHead aside={query === "" ? "запрос не задан" : `находок ${hits.length}`} title="Что нашлось" />
        <CardBody flush>
          {query === "" ? (
            <StateEmpty title="Введите запрос">
              Строка поиска — в шапке. Ищутся объекты и документы этого арендатора.
            </StateEmpty>
          ) : hits.length === 0 ? (
            <StateEmpty title="Ничего не нашлось">
              {`По запросу «${query}» нет ни объектов, ни документов. Это утверждение о данных арендатора: поиск не выходит за его границы.`}
            </StateEmpty>
          ) : (
            <ul className="m-0 list-none p-0">
              {hits.map((hit) => (
                <li className="border-b border-[var(--line-2)] last:border-b-0" key={`${hit.kind}/${hit.href}/${hit.title}`}>
                  <a className="flex items-baseline gap-3 px-4 py-3 no-underline hover:bg-[var(--surface-hover)]" href={hit.href}>
                    {hit.kind === "объект" ? (
                      <Building2 aria-hidden="true" className="shrink-0 translate-y-0.5 text-[var(--text-4)]" size={14} />
                    ) : (
                      <FileSpreadsheet aria-hidden="true" className="shrink-0 translate-y-0.5 text-[var(--text-4)]" size={14} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="cell-title">{hit.title}</span>
                      <span className="cell-sub">{hit.note}</span>
                    </span>
                    <span className="meta shrink-0">{hit.kind}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <p className="meta m-0 flex items-center gap-2">
        <SearchIcon aria-hidden="true" size={12} />
        Поиск по содержанию смет появится вместе с индексом позиций — сейчас позиции ищутся внутри версии документа.
      </p>
    </Page>,
  );
}
