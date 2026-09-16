/**
 * Постановка проверки в очередь — §5.6.
 *
 * ЗАПРОС НЕ ЖДЁТ РЕЗУЛЬТАТА
 *
 * §5.6: «интерфейс не блокирует пользователя на время расчёта». Обработчик
 * ставит задачу и сразу возвращается; проверку выполняет воркер, а пользователь
 * видит её состояние на карточке объекта.
 *
 * ПРАВО ПРОВЕРЯЕТСЯ ДО ПОСТАНОВКИ, А НЕ ПРИ ЧТЕНИИ РЕЗУЛЬТАТА
 *
 * Иначе задача уже занята внешним контуром, а отказ приходит потом.
 *
 * ЧТО ТАКОЕ ПОВТОР
 *
 * Опасность — не «объект проверяли сегодня», а «одна и та же работа делается
 * дважды ОДНОВРЕМЕННО»: двойное нажатие, обновление страницы, нетерпеливый
 * пользователь. Поэтому повтором считается ЖИВАЯ задача по этому объекту —
 * стоящая в очереди или выполняющаяся — того же воркфлоу и режима.
 *
 * Завершённая проверка новую не запрещает. Документы поправили, объект надо
 * перепроверить — это обычный рабочий ход, а не ошибка.
 *
 * ДВЕ ВЕРСИИ ДО ЭТОЙ БЫЛИ НЕВЕРНЫ, И ОБЕ ПО-СВОЕМУ
 *
 * Первая заводила строку проверки, а потом ставила задачу: на повторном нажатии
 * идемпотентность возвращала прежнюю задачу, оставляя НОВУЮ проверку без задачи
 * вовсе. На экране — «проверка есть, задача не поставлена»: осиротевшая запись,
 * которая никогда не выполнится.
 *
 * Вторая брала ключ из объекта и ДНЯ. Она чинила осиротевшую запись и вводила
 * худшее: раз проверив объект, повторить его в тот же день становилось нельзя
 * вовсе, причём с ответом «повтор» — то есть система отказывала и объясняла
 * отказ неправдой.
 *
 * САМА ПОСТАНОВКА ЖИВЁТ В `@web/lib/start-check` — ею же пользуется загрузка с
 * галочкой «сразу через агентов» (spec-demo-stage-1 А2). Здесь остаётся разбор
 * формы, рубежи и ответ.
 */
import { NextResponse } from "next/server";

import { createPrismaClient, withTenant } from "@platform/db/prisma";

import { guardMutation } from "@web/lib/mutation";
import { publicUrl } from "@web/lib/public-url";
import { startCheck, режимПрогона } from "@web/lib/start-check";
import { batchExists } from "@web/lib/uploads";

export async function POST(request: Request): Promise<Response> {
  // Форма читается ДО рубежей: попытка без предмета — строка в журнале, по
  // которой не понять, к чему она относилась.
  const form = await request.formData();
  const objectCode = String(form.get("objectCode") ?? "").trim();
  // Партия, а не путь.
  //
  // Здесь стояло поле `objectPath` — путь к каталогу на сервере, набранный в
  // браузере. Ядро читало этот каталог `readdir`, то есть браузер выбирал, какую
  // папку файловой системы прочитать серверу. Теперь приходит ИМЯ партии, а путь
  // считается по арендатору из сессии и проверяется на существование.
  const batch = String(form.get("партия") ?? "").trim();
  /**
   * ВИД ПРОГОНА — СЛОВОМ ФОРМЫ, а не набором флагов.
   *
   * `быстрый` — второй воркфлоу (`estimate-only`, Д2): один агент по сметам,
   * пять-семь минут, объявленное сужение. `агентный` — собственный цикл с
   * инструментами (Т9.1). `агенты` — экипаж на Codex SDK (spec-demo-stage-1).
   * У трёх последних воркфлоу один — `full-check`: состав ролей не меняется,
   * меняется исполнитель; завести каждому свой воркфлоу значило бы завести
   * вторую истину о составе конвейера.
   */
  const { workflowId, mode } = режимПрогона(String(form.get("режим") ?? ""));

  const guard = await guardMutation(request, "check:start", {
    action: "check.started",
    resourceKind: "object",
    ...(objectCode === "" ? {} : { resourceId: objectCode }),
  });

  if (!guard.ok) return guard.response;

  if (objectCode === "" || batch === "") {
    return NextResponse.json({ error: "не указан объект или партия загрузки" }, { status: 400 });
  }

  const tenantId = guard.viewer.actor.tenantId;
  const db = createPrismaClient(process.env["DATABASE_URL"]);

  try {
    const object = await withTenant(db, tenantId, (tx) =>
      tx.projectObject.findFirst({ where: { code: objectCode } }),
    );

    if (object === null) {
      return NextResponse.json({ error: "объект не найден" }, { status: 404 });
    }

    // Путь СЧИТАЕТСЯ и сверяется, а не принимается. Партия чужого арендатора
    // здесь не найдётся: её каталог лежит под другим первым сегментом.
    const objectPath = await batchExists(tenantId, objectCode, batch);

    if (objectPath === undefined) {
      return NextResponse.json(
        { error: `партия ${batch} по объекту ${objectCode} не найдена` },
        { status: 404 },
      );
    }

    const поставлено = await startCheck({
      db,
      tenantId,
      objectId: object.id,
      objectCode,
      objectPath,
      batch,
      workflowId,
      mode,
      actorId: guard.viewer.actor.userId,
      now: new Date(),
    });

    const url = publicUrl(request, `/objects/${encodeURIComponent(objectCode)}`);
    url.searchParams.set("поставлено", поставлено);

    return NextResponse.redirect(url, 303);
  } finally {
    await db.$disconnect();
  }
}
