/**
 * Заведение пользователя в СВОЁМ арендаторе — «вот вам ограниченный доступ».
 *
 * ЧЕМ ЭТО ЗАКАНЧИВАЕТ СЦЕНАРИЙ
 *
 * Встреча кончается фразой «вот ссылка, вот доступ». До этого обработчика она
 * означала `ssh` на сервер и запуск скрипта наполнения — то есть обещание,
 * которое выполняется завтра.
 *
 * ПОЧЕМУ ТОЛЬКО В СВОЙ АРЕНДАТОР
 *
 * `user:manage` даёт власть над людьми СВОЕЙ организации. Возможность завести
 * пользователя в чужой — это уже пересечение изоляции, то есть ровно то
 * свойство, ради которого в системе два рубежа доступа и RLS. Заведение чужого
 * арендатора живёт отдельно и требует отдельного права (`/api/tenants`).
 *
 * ПАРОЛЬ ПРИДУМЫВАЕТ ЧЕЛОВЕК, А НЕ СИСТЕМА
 *
 * Сгенерированный пароль надо где-то показать, а показанный на экране пароль
 * попадает в снимок экрана, в историю браузера и в чужую память. Здесь его
 * вводят и произносят вслух собеседнику — он и так предназначен одному
 * человеку на одной встрече.
 */
import { NextResponse } from "next/server";

import { loadRoles } from "@platform/config/roles";
import { createPrismaClient, withTenant } from "@platform/db/prisma";

import { createUser, parseUser } from "@web/lib/access";
import { guardMutation } from "@web/lib/mutation";
import { publicUrl } from "@web/lib/public-url";

function back(request: Request, params: Record<string, string>): Response {
  const url = publicUrl(request, "/access");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const email = String(form.get("адрес") ?? "").trim();

  const guard = await guardMutation(request, "user:manage", {
    action: "user.created",
    resourceKind: "user",
    ...(email === "" ? {} : { resourceId: email }),
  });

  if (!guard.ok) return guard.response;

  // Роли берутся ИЗ КОНФИГУРАЦИИ, а не из списка в коде: у другого клиента роли
  // другие (`ADR-R-016`), и литеральный перечень здесь дал бы форму, которая
  // предлагает несуществующее.
  const knownRoles = loadRoles().bundle.roles.map((role) => role.id);

  const parsed = parseUser(
    {
      email,
      name: String(form.get("имя") ?? ""),
      password: String(form.get("пароль") ?? ""),
      role: String(form.get("роль") ?? ""),
    },
    knownRoles,
  );

  if (!parsed.ok) return back(request, { отказ: parsed.reason });

  const tenantId = guard.viewer.actor.tenantId;
  const db = createPrismaClient(process.env["DATABASE_URL"]);

  try {
    const outcome = await withTenant(db, tenantId, async (tx) => {
      const taken = await tx.user.findFirst({ where: { email: parsed.value.email }, select: { id: true } });
      if (taken !== null) return { ok: false as const };

      const id = await createUser(tx, tenantId, parsed.value);
      return { ok: true as const, id };
    });

    if (!outcome.ok) {
      return back(request, { отказ: `вход с адресом «${parsed.value.email}» в организации уже есть` });
    }

    await guard.audit("user.created", { kind: "user", id: outcome.id });

    return back(request, {
      заведён: parsed.value.email,
      организация: guard.viewer.tenantSlug,
    });
  } finally {
    await db.$disconnect();
  }
}
