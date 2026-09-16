/**
 * Точка принятия решений о доступе (ADR-R-016).
 *
 * Авторизация — порт, а не `if (role === "admin")` по коду. Это нужно по двум
 * причинам:
 *  · ТЗ §4 даёт АПРИ ровно две роли, а §14 исключает права по объектам из
 *    объёма — но платформе нужны группы для остальных клиентов;
 *  · при наличии порта добавление ACL на объект позже становится изменением
 *    политики, а не миграцией схемы.
 *
 * Изоляция арендатора проверяется ЗДЕСЬ и всегда: ни одно решение не выдаётся
 * без совпадения `tenantId` (ADR-R-015). RLS в PostgreSQL — второй рубеж, а не
 * единственный.
 */
export interface Role {
  readonly id: string;
  readonly permissions: readonly string[];
}

export type Subject =
  | { readonly kind: "user"; readonly id: string }
  | { readonly kind: "group"; readonly id: string };

export interface RoleBinding {
  readonly tenantId: string;
  readonly subject: Subject;
  readonly roleId: string;
}

export interface Actor {
  readonly userId: string;
  readonly tenantId: string;
  readonly groupIds: readonly string[];
}

/** Ресурс, к которому обращаются. Отсутствие означает операцию уровня арендатора. */
export interface Resource {
  readonly tenantId: string;
  readonly kind: string;
  readonly id: string;
}

export type Decision =
  | { readonly allowed: true; readonly via: string }
  | { readonly allowed: false; readonly reason: string };

export class PolicyDecisionPoint {
  readonly #roles: ReadonlyMap<string, Role>;
  readonly #bindings: readonly RoleBinding[];

  constructor(roles: readonly Role[], bindings: readonly RoleBinding[]) {
    const byId = new Map<string, Role>();

    for (const role of roles) {
      if (byId.has(role.id)) {
        throw new Error(`Роль объявлена дважды: ${role.id}`);
      }
      byId.set(role.id, role);
    }

    for (const binding of bindings) {
      if (!byId.has(binding.roleId)) {
        throw new Error(`Привязка ссылается на неизвестную роль: ${binding.roleId}`);
      }
    }

    this.#roles = byId;
    this.#bindings = bindings;
  }

  /**
   * Решение по паре «актор — право». Ресурс другого арендатора отклоняется до
   * проверки прав: это граница контура, а не вопрос роли.
   */
  decide(actor: Actor, permission: string, resource?: Resource): Decision {
    if (resource !== undefined && resource.tenantId !== actor.tenantId) {
      return {
        allowed: false,
        reason:
          `Ресурс ${resource.kind}:${resource.id} принадлежит арендатору ${resource.tenantId}, ` +
          `актор — ${actor.tenantId}. Кросс-арендный доступ запрещён.`,
      };
    }

    for (const binding of this.#bindings) {
      if (binding.tenantId !== actor.tenantId) continue;

      const matchesUser = binding.subject.kind === "user" && binding.subject.id === actor.userId;
      const matchesGroup = binding.subject.kind === "group" && actor.groupIds.includes(binding.subject.id);

      if (!matchesUser && !matchesGroup) continue;

      const role = this.#roles.get(binding.roleId);
      if (role?.permissions.includes(permission) === true) {
        return { allowed: true, via: `${binding.subject.kind}:${binding.subject.id} → ${role.id}` };
      }
    }

    return { allowed: false, reason: `Право ${permission} не предоставлено ни одной привязкой актора` };
  }

  /** Бросает вместо возврата решения — для мест, где отказ является ошибкой. */
  assert(actor: Actor, permission: string, resource?: Resource): void {
    const decision = this.decide(actor, permission, resource);

    if (!decision.allowed) {
      throw new Error(`Доступ запрещён: ${decision.reason}`);
    }
  }

  permissionsOf(actor: Actor): readonly string[] {
    const granted = new Set<string>();

    for (const binding of this.#bindings) {
      if (binding.tenantId !== actor.tenantId) continue;

      const matches =
        (binding.subject.kind === "user" && binding.subject.id === actor.userId) ||
        (binding.subject.kind === "group" && actor.groupIds.includes(binding.subject.id));

      if (!matches) continue;

      for (const permission of this.#roles.get(binding.roleId)?.permissions ?? []) {
        granted.add(permission);
      }
    }

    return [...granted];
  }
}
