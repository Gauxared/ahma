/**
 * Скачивание одного документа пакета — шаг 6 тракта.
 *
 * ЧЕГО ЗДЕСЬ НЕ БЫЛО
 *
 * Ничего. Ядро умело собирать книги (`modules/exports/**`) и записывать их в
 * файл, но забрать результат из браузера было нельзя ни одним способом: маршрута
 * скачивания в вебе не существовало. Демо обрывалось на «прогон завершён».
 *
 * ПОЧЕМУ ФАЙЛ СОБИРАЕТСЯ НА КАЖДЫЙ ЗАПРОС
 *
 * Потому что артефакт неизменен, а книга — его отображение: собранная заново из
 * того же артефакта, она совпадает до байта. Хранить её значило бы завести
 * второй источник правды и вопрос «почему файл отличается от артефакта».
 *
 * ЧТО ЗАПИСЫВАЕТСЯ В АУДИТ
 *
 * `artifact.exported` — действие уже есть в словаре. Выгрузка наружу обязана
 * оставлять след: заказчик спорит по документу, а не по экрану, и «кто и когда
 * его забрал» — часть спора.
 */
import { NextResponse } from "next/server";

import { buildAgentReport } from "@modules/exports/agent-report.js";
import { buildMemo } from "@modules/exports/memo.js";
import { createPrismaClient, withTenant } from "@platform/db/prisma";
import { buildMemoDocx } from "@platform/storage/docx-writer.js";
import { buildWorkbook } from "@platform/storage/xlsx-writer.js";

import { requiredSectionsOf, roleOf } from "@web/lib/agent-roles";
import { readCheck, verdictText } from "@web/lib/check-read-model";
import { guardMutation } from "@web/lib/mutation";
import { agentsOf, compositionOf, sourceArtifact } from "@web/lib/package-read-model";

const GENERATOR_VERSION = "1.0.0";

/**
 * Имя, пригодное для файловой системы: пробелы подчёркиваниями, разделители
 * пути и кавычки убраны. Кириллица остаётся — она и есть смысл этой правки.
 */
