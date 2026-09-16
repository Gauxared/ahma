/**
 * Заведение объектов, пользователей и арендаторов — разбор входа и запись.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫМ МОДУЛЕМ, А НЕ В ОБРАБОТЧИКАХ
 *
 * Проверка шифра, адреса и пароля нужна ДВУМ потребителям: обработчику, который
 * записывает, и набору, который доказывает, что запись без проверки не проходит.
 * Проверка, живущая внутри обработчика, проверяется только через HTTP — то есть
 * медленно и на поднятом контуре, а значит проверяется редко.
 *
 * ПОЧЕМУ ПРИЧИНА ОТКАЗА — СЛОВАМИ ЧЕЛОВЕКА
 *
 * Формы заполняет администратор клиента на встрече, а не разработчик. «Шифр
 * занят» и «в шифре недопустимый знак» требуют разных действий, и ответ «неверные
 * данные» не позволяет выбрать ни одно из них.
 */
import argon2 from "argon2";

import type { Tx } from "@platform/db/prisma";

/** Разбор формы: либо значение, либо причина словами. */
export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

/**
 * Шифр объекта.
 *
 * Латиница, цифры, дефис и подчёркивание. Пробел и кириллица запрещены не из
 * вкуса: шифр попадает В АДРЕС (`/objects/KRG-1/...`), а адрес с кириллицей
 * приезжает как `%D0%9A...` — его нельзя ни прочитать в письме, ни продиктовать
 * по телефону. То же правило уже стоило одному набору получаса (грабля №6
 * передачи контекста).
 */
const CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$/;

export interface NewObject {
  readonly code: string;
  readonly name: string;
  readonly region: string | undefined;
}

export function parseObject(form: {
  readonly code: string;
  readonly name: string;
  readonly region: string;
}): Parsed<NewObject> {
  const code = form.code.trim();
  const name = form.name.trim();
  const region = form.region.trim();

  if (code === "") return { ok: false, reason: "шифр не указан" };

  if (!CODE.test(code)) {
    return {
      ok: false,
      reason:
        "шифр попадает в адрес объекта, поэтому в нём допустимы только латиница, цифры, дефис и подчёркивание — от двух до тридцати двух знаков",
    };
  }

  if (name === "") return { ok: false, reason: "имя объекта не указано" };
  if (name.length > 200) return { ok: false, reason: "имя объекта длиннее двухсот знаков" };

  return { ok: true, value: { code, name, region: region === "" ? undefined : region } };
}

/**
 * Адрес арендатора: латиница в нижнем регистре, цифры и дефис.
 *
 * Он набирается руками в форме входа, и набирается человеком, который его
 * впервые видит. Заглавные буквы и точки дают вход, который «не работает» при
 * верном пароле.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{1,31}$/;

/** Почта — грубо: собака, точка после неё, ни пробелов, ни запятых. */
const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

/**
 * Нижняя граница пароля.
 *
 * Восемь знаков — не «безопасно», а «не совсем открыто». Настоящая защита здесь
 * не в длине, а в том, что круг входов ограничен и известен поимённо: это не
 * публичный SaaS. Ставить двенадцать со спецзнаками значило бы получить пароль
 * на бумажке рядом с монитором.
 */
export const PASSWORD_MIN = 8;

export interface NewUser {
  readonly email: string;
  readonly displayName: string;
  readonly password: string;
  readonly roleIds: readonly string[];
}

export function parseUser(
  form: { readonly email: string; readonly name: string; readonly password: string; readonly role: string },
  knownRoles: readonly string[],
): Parsed<NewUser> {
  const email = form.email.trim().toLowerCase();
  const displayName = form.name.trim();
  const password = form.password;
  const role = form.role.trim();

  if (email === "") return { ok: false, reason: "адрес не указан" };
  if (!EMAIL.test(email)) return { ok: false, reason: "адрес не похож на почтовый" };
  if (displayName === "") return { ok: false, reason: "имя пользователя не указано" };

  if (password.length < PASSWORD_MIN) {
    return { ok: false, reason: `пароль короче ${PASSWORD_MIN} знаков` };
  }

  // Роль проверяется по реестру ролей, а не по списку в коде: роль, которой нет
  // в конфигурации, дала бы привязку без прав — вход, который входит и ничего
  // не может, причём молча.
  if (!knownRoles.includes(role)) {
    return { ok: false, reason: `роли «${role}» нет в конфигурации ролей` };
  }

  return { ok: true, value: { email, displayName, password, roleIds: [role] } };
}

export interface NewTenant {
  readonly slug: string;
  readonly displayName: string;
}

export function parseTenant(form: { readonly slug: string; readonly name: string }): Parsed<NewTenant> {
  const slug = form.slug.trim().toLowerCase();
  const displayName = form.name.trim();

  if (slug === "") return { ok: false, reason: "адрес организации не указан" };

  if (!SLUG.test(slug)) {
    return {
      ok: false,
      reason:
        "адрес организации набирают руками в форме входа, поэтому в нём допустимы только строчная латиница, цифры и дефис — от двух до тридцати двух знаков",
    };
  }

  if (displayName === "") return { ok: false, reason: "название организации не указано" };

  return { ok: true, value: { slug, displayName } };
}

/**
 * Запись пользователя с привязкой ролей — одной транзакцией.
 *
 * Пользователь без привязки — вход, который входит и не может ничего: он
 * выглядит заведённым и не работает. Поэтому создание и привязка неразделимы.
 */
export async function createUser(tx: Tx, tenantId: string, user: NewUser): Promise<string> {
  const passwordHash = await argon2.hash(user.password);

  const created = await tx.user.create({
    data: { tenantId, email: user.email, displayName: user.displayName, passwordHash },
  });

  for (const roleId of user.roleIds) {
    await tx.roleBinding.create({
      data: { tenantId, subjectKind: "user", subjectId: created.id, roleId },
    });
  }

  return created.id;
}
