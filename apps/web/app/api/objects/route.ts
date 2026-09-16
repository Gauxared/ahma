/**
 * Заведение объекта — первый шаг тракта, которого в интерфейсе не было.
 *
 * ЧЕГО НЕ ХВАТАЛО
 *
 * Объекты появлялись только наполнением контура (`tooling/demo-up.ts`). На
 * встрече это означает, что тракт начинается со ВТОРОГО шага: клиент даёт
 * материалы, а положить их некуда, пока кто-то не сходит в консоль сервера.
 *
 * ПРАВО — ТО ЖЕ, ЧТО У ЗАПУСКА ПРОВЕРКИ
 *
 * Заведение объекта не отдельная власть: тот, кто может поставить прогон и
 * загрузить документы, может и завести объект, для которого это делает. Вводить
 * ради него четвёртое право значило бы дробить роль там, где она цельная.
 *
 * КУДА ВЕДЁТ УСПЕХ
 *
 * На загрузку документов этого объекта, а не в реестр. Объект без файлов —
 * пустая карточка, и следующий шаг тракта известен заранее; возвращать человека
 * в список значило бы заставить его искать то, что он только что создал.
 */
import { NextResponse } from "next/server";

import { createPrismaClient, withTenant } from "@platform/db/prisma";

import { parseObject } from "@web/lib/access";
import { guardMutation } from "@web/lib/mutation";
import { publicUrl } from "@web/lib/public-url";

/** Возврат в реестр с причиной отказа. Отказ без причины человек не исправит. */
function refuse(request: Request, reason: string): Response {
  const url = publicUrl(request, "/objects");
  url.searchParams.set("отказ", reason);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const code = String(form.get("шифр") ?? "");

  const guard = await guardMutation(request, "check:start", {
    action: "object.created",
    resourceKind: "object",
    ...(code.trim() === "" ? {} : { resourceId: code.trim() }),
  });

  if (!guard.ok) return guard.response;

  const parsed = parseObject({
    code,
    name: String(form.get("имя") ?? ""),
    region: String(form.get("регион") ?? ""),
  });

  if (!parsed.ok) return refuse(request, parsed.reason);

  const tenantId = guard.viewer.actor.tenantId;
  const db = createPrismaClient(process.env["DATABASE_URL"]);

  try {
    const outcome = await withTenant(db, tenantId, async (tx) => {
      // Занятость шифра проверяется ЯВНО, а не ловится нарушением ограничения:
      // сообщение базы («Unique constraint failed on the fields: (tenantId,
      // code)») в форме читается как поломка, а это обычный рабочий случай —
      // объект с таким шифром уже завели.
      const taken = await tx.projectObject.findFirst({
        where: { code: parsed.value.code },
        select: { id: true },
      });

      if (taken !== null) return { ok: false as const };

      await tx.projectObject.create({
        data: {
          tenantId,
          code: parsed.value.code,
          name: parsed.value.name,
          ...(parsed.value.region === undefined ? {} : { region: parsed.value.region }),
        },
      });

      return { ok: true as const };
    });

    if (!outcome.ok) {
      return refuse(request, `объект с шифром «${parsed.value.code}» у организации уже есть`);
    }

    await guard.audit("object.created", { kind: "object", id: parsed.value.code });

    return NextResponse.redirect(
      publicUrl(request, `/objects/${encodeURIComponent(parsed.value.code)}/upload`),
      303,
    );
  } finally {
    await db.$disconnect();
  }
}
