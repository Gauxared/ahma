/**
 * Общая обвязка мутаций из веба.
 *
 * ПОЧЕМУ ОДНА, А НЕ ПО ОБРАБОТЧИКУ
 *
 * Каждая мутация обязана пройти четыре рубежа: источник запроса, личность,
 * право и запись в аудит. Пока рубежи расставляются вручную в каждом
 * обработчике, забыть один — вопрос времени, и забудется он молча: маршрут
 * продолжит работать, просто без проверки. Здесь пропустить рубеж нельзя —
 * обработчик получает управление только после всех четырёх.
 *
 * АУДИТ ПИШЕТСЯ ДО ДЕЙСТВИЯ, А НЕ ПОСЛЕ
 *
 * Запись «попытка» ставится прежде выполнения, потому что интересен и тот
 * случай, когда действие не удалось: отказ, о котором нет следа, неотличим от
 * того, что никто не приходил. Итог дописывается отдельной записью.
 *
 * CSRF — ПРОВЕРКА ИСТОЧНИКА, А НЕ ТОКЕН В ФОРМЕ
 *
 * Токен в скрытом поле требует хранить его до отправки, то есть заводить сессию
 * тому, кто ещё не вошёл. `Origin` и `Referer` браузер проставляет сам, со
 * стороннего сайта их не подделать, а отсутствие обоих — уже повод для отказа.
 */
import { NextResponse } from "next/server";

import { createPrismaClient, withTenant } from "@platform/db/prisma";
import { recordAudit, type AuditAction } from "@platform/security/audit";

import { currentViewer, type Viewer } from "./actor.js";
// Адрес системы уже умеет считать `public-url`; вторая реализация того же —
// второй способ ошибиться в разборе заголовков за прокси.
import { publicUrl } from "./public-url.js";

/**
 * Источник запроса совпадает с адресом системы.
 *
 * Вынесено из `guardMutation` наружу, потому что понадобилось второму
 * обработчику — переключателю рельса. Он не мутация данных и `guardMutation`
 * ему не нужен, а проверка источника нужна: запрос не из браузера здесь
 * бессмыслен.
 *
 * Своя копия проверки в том обработчике уже была написана — и была НЕВЕРНОЙ:
 * она сравнивала `Origin` с `new URL(request.url).origin`, а за сервером
 * разработки эти два значения не совпадают. Обработчик возвращал 403 на честный
 * запрос из формы. Копия проверки безопасности — тот случай, где вторая
 * реализация хуже отсутствия второй реализации.
 */
export function originAllowed(request: Request): boolean {
  const host = request.headers.get("host");
  if (host === null) return false;

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const source = origin ?? referer;

  // Отсутствие обоих заголовков — не «нейтральный» случай: браузер их
  // проставляет, а значит запрос пришёл не из браузера пользователя.
  if (source === null) return false;

  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}

export interface Allowed {
  readonly ok: true;
  readonly viewer: Viewer;
  /** Дописать итог действия в журнал. */
  readonly audit: (action: AuditAction, resource: { kind: string; id?: string }) => Promise<void>;
}

export interface Refused {
  readonly ok: false;
  readonly response: Response;
}

/**
 * Пропускает мутацию, только если пройдены все четыре рубежа.
 *
 * `attempt` — действие, которое записывается в журнал ДО выполнения.
 */
export async function guardMutation(
  request: Request,
  permission: string,
  attempt: { readonly action: AuditAction; readonly resourceKind: string; readonly resourceId?: string },
): Promise<Allowed | Refused> {
  if (!originAllowed(request)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "источник запроса не совпадает с адресом системы" }, { status: 403 }),
    };
  }

  const result = await currentViewer();

  if (result.kind === "гость") {
    return { ok: false, response: NextResponse.redirect(publicUrl(request, "/login"), 303) };
  }

  const decision = result.viewer.can(permission);

  if (!decision.allowed) {
    return {
      ok: false,
      response: NextResponse.json({ error: `доступ закрыт: ${decision.reason}` }, { status: 403 }),
    };
  }

  const tenantId = result.viewer.actor.tenantId;
  const actorId = result.viewer.actor.userId;

  const write = async (action: AuditAction, resource: { kind: string; id?: string }): Promise<void> => {
    const db = createPrismaClient(process.env["DATABASE_URL"]);
    try {
      await withTenant(db, tenantId, (tx) =>
        recordAudit(tx, tenantId, {
          action,
          resourceKind: resource.kind,
          actorId,
          ...(resource.id === undefined ? {} : { resourceId: resource.id }),
        }),
      );
    } finally {
      await db.$disconnect();
    }
  };

  await write(attempt.action, {
    kind: attempt.resourceKind,
    ...(attempt.resourceId === undefined ? {} : { id: attempt.resourceId }),
  });

  return { ok: true, viewer: result.viewer, audit: write };
}