function имяДляФайла(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

/**
 * Запасное ASCII-имя для заголовка `filename=`.
 *
 * Кириллицу в нём заменяем подчёркиваниями, а не транслитерируем: таблица
 * транслитерации — это ещё одно место, где можно ошибиться, а имя здесь только
 * для тех клиентов, которые не читают расширенную форму.
 */
function латиницей(value: string): string {
  return value.replace(/[^\u0020-\u007e]/g, "_").replace(/"/g, "");
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; slug: string }> },
): Promise<Response> {
  const { id, slug } = await context.params;

  const guard = await guardMutation(request, "check:read", {
    action: "artifact.exported",
    resourceKind: "package-document",
    resourceId: `${id}/${slug}`,
  });

  if (!guard.ok) return guard.response;

  const entry = compositionOf(slug);

  if (entry === undefined) {
    return NextResponse.json({ error: `в пакете нет документа ${slug}` }, { status: 404 });
  }

  if (entry.capability === undefined) {
    // Отказ с ПРИЧИНОЙ, а не пустой файл: пустая книга читается как результат.
    return NextResponse.json(
      { error: "в конвейере нет агента, который производит этот документ" },
      { status: 409 },
    );
  }

  const tenantId = guard.viewer.actor.tenantId;
  const db = createPrismaClient(process.env["DATABASE_URL"]);

  let objectCode: string;

  try {
    const check = await withTenant(db, tenantId, (tx) =>
      tx.check.findFirst({ where: { id }, include: { object: { select: { code: true } } } }),
    );

    if (check === null) {
      return NextResponse.json({ error: "проверка не найдена" }, { status: 404 });
    }

    objectCode = check.object.code;
  } finally {
    await db.$disconnect();
  }

  const card = await readCheck(tenantId, objectCode, id);

  if (card === undefined) {
    return NextResponse.json({ error: "проверка не найдена" }, { status: 404 });
  }

  const agent = agentsOf(card).get(entry.capability);

  if (agent === undefined) {
    return NextResponse.json(
      { error: `агент ${entry.capability} не высказался в этом прогоне: документ собрать не из чего` },
      { status: 409 },
    );
  }

  const artifact = sourceArtifact(card);
  const producedAt = (card.finishedAt ?? card.createdAt).toISOString().slice(0, 10);
  const role = roleOf(entry.capability);

  const bytes =
    entry.format === "docx"
      ? await buildMemoDocx(
          buildMemo({
            passport: {
              objectName: card.objectName,
              customer: card.objectCode,
              documentCount: agent.subjects.length,
              checkedAt: producedAt,
              total: "0.00",
            },
            sections: [
              {
                agent: role ?? entry.capability,
                role: entry.capability,
                // «Отказ» отличён от «выполнен» словом: агент, который не смог,
                // и агент без замечаний — разные утверждения, и записка обязана
                // их различать.
                status: agent.errors.length > 0 ? "отказ" : "выполнен",
                findings: agent.findings.map((finding) => finding.statement),
                conclusion: agent.verdicts.length === 0 ? "вердикт не выдан" : verdictText(agent.verdicts),
              },
            ],
          }),
        )
      : await buildWorkbook(
          buildAgentReport({
            title: `${entry.ordinal} ${entry.title}`,
            capability: entry.capability,
            ...(role === undefined ? {} : { role }),
            objectName: card.objectName,
            objectCode: card.objectCode,
            verdict: verdictText(agent.verdicts),
            subjects: agent.subjects,
            findings: agent.findings,
            errors: agent.errors,
            // Поручения агента — «что проверить человеку». До этой правки они
            // до пакета не доходили вовсе, хотя это графа формы результата.
            tasks: agent.openQuestions.map((question) => ({
              question: question.question,
              owner: question.owner,
              dueBy: question.dueBy,
            })),
            /**
             * Предметные листы — как их описал агент по ЭТОМУ объекту.
             *
             * Ни названия, ни колонки не заданы конфигурацией: эталонный пакет
             * снят с одного объекта, и его «КС_геометрия» бессмысленна для
             * жилого дома. Форму документа держит порядок, а не список имён.
             */
            sheets: agent.sheets,
            /**
             * Каркас роли — из манифеста агента, откуда его берёт и промпт.
             *
             * Он не про объект, а про роль: сметчик отвечает про сходимость
             * смет и на переезде, и в жилом доме. Не данный лист каркаса —
             * пробел; не данный предметный лист — отсутствие предмета, и книга
             * обязана различать это словами.
             */
            requiredSheets: requiredSectionsOf(entry.capability),
            artifactId: artifact?.id ?? id,
            inputHashes: artifact?.inputHashes ?? [],
            producedAt,
            generatorVersion: GENERATOR_VERSION,
          }),
        );

  await guard.audit("artifact.exported", { kind: "package-document", id: `${id}/${slug}` });

  /**
   * Имя файла — русское и с именем объекта, как в эталонном пакете.
   *
   * Было `01_itogovaya-zapiska_KRG-1.docx`: транслитерация плюс шифр. В образце
   * `reference-system/output-1` — `01_Итоговая_записка_Зауралье.docx`, и это
   * первое, что клиент видит, сохранив пакет в папку. Шифр объекта ему ничего
   * не говорит; имя объекта говорит всё.
   *
   * Шифр остаётся, когда имени нет: файл без опознания хуже транслитерации.
   */
  const fileName = `${entry.ordinal}_${имяДляФайла(entry.title)}_${имяДляФайла(card.objectName || card.objectCode)}.${entry.format}`;

  // `Buffer.from`, а не сам `Uint8Array`: тело ответа в Node-исполнении
  // принимает буфер, и приведение типом здесь было бы обещанием, что массив
  // подойдёт, — а не проверкой.
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "content-type":
        entry.format === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      /**
       * `attachment` с именем: без него браузер откроет книгу как текст.
       *
       * Имя отдаётся ДВАЖДЫ. `filename=` понимают все, но по RFC 6266 в нём
       * только ASCII, и кириллица приезжает мусором. `filename*=UTF-8''…`
       * понимают современные браузеры, и они предпочитают его. Оставить одно
       * из двух значило бы либо потерять русское имя, либо потерять имя вовсе
       * там, где расширенную форму не читают.
       */
      "content-disposition":
        `attachment; filename="${латиницей(fileName)}"; ` +
        `filename*=UTF-8''${encodeURIComponent(fileName)}`,
      // Документ собирается из неизменного артефакта, но кэшировать его нельзя:
      // право на чтение проверяется на каждом запросе.
      "cache-control": "no-store",
    },
  });
}
