/**
 * Демо-вход обязан иметь ВСЕ права системы.
 *
 * ЗАЧЕМ ЭТО ПРОВЕРКА, А НЕ ДОВЕРИЕ К СПИСКУ
 *
 * «Суперадминские возможности» у демо-входа держатся на суммe двух роли —
 * `user` и `admin`, — которые в наборе НЕ ПЕРЕСЕКАЮТСЯ. Пока их сумма равна
 * полному перечню прав, утверждение верно. Добавится одиннадцатое право в новую
 * роль — и демо-вход молча его лишится: экран покажет отказ, а причину придётся
 * искать в конфигурации.
 *
 * Проверка сравнивает не с переписанным списком, а с САМИМ набором ролей: второй
 * список прав разошёлся бы с первым, и проверка охраняла бы копию.
 *
 * НАБОР — ВСЕ РОЛИ, А НЕ ТОЛЬКО ДОГОВОРНЫЕ. У демо-входа есть служебная роль
 * оператора: она даёт единственное действие поперёк изоляции арендаторов —
 * завести организацию-клиента. Сверяться только с договорным набором значило бы
 * объявить эту привязку опечаткой.
 */
import { describe, expect, it } from "vitest";

import { loadAllRoles, loadRoles } from "@platform/config/roles.js";

import { DEMO_SLUG, TENANTS } from "./demo-tenants.js";

describe("демо-контур", () => {
  const { bundle } = loadRoles();
  const все = loadAllRoles();
  const demo = TENANTS.find((tenant) => tenant.slug === DEMO_SLUG);

  it("демо-арендатор объявлен", () => {
    expect(demo, `арендатора «${DEMO_SLUG}» нет в перечне: показывать будет нечем`).toBeDefined();
    expect(demo?.users.length, "у демо-арендатора нет входа").toBeGreaterThan(0);
  });

  it("у демо-входа все права, объявленные набором ролей", () => {
    const all = new Set(все.flatMap((role) => role.permissions));
    const granted = new Set(
      (demo?.users ?? []).flatMap((person) =>
        person.roles.flatMap((roleId) => все.find((role) => role.id === roleId)?.permissions ?? []),
      ),
    );

    const missing = [...all].filter((permission) => !granted.has(permission)).sort();

    expect(
      missing,
      `демо-вход не получает права: ${missing.join(", ")}. Добавьте роль в перечень демо-арендатора`,
    ).toEqual([]);
  });

  it("каждая роль демо-входа существует в наборе", () => {
    // Опечатка в идентификаторе роли не ломает наполнение: привязка создаётся,
    // а прав не даёт. Отказ на экране при этом выглядит как ошибка прав, а не
    // как опечатка в списке.
    const known = new Set(все.map((role) => role.id));

    for (const person of demo?.users ?? []) {
      for (const role of person.roles) {
        expect(known.has(role), `роли «${role}» нет в наборе: привязка создастся и прав не даст`).toBe(true);
      }
    }
  });

  it("арендаторы и входы не повторяются", () => {
    const slugs = TENANTS.map((tenant) => tenant.slug);
    expect(slugs.length, "два арендатора с одним slug: вход попадёт не туда").toBe(new Set(slugs).size);

    const ids = TENANTS.map((tenant) => tenant.id);
    expect(ids.length, "два арендатора с одним идентификатором").toBe(new Set(ids).size);

    // Адрес уникален В ПРЕДЕЛАХ арендатора (так устроен ключ в схеме), поэтому
    // сверяется пара «арендатор + адрес», а не адрес сам по себе.
    const logins = TENANTS.flatMap((tenant) => tenant.users.map((person) => `${tenant.slug}/${person.email}`));
    expect(logins.length, "два входа с одним адресом у одного арендатора").toBe(new Set(logins).size);
  });

  it("у демо-входа пароль латиницей", () => {
    // Не придирка: кириллический пароль нельзя ни продиктовать по телефону, ни
    // набрать на чужой раскладке, а демо-вход дают именно так. У клиентских
    // арендаторов пароль остаётся каким угодно — это правило только про показ.
    for (const person of demo?.users ?? []) {
      expect(
        /^[ -~]+$/.test(person.password),
        `пароль «${person.password}» содержит не-латиницу: его не набрать на чужой раскладке`,
      ).toBe(true);
    }
  });
});
