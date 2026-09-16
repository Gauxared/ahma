/**
 * Заведение организации-клиента вместе с её первым администратором.
 *
 * ЭТО ЕДИНСТВЕННОЕ ДЕЙСТВИЕ, ПЕРЕСЕКАЮЩЕЕ ГРАНИЦУ АРЕНДАТОРА, И ПОТОМУ ОНО
 * УСТРОЕНО УЖЕ, ЧЕМ ОСТАЛЬНЫЕ
 *
 * Изоляция арендаторов — главное свойство безопасности продукта: два рубежа,
 * RLS на уровне строк, гейт на прямое обращение по чужому шифру. Любая
 * возможность действовать поперёк неё ослабляет её ровно настолько, насколько
 * широка.
 *
 * Поэтому здесь три ограничения, и каждое сознательное:
 *
 * 1. **Право отдельное** — `tenant:manage`, и оно есть только у роли
 *    `operator`. У администратора клиента его нет: он управляет людьми своей
 *    организации, а не чужими организациями.
 * 2. **Только запись.** Ни перечня арендаторов, ни поиска по ним, ни счётчиков.
 *    Перечень — это чтение поперёк изоляции, и сценарию встречи оно не нужно:
 *    оператор заводит клиента, которого только что видел.
 * 3. **Ровно одна операция** — создать организацию и её первого
 *    администратора. Ни правки, ни удаления, ни второго пользователя: для
 *    второго у организации уже есть свой администратор и свой экран.
 *
 * ПОЧЕМУ ОРГАНИЗАЦИЯ И ЧЕЛОВЕК ЗАВОДЯТСЯ ВМЕСТЕ
 *
 * Организация без единого входа недостижима: в неё нельзя войти, чтобы завести
 * в неё людей. Разделить эти два шага значит получить состояние, из которого
 * нет выхода иначе как через консоль, — то есть вернуть ровно ту проблему,
 * ради которой этот экран заведён.
 */
import { NextResponse } from "next/server";

import { loadRoles } from "@platform/config/roles";
import { createPrismaClient, withTenant } from "@platform/db/prisma";
import { recordAudit } from "@platform/security/audit";

import { createUser, parseTenant, parseUser } from "@web/lib/access";
import { guardMutation } from "@web/lib/mutation";
import { publicUrl } from "@web/lib/public-url";

function back(request: Request, params: Record<string, string>): Response {
  const url = publicUrl(request, "/access");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const slug = String(form.get("организация") ?? "").trim();

  const guard = await guardMutation(request, "tenant:manage", {
    action: "tenant.created",
    resourceKind: "tenant",
    ...(slug === "" ? {} : { resourceId: slug }),
  });

  if (!guard.ok) return guard.response;

  const tenant = parseTenant({ slug, name: String(form.get("название") ?? "") });
  if (!tenant.ok) return back(request, { отказ: tenant.reason });

  const knownRoles = loadRoles().bundle.roles.map((role) => role.id);

  const admin = parseUser(
    {
      email: String(form.get("адрес") ?? ""),
      name: String(form.get("имя") ?? ""),
      password: String(form.get("пароль") ?? ""),
      // Первый вход организации — администратор: иначе в ней некому завести
      // остальных, и она снова недостижима без консоли.
      role: "admin",
    },
    knownRoles,
  );

  if (!admin.ok) return back(request, { отказ: admin.reason });

  const db = createPrismaClient(process.env["DATABASE_URL"]);

  try {
    const taken = await db.tenant.findUnique({ where: { slug: tenant.value.slug }, select: { id: true } });

    if (taken !== null) {
      return back(request, { отказ: `организация с адресом «${tenant.value.slug}» уже заведена` });
    }

    const created = await db.tenant.create({
      data: { slug: tenant.value.slug, displayName: tenant.value.displayName },
    });

    /**
     * Пользователь заводится В КОНТЕКСТЕ НОВОГО арендатора.
     *
     * Не того, под которым вошёл оператор. Записать строку под своим
     * арендатором и потом «перевесить» её значило бы на мгновение завести
     * чужого человека внутрь своей организации — а RLS именно это и обязана
     * делать невозможным.
     */
    await withTenant(db, created.id, async (tx) => {
      await createUser(tx, created.id, admin.value);
      // Запись в журнал НОВОГО арендатора: событие относится к нему, и искать
      // его будут там. След в журнале оператора при этом остаётся — его пишет
      // `guardMutation` до действия.
      await recordAudit(tx, created.id, {
        action: "tenant.created",
        resourceKind: "tenant",
        resourceId: created.id,
      });
    });

    await guard.audit("tenant.created", { kind: "tenant", id: tenant.value.slug });

    return back(request, { заведён: admin.value.email, организация: tenant.value.slug });
  } finally {
    await db.$disconnect();
  }
}
