/**
 * Выход. Сессия ОТЗЫВАЕТСЯ, а не удаляется: след входа остаётся в журнале.
 */
import { NextResponse } from "next/server";

import { createPrismaClient, withTenant } from "@platform/db/prisma";
import { recordAudit } from "@platform/security/audit";
import { revokeSession } from "@platform/security/session";

import { SESSION_COOKIE } from "@web/lib/actor";
import { publicUrl } from "@web/lib/public-url";

export async function POST(request: Request): Promise<Response> {
  const cookie = request.headers.get("cookie") ?? "";
  const raw = /(?:^|;\s*)si_session=([^;]+)/.exec(cookie)?.[1];
  const dot = raw?.indexOf(".") ?? -1;

  if (raw !== undefined && dot > 0) {
    // Арендатор из cookie: без него строка сессии закрыта политикой (ADR-R-015).
    const tenantId = raw.slice(0, dot);
    const token = raw.slice(dot + 1);
    const db = createPrismaClient(process.env["DATABASE_URL"]);

    try {
      await withTenant(db, tenantId, async (tx) => {
        const revoked = await revokeSession(tx, token, new Date());

        // Запись только о состоявшемся выходе: попытка выйти с недействительной
        // сессией событием не является.
        if (revoked) {
          await recordAudit(tx, tenantId, { action: "session.ended", resourceKind: "session" });
        }
      });
    } finally {
      await db.$disconnect();
    }
  }

  const response = NextResponse.redirect(publicUrl(request, "/login"), 303);
  response.cookies.delete(SESSION_COOKIE);

  return response;
}
