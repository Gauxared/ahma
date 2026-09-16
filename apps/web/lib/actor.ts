/**
 * Кто обращается — из сессии, а не из окружения.
 *
 * ЧТО ЭТО ЗАМЕНЯЕТ
 *
 * Первая версия просмотра брала арендатора из `STROYINTELLECT_TENANT_ID` и
 * честно называла это заглушкой. Заглушка годилась, пока веб ничего не решал;
 * с появлением журнала, доступного только администратору (§4), решать
 * приходится — и брать личность из окружения значит выдать всем одну.
 *
 * АРЕНДАТОР ПРИХОДИТ ИЗ СЕССИИ, А НЕ ИЗ ЗАПРОСА
 *
 * Ни строка запроса, ни заголовок, ни тело формы не участвуют. Всё, что прислал
 * клиент, — это токен; арендатор и пользователь берутся из строки сессии в
 * базе. Иначе «арендатор» становится параметром, который клиент подставляет
 * сам, а разграничение — украшением.
 *
 * РОЛИ РАЗРЕШАЮТСЯ ЧЕРЕЗ PolicyDecisionPoint
 *
 * ADR-R-016 запрещает `if (role === "admin")` по коду. Здесь собирается
 * `Actor`, а решение принимает точка политики.
 */
import { cookies } from "next/headers";

import { createPrismaClient, withTenant } from "@platform/db/prisma";
import { loadAllRoles } from "@platform/config/roles";
import { PolicyDecisionPoint } from "@platform/security/policy-decision-point";
import type { Actor, Decision, RoleBinding } from "@platform/security/policy-decision-point";
import { verifySession } from "@platform/security/session";

export const SESSION_COOKIE = "si_session";

/**
 * Значение cookie — `<арендатор>.<токен>`.
 *
 * ЗАЧЕМ АРЕНДАТОР В COOKIE
 *
 * Строка сессии закрыта политикой RLS: найти её без установленного контекста
 * нельзя (ADR-R-015). А контекст как раз и хранится в этой строке — замкнутый
 * круг, который первая версия не заметила, потому что проверяла всё под ролью
 * платформы.
 *
 * Разрывается он тем, что арендатор едет рядом с токеном. Это ПОДСКАЗКА ДЛЯ
 * ПОИСКА, а не право: подделав её, атакующий заставит систему искать хэш своего
 * токена в чужом арендаторе — и не найти. Доступ по-прежнему держится только на
 * совпадении хэша внутри этого арендатора.
 *
 * Одна cookie, а не две: тогда арендатор и токен нельзя рассогласовать, подменив
 * что-то одно.
 */
export function packCookie(tenantId: string, token: string): string {
  return `${tenantId}.${token}`;
}

function unpackCookie(value: string): { tenantId: string; token: string } | undefined {
  const dot = value.indexOf(".");
  if (dot <= 0 || dot === value.length - 1) return undefined;

  return { tenantId: value.slice(0, dot), token: value.slice(dot + 1) };
}

export interface Viewer {
  readonly actor: Actor;
  readonly displayName: string;
  /**
   * Как организация называется, а не как она пронумерована.
   *
   * `actor.tenantId` — UUID, и в шапке каркаса он показывал
   * `11111111-1111-…`: строку, которая не отвечает ни на один вопрос
   * пользователя. При этом вопрос «в какой я организации» в системе с
   * разграничением арендаторов — не праздный.
   */
  readonly tenantSlug: string;
  /**
   * Как организация НАЗЫВАЕТСЯ для человека — «ПАО «АПРИ»», а не `apri`.
   *
   * Slug остаётся: его набирают на входе, и он же опознаёт арендатора в
   * поддомене рабочего контура. Но в шапке каркаса нужен не идентификатор, а
   * название: на демонстрации `demo` под знаком продукта отвечает не на тот
   * вопрос, который задают.
   */
  readonly tenantName: string;
  readonly roleIds: readonly string[];
  can(permission: string, resource?: { kind: string; id: string }): Decision;
}

export type ViewerResult =
  | { readonly kind: "гость"; readonly reason: string }
  | { readonly kind: "вошёл"; readonly viewer: Viewer };

/**
 * Текущий посетитель.
 *
 * Отсутствие сессии — не ошибка, а положение дел: страница входа тоже кем-то
 * открывается. Поэтому возвращается «гость» с причиной, а не исключение.
 */
export async function currentViewer(now = new Date()): Promise<ViewerResult> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;

  if (raw === undefined || raw === "") {
    return { kind: "гость", reason: "сессия отсутствует: требуется вход" };
  }

  const parsed = unpackCookie(raw);

  if (parsed === undefined) {
    return { kind: "гость", reason: "сессия не читается: требуется повторный вход" };
  }

  const { tenantId, token } = parsed;
  const db = createPrismaClient(process.env["DATABASE_URL"]);

  try {
    // Весь дальнейший доступ идёт под арендатором из cookie. Если он подделан,
    // хэш токена в этом арендаторе не найдётся — и это единственное, что
    // подделка даёт.
    return await withTenant(db, tenantId, async (tx) => {
      const check = await verifySession(tx, token, now);

      if (!check.valid) {
        return { kind: "гость", reason: `сессия недействительна: ${check.reason}` };
      }

      const user = await tx.user.findUnique({ where: { id: check.userId } });

      if (user === null || user.disabledAt !== null) {
        // Отключённый пользователь с живой сессией — обычная забывчивость
        // администратора; вход обязан прекратиться сразу, а не по истечении.
        return { kind: "гость", reason: "учётная запись отключена" };
      }

      const memberships = await tx.membership.findMany({
        where: { userId: user.id },
        select: { groupId: true },
      });

      const bindings = await tx.roleBinding.findMany({ where: { tenantId: check.tenantId } });
      const tenant = await tx.tenant.findUnique({ where: { id: check.tenantId }, select: { slug: true, displayName: true } });

      const actor: Actor = {
        userId: user.id,
        tenantId: check.tenantId,
        groupIds: memberships.map((membership) => membership.groupId),
      };

      // ВСЕ роли, а не только договорные: к служебной роли оператора кто-то
      // привязан, и решение о доступе обязано о ней знать. Иначе привязка
      // существует, а прав не даёт — вход, который входит и ничего не может.
      const roles = loadAllRoles();
      const pdp = new PolicyDecisionPoint(
        roles,
        bindings.map(
          (binding): RoleBinding => ({
            tenantId: binding.tenantId,
            subject: { kind: binding.subjectKind, id: binding.subjectId },
            roleId: binding.roleId,
          }),
        ),
      );

      const own = bindings.filter(
        (binding) =>
          (binding.subjectKind === "user" && binding.subjectId === user.id) ||
          (binding.subjectKind === "group" && actor.groupIds.includes(binding.subjectId)),
      );

      return {
        kind: "вошёл",
        viewer: {
          actor,
          displayName: user.displayName,
          // Строка сессии закрыта политикой того же арендатора, поэтому запись
          // арендатора здесь обязана найтись. Если её нет — показываем UUID, а
          // не бросаем: имя организации это подпись, а не право.
          tenantSlug: tenant?.slug ?? check.tenantId,
          tenantName: tenant?.displayName ?? tenant?.slug ?? check.tenantId,
          roleIds: [...new Set(own.map((binding) => binding.roleId))],
          can: (permission, resource) =>
            pdp.decide(actor, permission, {
              tenantId: check.tenantId,
              kind: resource?.kind ?? "tenant",
              id: resource?.id ?? check.tenantId,
            }),
        },
      };
    });
  } finally {
    await db.$disconnect();
  }
}
