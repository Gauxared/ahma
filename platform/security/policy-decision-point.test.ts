import { describe, expect, it } from "vitest";

import { PolicyDecisionPoint } from "./policy-decision-point.js";
import type { Actor, Role, RoleBinding } from "./policy-decision-point.js";

/** Пак АПРИ связывает ровно две роли (ТЗ §4). Модель под группы уже есть. */
const ROLES: readonly Role[] = [
  { id: "user", permissions: ["check.run", "check.read", "document.upload"] },
  { id: "administrator", permissions: ["check.run", "check.read", "document.upload", "knowledge.import", "audit.read"] },
];

const BINDINGS: readonly RoleBinding[] = [
  { tenantId: "t-apri", subject: { kind: "user", id: "u-ivanov" }, roleId: "user" },
  { tenantId: "t-apri", subject: { kind: "user", id: "u-admin" }, roleId: "administrator" },
  // Группа — платформенная возможность; в паке АПРИ не используется.
  { tenantId: "t-other", subject: { kind: "group", id: "g-estimators" }, roleId: "user" },
];

const pdp = new PolicyDecisionPoint(ROLES, BINDINGS);

function actor(overrides: Partial<Actor> = {}): Actor {
  return { userId: "u-ivanov", tenantId: "t-apri", groupIds: [], ...overrides };
}

describe("изоляция арендатора (ADR-R-015)", () => {
  it("отказывает в доступе к ресурсу другого арендатора до проверки прав", () => {
    const decision = pdp.decide(actor({ userId: "u-admin" }), "check.read", {
      tenantId: "t-other",
      kind: "check",
      id: "c-1",
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toMatch(/Кросс-арендный доступ запрещён/);
    }
  });

  it("разрешает доступ к ресурсу своего арендатора", () => {
    const decision = pdp.decide(actor(), "check.read", { tenantId: "t-apri", kind: "check", id: "c-1" });
    expect(decision.allowed).toBe(true);
  });

  it("не выдаёт права по привязке из чужого арендатора", () => {
    const foreign = actor({ tenantId: "t-apri", groupIds: ["g-estimators"] });
    expect(pdp.decide(foreign, "check.run").allowed).toBe(true);

    const stranger = actor({ userId: "u-unknown", groupIds: ["g-estimators"] });
    expect(pdp.decide(stranger, "check.run").allowed).toBe(false);
  });
});

describe("две роли АПРИ (ТЗ §4)", () => {
  it("пользователь запускает Проверки, но не импортирует опорную базу", () => {
    expect(pdp.decide(actor(), "check.run").allowed).toBe(true);
    expect(pdp.decide(actor(), "knowledge.import").allowed).toBe(false);
  });

  it("администратор импортирует опорную базу и читает журнал", () => {
    const admin = actor({ userId: "u-admin" });
    expect(pdp.decide(admin, "knowledge.import").allowed).toBe(true);
    expect(pdp.decide(admin, "audit.read").allowed).toBe(true);
  });

  it("assert бросает на отказе", () => {
    expect(() => pdp.assert(actor(), "knowledge.import")).toThrow(/Доступ запрещён/);
    expect(() => pdp.assert(actor(), "check.run")).not.toThrow();
  });
});

describe("группы как платформенная возможность (ADR-R-016)", () => {
  it("выдаёт права через членство в группе", () => {
    const member: Actor = { userId: "u-petrov", tenantId: "t-other", groupIds: ["g-estimators"] };

    expect(pdp.decide(member, "check.run").allowed).toBe(true);
    expect(pdp.permissionsOf(member)).toContain("document.upload");
  });

  it("не выдаёт прав тому, кто не состоит в группе", () => {
    const outsider: Actor = { userId: "u-petrov", tenantId: "t-other", groupIds: [] };
    expect(pdp.decide(outsider, "check.run").allowed).toBe(false);
  });
});

describe("целостность конфигурации политики", () => {
  it("отвергает привязку к неизвестной роли при сборке, а не при проверке", () => {
    expect(
      () => new PolicyDecisionPoint(ROLES, [{ tenantId: "t", subject: { kind: "user", id: "u" }, roleId: "ghost" }]),
    ).toThrow(/неизвестную роль/);
  });

  it("отвергает дублирующуюся роль", () => {
    expect(() => new PolicyDecisionPoint([...ROLES, ROLES[0] as Role], [])).toThrow(/дважды/);
  });
});
