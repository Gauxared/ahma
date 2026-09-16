/**
 * Приём файлов объекта — шаг 2 тракта.
 *
 * ЧЕГО ЗДЕСЬ НЕ БЫЛО ВООБЩЕ
 *
 * До этого обработчика загрузки в системе не существовало: на карточке объекта
 * стояло поле, куда вписывали путь к папке на сервере, и ядро читало эту папку.
 * Демо было невозможно по простой причине — файлы нельзя было дать.
 *
 * ПОЧЕМУ ФАЙЛЫ ЧИТАЮТСЯ ДО РУБЕЖЕЙ
 *
 * По той же причине, что в постановке проверки: попытка без предмета — строка в
 * журнале, по которой не понять, к чему она относилась. Тело читается, шифр
 * объекта достаётся, и только потом идут четыре рубежа `guardMutation`.
 *
 * ЧТО ЗАПИСЫВАЕТСЯ В АУДИТ
 *
 * Строка НА КАЖДЫЙ принятый файл, а не одна на партию, и действие берётся из
 * словаря — `document.received` в нём уже есть. Отпечаток кладётся в
 * `payloadHash`, для которого поле и заведено: это тот же SHA-256, которым ядро
 * помечает входы артефакта, поэтому по журналу можно ответить на вопрос «этот
 * ли комплект проверяли», не открывая каталог.
 */
import { NextResponse } from "next/server";

import { createPrismaClient, withTenant } from "@platform/db/prisma";
import { recordAudit } from "@platform/security/audit";

import { guardMutation } from "@web/lib/mutation";
import { publicUrl } from "@web/lib/public-url";
import { startCheck } from "@web/lib/start-check";
import { MAX_FILES, saveBatch, итогЗагрузкиВАдрес, type IncomingFile } from "@web/lib/uploads";

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const objectCode = String(form.get("objectCode") ?? "").trim();

  const guard = await guardMutation(request, "check:start", {
    action: "document.received",
    resourceKind: "object",
    ...(objectCode === "" ? {} : { resourceId: objectCode }),
  });

  if (!guard.ok) return guard.response;

  if (objectCode === "") {
    return NextResponse.json({ error: "не указан объект" }, { status: 400 });
  }

  const incoming: IncomingFile[] = [];

  // `getAll` вместо `get`: комплект `input-1` — семь файлов, и поле одно.
  for (const entry of form.getAll("файлы")) {
    if (typeof entry === "string") continue;
    incoming.push({ name: entry.name, bytes: new Uint8Array(await entry.arrayBuffer()) });

    // Потолок держится и здесь, а не только в записи: тысяча файлов в теле
    // запроса — это память сервера, потраченная до первой проверки.
    if (incoming.length > MAX_FILES) break;
  }

  if (incoming.length === 0) {
    const url = publicUrl(request, `/objects/${encodeURIComponent(objectCode)}/upload`);
    url.searchParams.set("итог", "пусто");
    return NextResponse.redirect(url, 303);
  }

  const tenantId = guard.viewer.actor.tenantId;
  const db = createPrismaClient(process.env["DATABASE_URL"]);

  try {
    // Объект обязан существовать У ЭТОГО арендатора: иначе шифр из адреса
    // задавал бы имя каталога, в который можно писать, не имея объекта.
    const object = await withTenant(db, tenantId, (tx) =>
      tx.projectObject.findFirst({ where: { code: objectCode } }),
    );

    if (object === null) {
      return NextResponse.json({ error: "объект не найден" }, { status: 404 });
    }

    const saved = await saveBatch({ tenantId, code: objectCode, files: incoming, now: new Date() });

    if (saved === undefined) {
      return NextResponse.json({ error: "шифр объекта непригоден для хранения файлов" }, { status: 400 });
    }

    if (saved.accepted.length > 0) {
      await withTenant(db, tenantId, async (tx) => {
        for (const file of saved.accepted) {
          await recordAudit(tx, tenantId, {
            action: "document.received",
            resourceKind: "document",
            resourceId: `${saved.batch}/${file.name}`,
            actorId: guard.viewer.actor.userId,
            payloadHash: file.hash,
            reason: `объект ${objectCode}, ${file.bytes} Б`,
          });
        }
      });
    }

    /**
     * ГАЛОЧКА «СРАЗУ ЧЕРЕЗ АГЕНТОВ» (spec-demo-stage-1 А2).
     *
     * Партия сохранена — и та же загрузка ставит Проверку экипажем на Codex SDK,
     * без второго нажатия. Постановка — той же функцией, что у `/api/checks`:
     * тот же поиск живой задачи, та же запись, тот же журнал. Право `check:start`
     * у этого обработчика уже проверено рубежом выше.
     *
     * Ответ — страница ОБЪЕКТА, где виден идущий прогон, а не страница партий:
     * человек включил галочку, чтобы смотреть на прогон, а не на список файлов.
     */
    if (form.get("через-агентов") === "да" && saved.accepted.length > 0) {
      const поставлено = await startCheck({
        db,
        tenantId,
        objectId: object.id,
        objectCode,
        objectPath: saved.path,
        batch: saved.batch,
        workflowId: "full-check",
        mode: "codex",
        actorId: guard.viewer.actor.userId,
        now: new Date(),
      });

      const url = publicUrl(request, `/objects/${encodeURIComponent(objectCode)}`);
      url.searchParams.set("поставлено", поставлено);
      url.searchParams.set("партия", saved.batch);
      // Размер потери называется и здесь: файлы, которых не взяли, не должны
      // теряться из виду из-за того, что прогон уже пошёл.
      if (saved.rejected.length > 0) url.searchParams.set("не-взято", String(saved.rejected.length));

      return NextResponse.redirect(url, 303);
    }

    const url = publicUrl(request, `/objects/${encodeURIComponent(objectCode)}/upload`);

    // Отклонённые называются поимённо, но перечень ОГРАНИЧЕН: на 53 файлах он
    // перестал влезать в заголовок `Location`, и nginx отвечал 502 — при уже
    // сохранённых файлах (см. `итогЗагрузкиВАдрес`).
    итогЗагрузкиВАдрес(url, saved);

    return NextResponse.redirect(url, 303);
  } finally {
    await db.$disconnect();
  }
}
