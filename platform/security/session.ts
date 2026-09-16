/**
 * Сессии пользователей — M6, ТЗ §4.
 *
 * ТОКЕН ХРАНИТСЯ ХЭШЕМ, А НЕ ТЕКСТОМ
 *
 * Дамп базы — обычное дело: резервная копия, выгрузка для отладки, доступ
 * администратора БД. Токен в открытом виде превращает любую такую копию в
 * связку ключей от всех живых сессий, и воспользоваться ими можно, не оставив
 * следа входа. Хэш этого не даёт: по нему сессию находят, но не подделывают.
 *
 * ПАРОЛЬ И ТОКЕН ХЭШИРУЮТСЯ ПО-РАЗНОМУ, И ЭТО НЕ НЕПОСЛЕДОВАТЕЛЬНОСТЬ
 *
 * Пароль — argon2: он выбран человеком, короток и угадываем, поэтому проверка
 * обязана быть МЕДЛЕННОЙ. Токен — 256 случайных бит: перебирать его бессмысленно
 * при любой скорости хэша, а вот проверять его надо на каждом запросе, и argon2
 * там превратился бы в отказ в обслуживании собственными руками.
 *
 * СРАВНЕНИЕ ХЭША ИДЁТ ПО ИНДЕКСУ, А НЕ ПОБАЙТОВО В КОДЕ
 *
 * Утечка по времени сравнения здесь неопасна: сравнивается не секрет с
 * секретом, а хэш присланного токена с хранимым. Узнав время, атакующий узнаёт
 * лишь то, есть ли такая сессия, — а это он и так узнаёт из ответа.
 *
 * ИСТЁКШАЯ И ОТОЗВАННАЯ СЕССИИ — РАЗНЫЕ ПОЛОЖЕНИЯ ДЕЛ
 *
 * Первое — время вышло, второе — решение человека («выйти со всех устройств»).
 * Свести их к одному «недействительна» значит потерять возможность ответить,
 * почему пользователя выкинуло.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { Tx } from "@platform/db/prisma.js";

/** 256 бит: перебор бессмыслен при любой скорости проверки. */
const TOKEN_BYTES = 32;

/** Срок жизни сессии по умолчанию. Продление — отдельное решение, не побочный эффект чтения. */
export const SESSION_TTL_HOURS = 12;

export interface IssuedSession {
  /** Отдаётся клиенту ОДИН раз. В базе его нет — только хэш. */
  readonly token: string;
  readonly id: string;
  readonly expiresAt: Date;
}

export type SessionCheck =
  | { readonly valid: true; readonly userId: string; readonly tenantId: string; readonly sessionId: string }
  | { readonly valid: false; readonly reason: "не найдена" | "истекла" | "отозвана" };

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Постоянное по времени сравнение хэшей.
 *
 * Здесь оно не обязательно (см. шапку), но и не мешает: функция существует,
 * чтобы её использовали там, где сравнивают секрет с секретом.
 */
export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");

  return left.length === right.length && timingSafeEqual(left, right);
}

export async function issueSession(
  tx: Tx,
  input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly now: Date;
    readonly ttlHours?: number;
    readonly userAgent?: string;
    readonly ip?: string;
  },
): Promise<IssuedSession> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(
    input.now.getTime() + (input.ttlHours ?? SESSION_TTL_HOURS) * 3_600_000,
  );

  const created = await tx.session.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId,
      tokenHash: hashToken(token),
      createdAt: input.now,
      expiresAt,
      ...(input.userAgent === undefined ? {} : { userAgent: input.userAgent }),
      ...(input.ip === undefined ? {} : { ip: input.ip }),
    },
  });

  return { token, id: created.id, expiresAt };
}

/**
 * Проверяет токен.
 *
 * Срок проверяется ЗДЕСЬ, а не полагается на уборку просроченных: уборка может
 * отстать, а сессия, пережившая свой срок из-за нерасторопного обслуживания, —
 * это сессия без срока.
 */
export async function verifySession(tx: Tx, token: string, now: Date): Promise<SessionCheck> {
  const session = await tx.session.findUnique({ where: { tokenHash: hashToken(token) } });

  if (session === null) {
    return { valid: false, reason: "не найдена" };
  }

  if (session.revokedAt !== null) {
    return { valid: false, reason: "отозвана" };
  }

  if (session.expiresAt.getTime() <= now.getTime()) {
    return { valid: false, reason: "истекла" };
  }

  return {
    valid: true,
    userId: session.userId,
    tenantId: session.tenantId,
    sessionId: session.id,
  };
}

/** Выход: сессия отзывается, но не удаляется — след входа остаётся. */
export async function revokeSession(tx: Tx, token: string, now: Date): Promise<boolean> {
  const result = await tx.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: now },
  });

  return result.count > 0;
}

/** Выход со всех устройств. */
export async function revokeAllForUser(tx: Tx, userId: string, now: Date): Promise<number> {
  const result = await tx.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });

  return result.count;
}
