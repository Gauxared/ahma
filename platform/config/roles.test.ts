/**
 * Роли клиента как конфигурация — ADR-R-016, ТЗ §4.
 *
 * §4 задаёт АПРИ ровно две роли и определяет вторую ЧЕРЕЗ первую:
 * «Администратор — то же плюс управление пользователями, загрузка опорной базы,
 * настройка каналов, просмотр журнала». Наследование здесь не украшение
 * конфигурации, а буквальное содержание требования.
 */
import { describe, expect, it } from "vitest";

import { expandRoles, loadAllRoles, loadRoles, roleBundleSchema } from "./roles.js";

const БАЗА = {
  customer: "Тест",
  clause: "ТЗ §4",
  roles: [
    { id: "user", title: "Пользователь", permissions: ["check:read"] },
    { id: "admin", title: "Администратор", inherits: "user", permissions: ["audit:read"] },
  ],
};

describe("схема набора ролей", () => {
  it("принимает корректный набор", () => {
    expect(() => roleBundleSchema.parse(БАЗА)).not.toThrow();
  });

  it("не принимает набор без ссылки на пункт ТЗ", () => {
    // Роль без основания — право без владельца: непонятно, кто его выдал.
    expect(() => roleBundleSchema.parse({ ...БАЗА, clause: "просто так" })).toThrow();
  });

  it("не принимает роль без прав", () => {
    expect(() =>
      roleBundleSchema.parse({ ...БАЗА, roles: [{ id: "x", title: "X", permissions: [] }] }),
    ).toThrow();
  });
});

describe("разворачивание наследования", () => {
  it("даёт администратору права пользователя ВДОБАВОК к своим", () => {
    const roles = expandRoles(БАЗА);
    const admin = roles.find((role) => role.id === "admin")!;

    expect(admin.permissions).toContain("check:read");
    expect(admin.permissions).toContain("audit:read");
  });

  it("НЕ даёт пользователю прав администратора", () => {
    const roles = expandRoles(БАЗА);
    const user = roles.find((role) => role.id === "user")!;

    expect(user.permissions).not.toContain("audit:read");
  });

  it("не дублирует право, названное дважды", () => {
    const roles = expandRoles({
      ...БАЗА,
      roles: [
        { id: "user", title: "П", permissions: ["check:read"] },
        { id: "admin", title: "А", inherits: "user", permissions: ["check:read", "audit:read"] },
      ],
    });
    const admin = roles.find((role) => role.id === "admin")!;

    expect(admin.permissions.filter((p) => p === "check:read")).toHaveLength(1);
  });

  it("ЛОВИТ цикл наследования и называет цепочку", () => {
    // Наивное разворачивание дало бы бесконечный цикл при СТАРТЕ, то есть
    // падение без объяснения.
    expect(() =>
      expandRoles({
        ...БАЗА,
        roles: [
          { id: "a", title: "A", inherits: "b", permissions: ["x"] },
          { id: "b", title: "B", inherits: "a", permissions: ["y"] },
        ],
      }),
    ).toThrow(/цикл/i);
  });

  it("ловит наследование несуществующей роли", () => {
    expect(() =>
      expandRoles({
        ...БАЗА,
        roles: [{ id: "a", title: "A", inherits: "нет-такой", permissions: ["x"] }],
      }),
    ).toThrow(/несуществующ/i);
  });

  it("ловит повторное объявление роли", () => {
    expect(() =>
      expandRoles({
        ...БАЗА,
        roles: [
          { id: "a", title: "A", permissions: ["x"] },
          { id: "a", title: "A ещё раз", permissions: ["y"] },
        ],
      }),
    ).toThrow(/дважды/i);
  });
});

describe("набор ролей проекта", () => {
  it("читается и содержит ровно две роли §4", () => {
    // ТЗ §4 даёт АПРИ ровно две. Появление третьей — изменение договора, и
    // тест обязан о нём сообщить.
    const { bundle, roles } = loadRoles();

    expect(bundle.clause).toContain("§4");
    expect(roles.map((role) => role.id).sort()).toEqual(["admin", "user"]);
  });

  it("администратор видит журнал, пользователь — нет (§4)", () => {
    // Прямая цитата §4: просмотр журнала — право администратора.
    const { roles } = loadRoles();
    const admin = roles.find((role) => role.id === "admin")!;
    const user = roles.find((role) => role.id === "user")!;

    expect(admin.permissions).toContain("audit:read");
    expect(user.permissions).not.toContain("audit:read");
  });

  it("пользователь запускает проверки и выгружает результаты (§4)", () => {
    const { roles } = loadRoles();
    const user = roles.find((role) => role.id === "user")!;

    for (const permission of ["document:upload", "check:start", "artifact:export"]) {
      expect(user.permissions).toContain(permission);
    }
  });
});

/**
 * Служебные роли — вне договорного набора.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ НАБОР. Роль оператора системы нужна ровно для одного
 * действия — завести организацию-клиента с её первым администратором, — и
 * договором клиента она не задана. Положенная в клиентский набор, она объявила
 * бы клиенту роль, которой у него нет, и заодно погасила бы гейт «ровно две
 * роли §4»: ровно это и произошло при первой попытке.
 */
describe("служебные роли", () => {
  it("не входят в договорный набор клиента", () => {
    expect(loadRoles().bundle.roles.map((role) => role.id)).not.toContain("operator");
  });

  it("но известны решению о доступе", () => {
    // Привязка к роли, о которой не знает решение о доступе, даёт вход, который
    // входит и не может ничего.
    const operator = loadAllRoles().find((role) => role.id === "operator");

    expect(operator?.permissions).toContain("tenant:manage");
  });

  it("права оператора нет ни у одной договорной роли", () => {
    // Заведение чужой организации — единственное действие поперёк изоляции
    // арендаторов. Администратор клиента управляет людьми СВОЕЙ организации.
    for (const role of loadRoles().roles) {
      expect(role.permissions, `роль ${role.id} получила право заводить организации`).not.toContain("tenant:manage");
    }
  });
});
