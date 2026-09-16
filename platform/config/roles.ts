/**
 * Роли клиента как конфигурация — ADR-R-016, ADR-R-014.
 *
 * Дословно ADR-R-016: «группы и роли задаются конфигурацией и CLI». Литеральный
 * список ролей в коде запрещён тем же правилом, что и литеральный ростер
 * агентов: у другого клиента роли другие, и разница обязана быть настройкой, а
 * не веткой в коде.
 *
 * НАСЛЕДОВАНИЕ ЯВНОЕ, А НЕ ПОРЯДКОМ В МАССИВЕ
 *
 * ТЗ §4 определяет администратора как «то же плюс управление пользователями…».
 * Перечислить его права заново значило бы завести второй список, который
 * разойдётся с первым при первой же правке — и разойдётся молча, потому что
 * оба останутся валидными.
 *
 * ЦИКЛ НАСЛЕДОВАНИЯ — ОШИБКА КОНФИГУРАЦИИ, А НЕ ЗАВИСАНИЕ
 *
 * Роль, наследующая саму себя через цепочку, при наивном разворачивании даёт
 * бесконечный цикл при СТАРТЕ — то есть падение без объяснения. Проверяется
 * явно, с указанием цепочки.
 */
import { join } from "node:path";

import { z } from "zod";

import type { Role } from "@platform/security/policy-decision-point.js";

import { loadBundle } from "./bundle-loader.js";

export const roleSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** Идентификатор роли, права которой включаются целиком. */
  inherits: z.string().min(1).optional(),
  permissions: z.array(z.string().min(1)).min(1),
});

export const roleBundleSchema = z.object({
  customer: z.string().min(1),
  /** Пункт ТЗ, которым роли заданы. Роль без основания — право без владельца. */
  clause: z.string().regex(/§/, "набор ролей обязан ссылаться на пункт ТЗ"),
  roles: z.array(roleSchema).min(1),
});

export type RoleDefinition = z.infer<typeof roleSchema>;
export type RoleBundle = z.infer<typeof roleBundleSchema>;

/**
 * Разворачивает наследование в плоские наборы прав.
 *
 * `PolicyDecisionPoint` про наследование не знает и знать не должен: его дело —
 * решение по факту наличия права, а не разбор того, откуда право взялось.
 */
export function expandRoles(bundle: RoleBundle): readonly Role[] {
  const byId = new Map<string, RoleDefinition>();

  for (const role of bundle.roles) {
    if (byId.has(role.id)) {
      throw new Error(`Роль объявлена дважды: ${role.id}`);
    }
    byId.set(role.id, role);
  }

  const resolve = (id: string, chain: readonly string[]): readonly string[] => {
    if (chain.includes(id)) {
      throw new Error(`Цикл наследования ролей: ${[...chain, id].join(" → ")}`);
    }

    const role = byId.get(id);
    if (role === undefined) {
      throw new Error(`Роль ${id} наследует несуществующую роль`);
    }

    const inherited =
      role.inherits === undefined ? [] : resolve(role.inherits, [...chain, id]);

    return [...new Set([...inherited, ...role.permissions])];
  };

  return bundle.roles.map((role) => ({ id: role.id, permissions: resolve(role.id, []) }));
}

export const ROLES_PATH = join("config", "roles", "apri.json");

/**
 * СЛУЖЕБНЫЕ РОЛИ ЛЕЖАТ ОТДЕЛЬНО ОТ ДОГОВОРНЫХ, И ЭТО НЕ АККУРАТНОСТЬ.
 *
 * ТЗ §4 даёт АПРИ ровно две роли, и это сторожит гейт: появление третьей —
 * изменение договора, о котором набор обязан сообщить. Роль оператора системы
 * договором клиента не задана — она наша, и нужна ровно для одного действия:
 * завести организацию-клиента с её первым администратором.
 *
 * Положить её в клиентский набор значило бы объявить клиенту роль, которой у
 * него нет, и заодно погасить гейт, стерегущий состав договорных ролей. Ровно
 * это и произошло при первой попытке — гейт справедливо покраснел.
 */
export const SERVICE_ROLES_PATH = join("config", "roles", "service.json");

export function loadRoles(path = ROLES_PATH): { bundle: RoleBundle; roles: readonly Role[] } {
  const loaded = loadBundle(path, roleBundleSchema);

  return { bundle: loaded.value, roles: expandRoles(loaded.value) };
}

/**
 * Все роли, известные системе: договорные плюс служебные.
 *
 * Этим пользуется решение о доступе — оно обязано знать про роль, к которой
 * кто-то привязан. Договорный состав при этом читается по-прежнему через
 * `loadRoles`, и гейт «ровно две роли §4» продолжает его стеречь.
 *
 * Совпадение идентификаторов — ошибка конфигурации, а не тихое переопределение:
 * служебная роль, случайно названная `admin`, подменила бы клиентскую, и
 * подменила бы молча.
 */
export function loadAllRoles(): readonly Role[] {
  const contract = loadRoles();
  const service = loadBundle(SERVICE_ROLES_PATH, roleBundleSchema);
  const known = new Set(contract.roles.map((role) => role.id));

  for (const role of service.value.roles) {
    if (known.has(role.id)) {
      throw new Error(`Служебная роль ${role.id} повторяет договорную: одна из них будет подменена молча`);
    }
  }

  return [...contract.roles, ...expandRoles(service.value)];
}
