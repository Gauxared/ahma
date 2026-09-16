/**
 * Разбор форм заведения — объект, пользователь, организация.
 *
 * ЧТО ЗДЕСЬ ЗАЩИЩАЕТСЯ
 *
 * Два свойства, и оба ломаются молча:
 *
 * 1. **Шифр объекта и адрес организации попадают в АДРЕС.** Шифр — в
 *    `/objects/<шифр>/...`, адрес организации набирают руками в форме входа.
 *    Кириллица и пробел там дают ссылку, которую нельзя ни прочитать в письме,
 *    ни продиктовать по телефону, а вход — «не работает при верном пароле».
 * 2. **Роль проверяется по реестру ролей.** Привязка к несуществующей роли даёт
 *    вход, который входит и не может ничего. Он выглядит заведённым.
 *
 * И одно свойство отказа: причина называется словами человека. Формы заполняет
 * администратор клиента на встрече, а «неверные данные» не позволяют выбрать
 * действие.
 */
import { describe, expect, it } from "vitest";

import { PASSWORD_MIN, parseObject, parseTenant, parseUser } from "./access.js";

const РОЛИ = ["user", "admin", "operator"];

function причина<T>(parsed: ReturnType<typeof parseObject> | { ok: boolean; reason?: string }): string {
  return parsed.ok ? "отказа не было" : ((parsed as { reason: string }).reason ?? "");
}

describe("заведение объекта", () => {
  it("принимает шифр из латиницы, цифр и дефиса", () => {
    const parsed = parseObject({ code: " KRG-2 ", name: " ЖДПП Зауралье ", region: " Курганская обл. " });

    expect(parsed).toEqual({
      ok: true,
      value: { code: "KRG-2", name: "ЖДПП Зауралье", region: "Курганская обл." },
    });
  });

  it("регион необязателен и пустым не становится пустой строкой", () => {
    const parsed = parseObject({ code: "KRG-2", name: "Объект", region: "   " });

    // `undefined`, а не `""`: пустая строка в базе читается как «регион указан и
    // он пуст», и на экране даёт подпись «объект · » с висящей точкой.
    expect(parsed.ok && parsed.value.region).toBeUndefined();
  });

  it("отвергает кириллицу в шифре и объясняет, почему", () => {
    const parsed = parseObject({ code: "КРГ-1", name: "Объект", region: "" });

    expect(parsed.ok).toBe(false);
    expect(причина(parsed)).toContain("адрес");
  });

  it("отвергает пробел в шифре", () => {
    expect(parseObject({ code: "KRG 1", name: "Объект", region: "" }).ok).toBe(false);
  });

  it("отвергает шифр из одного знака и слишком длинный", () => {
    expect(parseObject({ code: "K", name: "Объект", region: "" }).ok).toBe(false);
    expect(parseObject({ code: "K".repeat(33), name: "Объект", region: "" }).ok).toBe(false);
  });

  it("отвергает объект без имени", () => {
    const parsed = parseObject({ code: "KRG-2", name: "   ", region: "" });

    expect(parsed.ok).toBe(false);
    expect(причина(parsed)).toContain("имя");
  });
});

describe("заведение пользователя", () => {
  const годный = { email: " Ivanov@Example.RU ", name: " Иванов Иван ", password: "долгийпароль", role: "user" };

  it("приводит адрес к нижнему регистру", () => {
    // Иначе `Ivanov@` и `ivanov@` — два разных входа в одной организации, и
    // человек, набравший адрес с заглавной, получает «неверный пароль».
    const parsed = parseUser(годный, РОЛИ);

    expect(parsed.ok && parsed.value.email).toBe("ivanov@example.ru");
  });

  it("отвергает адрес без собаки", () => {
    expect(parseUser({ ...годный, email: "ivanov.example.ru" }, РОЛИ).ok).toBe(false);
  });

  it("отвергает короткий пароль и называет границу числом", () => {
    const parsed = parseUser({ ...годный, password: "a".repeat(PASSWORD_MIN - 1) }, РОЛИ);

    expect(parsed.ok).toBe(false);
    expect(причина(parsed)).toContain(String(PASSWORD_MIN));
  });

  it("отвергает роль, которой нет в конфигурации", () => {
    // Привязка к несуществующей роли даёт вход без прав — он выглядит
    // заведённым и не может ничего.
    const parsed = parseUser({ ...годный, role: "начальник" }, РОЛИ);

    expect(parsed.ok).toBe(false);
    expect(причина(parsed)).toContain("начальник");
  });

  it("роли берутся из переданного реестра, а не из списка в коде", () => {
    // У другого клиента роли другие (`ADR-R-016`). Тот же вход при другом
    // реестре обязан дать другой исход.
    expect(parseUser({ ...годный, role: "operator" }, РОЛИ).ok).toBe(true);
    expect(parseUser({ ...годный, role: "operator" }, ["user"]).ok).toBe(false);
  });
});

describe("заведение организации", () => {
  it("принимает строчную латиницу с дефисом", () => {
    const parsed = parseTenant({ slug: " Probniy-Klient ", name: " ООО «Пробный» " });

    // Регистр приводится: адрес организации набирают руками, и `Probniy` при
    // заведённом `probniy` дал бы вход, который «не работает».
    expect(parsed).toEqual({ ok: true, value: { slug: "probniy-klient", displayName: "ООО «Пробный»" } });
  });

  it("отвергает кириллицу и точку в адресе организации", () => {
    expect(parseTenant({ slug: "пробный", name: "ООО" }).ok).toBe(false);
    expect(parseTenant({ slug: "probniy.klient", name: "ООО" }).ok).toBe(false);
  });

  it("отвергает организацию без названия", () => {
    const parsed = parseTenant({ slug: "probniy", name: " " });

    expect(parsed.ok).toBe(false);
    expect(причина(parsed)).toContain("название");
  });
});
