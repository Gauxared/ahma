/**
 * Тесты написаны до реализации. Egress-шлюз — ADR-R-017, ТЗ §8.3, §11, §12.1л.
 *
 * ЗАЧЕМ ШЛЮЗ, ЕСЛИ МАНИФЕСТЫ УЖЕ ОБЪЯВЛЯЮТ НАЗНАЧЕНИЯ
 *
 * Манифест — обещание расширения. Шлюз — единственное место, где обещание
 * проверяется. Без него декларация `egress.destinations` описывает намерение
 * автора расширения, а не поведение системы, и §11 («во внешний контур
 * передаются только анонимизированные и маскированные данные») держится на
 * дисциплине.
 *
 * Дисциплина не выдерживает проверки: достаточно одного `fetch` в новом
 * адаптере, написанного по образцу соседнего кода.
 *
 * ГЛАВНАЯ ЛОВУШКА — СРАВНЕНИЕ ИМЁН ХОСТОВ
 *
 * `destination.includes(host)` и `host.startsWith(destination)` выглядят
 * работающими и пропускают `storhaus.apri.example.злоумышленник.рф`. Имя хоста
 * сравнивается ЦЕЛИКОМ либо как поддомен по точке — третьего не дано.
 *
 * ПЕРЕНАПРАВЛЕНИЯ — ДЫРА В ЛЮБОЙ ПРОВЕРКЕ АДРЕСА
 *
 * Разрешённый адрес, ответивший `302` на чужой, сводит проверку к нулю:
 * проверили одно, пошли в другое. Поэтому шлюз не следует за
 * перенаправлениями — он их отвергает.
 */
import { describe, expect, it } from "vitest";

import type { ExtensionManifest } from "@platform/extensions/manifest.js";

import { EgressGateway, isInternalHost } from "./egress-gateway.js";

const STORHAUS: ExtensionManifest = {
  id: "storhaus",
  version: 1,
  kind: "model-provider",
  implements: "1.0.0",
  contour: "external",
  dataClasses: ["object_meta", "positions"],
  egress: { destinations: ["storhaus.apri.example"], purpose: "data_ingest" },
  requiresPermissions: [],
  provides: [],
};

const ВНУТРЕННИЙ: ExtensionManifest = {
  ...STORHAUS,
  id: "местный-разбор",
  contour: "internal",
  dataClasses: ["positions"],
  egress: undefined as never,
};

function шлюз(manifests: readonly ExtensionManifest[] = [STORHAUS]): EgressGateway {
  return new EgressGateway(manifests);
}

describe("разрешение выхода", () => {
  it("пропускает в задекларированное назначение", () => {
    const решение = шлюз().authorize({
      extensionId: "storhaus",
      url: "https://storhaus.apri.example/api/v1/objects",
      dataClasses: ["object_meta"],
    });

    expect(решение.allowed).toBe(true);
  });

  it("БЛОКИРУЕТ незадекларированное назначение", () => {
    const решение = шлюз().authorize({
      extensionId: "storhaus",
      url: "https://куда-нибудь.рф/приём",
      dataClasses: ["object_meta"],
    });

    expect(решение.allowed).toBe(false);
    expect(решение.allowed === false && решение.reason).toContain("не задекларировано");
  });

  it("БЛОКИРУЕТ неизвестное расширение — fail closed", () => {
    // Расширение без манифеста не «ещё не описано», а не имеет права выходить.
    // Пропустить его значит сделать реестр необязательным.
    const решение = шлюз().authorize({
      extensionId: "самодеятельность",
      url: "https://storhaus.apri.example/",
      dataClasses: [],
    });

    expect(решение.allowed).toBe(false);
    expect(решение.allowed === false && решение.reason).toContain("не зарегистрировано");
  });

  it("БЛОКИРУЕТ расширению внутреннего контура выход на ВНЕШНИЙ адрес", () => {
    // Не «внутреннее расширение никуда не ходит», а «внутреннее расширение не
    // выходит за контур». Разницу дала разработка: локальный прокси — тоже
    // обращение по сети, но контур он не покидает.
    const решение = шлюз([
      { ...ВНУТРЕННИЙ, egress: { destinations: ["куда-нибудь.рф"], purpose: "п" } },
    ]).authorize({
      extensionId: "местный-разбор",
      url: "https://куда-нибудь.рф/",
      dataClasses: ["positions"],
    });

    expect(решение.allowed).toBe(false);
    expect(решение.allowed === false && решение.reason).toContain("не принадлежит петле");
  });
});

describe("внутренний контур", () => {
  const ЛОКАЛЬНАЯ: ExtensionManifest = {
    ...ВНУТРЕННИЙ,
    dataClasses: ["positions", "commercial_secret"],
    egress: { destinations: ["127.0.0.1"], purpose: "локальная модель" },
  };

  it("пропускает http на петлю: перехватывать там нечего", () => {
    // Первая редакция шлюза требовала https всегда — и запретила разработке
    // ходить на прокси 127.0.0.1:8317. Отказ был последователен и неверен.
    const решение = шлюз([ЛОКАЛЬНАЯ]).authorize({
      extensionId: "местный-разбор",
      url: "http://127.0.0.1:8317/v1/chat/completions",
      dataClasses: ["positions"],
    });

    expect(решение.allowed).toBe(true);
  });

  it("пропускает коммерческую тайну БЕЗ анонимизации: контур не покидается", () => {
    // Обезличивать данные для локальной модели значит ухудшать проверку ради
    // правила, которое к ней не относится: §12.1л говорит о ВЫХОДЕ за контур.
    const решение = шлюз([ЛОКАЛЬНАЯ]).authorize({
      extensionId: "местный-разбор",
      url: "http://127.0.0.1:8317/v1",
      dataClasses: ["commercial_secret"],
    });

    expect(решение.allowed).toBe(true);
  });

  it("НЕ ДАЁТ обойти правила, назвав внешний адрес внутренним", () => {
    // Самый дешёвый обход, будь метка манифеста принята на слово: объявить
    // маршрут внутренним и указать чужой адрес — отпали бы разом и https,
    // и анонимизация.
    const решение = шлюз([
      {
        ...ВНУТРЕННИЙ,
        dataClasses: ["commercial_secret"],
        egress: { destinations: ["злоумышленник.рф"], purpose: "якобы локально" },
      },
    ]).authorize({
      extensionId: "местный-разбор",
      url: "http://злоумышленник.рф/v1",
      dataClasses: ["commercial_secret"],
    });

    expect(решение.allowed).toBe(false);
  });

  it("172.32 НЕ считается частной сетью", () => {
    // Частный диапазон — 172.16…31. Проверка «a === 172» целиком отнесла бы
    // к внутренним публичный адрес, и метка «внутренний» стала бы работать.
    expect(isInternalHost("172.31.0.1")).toBe(true);
    expect(isInternalHost("172.32.0.1")).toBe(false);
    expect(isInternalHost("192.168.1.1")).toBe(true);
    expect(isInternalHost("8.8.8.8")).toBe(false);
  });
});

describe("сравнение имён хостов", () => {
  it("НЕ пропускает похожее имя, содержащее разрешённое", () => {
    // `includes` пропустил бы это. Классическая дыра, и она выглядит рабочей.
    const решение = шлюз().authorize({
      extensionId: "storhaus",
      url: "https://storhaus.apri.example.злоумышленник.рф/приём",
      dataClasses: ["object_meta"],
    });

    expect(решение.allowed).toBe(false);
  });

  it("НЕ пропускает имя с разрешённым в начале", () => {
    // `startsWith` пропустил бы.
    const решение = шлюз().authorize({
      extensionId: "storhaus",
      url: "https://storhaus.apri.examplehost/",
      dataClasses: ["object_meta"],
    });

    expect(решение.allowed).toBe(false);
  });

  it("НЕ пропускает имя с разрешённым в конце", () => {
    const решение = шлюз().authorize({
      extensionId: "storhaus",
      url: "https://чужой-storhaus.apri.example/",
      dataClasses: ["object_meta"],
    });

    expect(решение.allowed).toBe(false);
  });

  it("пропускает ПОДДОМЕН разрешённого, когда он объявлен маской", () => {
    // Явная маска — решение автора манифеста, а не догадка шлюза.
    const решение = шлюз([
      { ...STORHAUS, egress: { destinations: ["*.apri.example"], purpose: "data_ingest" } },
    ]).authorize({
      extensionId: "storhaus",
      url: "https://storhaus.apri.example/",
      dataClasses: ["object_meta"],
    });

    expect(решение.allowed).toBe(true);
  });

  it("маска НЕ пропускает сам домен без поддомена", () => {
    // `*.apri.example` — это поддомены, а не `apri.example`. Смешать значит
    // расширить разрешение молча.
    const решение = шлюз([
      { ...STORHAUS, egress: { destinations: ["*.apri.example"], purpose: "data_ingest" } },
    ]).authorize({
      extensionId: "storhaus",
      url: "https://apri.example/",
      dataClasses: ["object_meta"],
    });

    expect(решение.allowed).toBe(false);
  });

  it("маска НЕ пропускает чужой домен, оканчивающийся так же", () => {
    const решение = шлюз([
      { ...STORHAUS, egress: { destinations: ["*.apri.example"], purpose: "data_ingest" } },
    ]).authorize({
      extensionId: "storhaus",
      url: "https://x.злойapri.example/",
      dataClasses: ["object_meta"],
    });

    expect(решение.allowed).toBe(false);
  });

  it("не различает регистр имени хоста", () => {
    const решение = шлюз().authorize({
      extensionId: "storhaus",
      url: "https://STORHAUS.APRI.EXAMPLE/",
      dataClasses: ["object_meta"],
    });

    expect(решение.allowed).toBe(true);
  });
});

/** Чистая расписка анонимизатора. Отпечаток здесь не проверяется — это делает адаптер. */
const РАСПИСКА = { clean: true, replacements: 3, leftovers: [], outputDigest: "0123456789abcdef" };

describe("классы данных", () => {
  /** Расширение, которому тайна объявлена: иначе сработал бы запрет на необъявленный класс. */
  const сТайной = (): EgressGateway =>
    шлюз([{ ...STORHAUS, dataClasses: ["object_meta", "commercial_secret"] }]);

  it("БЛОКИРУЕТ коммерческую тайну без анонимизации (§12.1л)", () => {
    // ТЗ: «сведения... в исходном виде за пределы контура не передаются ни при
    // каких режимах работы Системы». Это единственный безусловный запрет.
    // Объявленность класса его не снимает: манифест даёт расширению право
    // РАБОТАТЬ с тайной, а не выносить её наружу в исходном виде.
    const решение = сТайной().authorize({
      extensionId: "storhaus",
      url: "https://storhaus.apri.example/",
      dataClasses: ["commercial_secret"],
    });

    expect(решение.allowed).toBe(false);
    expect(решение.allowed === false && решение.reason).toContain("§12.1л");
  });

  it("пропускает коммерческую тайну ПОСЛЕ анонимизации", () => {
    const решение = сТайной().authorize({
      extensionId: "storhaus",
      url: "https://storhaus.apri.example/",
      dataClasses: ["commercial_secret"],
      anonymization: РАСПИСКА,
    });

    expect(решение.allowed).toBe(true);
  });

  it("БЛОКИРУЕТ класс данных, не объявленный манифестом", () => {
    // Расширение, объявившее «object_meta», не должно выносить цены: манифест
    // — это и разрешение, и предел.
    const решение = шлюз().authorize({
      extensionId: "storhaus",
      url: "https://storhaus.apri.example/",
      dataClasses: ["prices"],
    });

    expect(решение.allowed).toBe(false);
    expect(решение.allowed === false && решение.reason).toContain("prices");
  });

  it("анонимизация НЕ снимает запрет на необъявленный класс", () => {
    // Анонимизация отвечает на вопрос «можно ли выпускать ЭТИ сведения», а не
    // «имеет ли расширение к ним отношение». Смешать значит разрешить любому
    // расширению выносить что угодно, лишь бы обезличенно.
    const решение = шлюз().authorize({
      extensionId: "storhaus",
      url: "https://storhaus.apri.example/",
      dataClasses: ["prices"],
      anonymization: РАСПИСКА,
    });

    expect(решение.allowed).toBe(false);
  });
});

describe("схема и перенаправления", () => {
  it("БЛОКИРУЕТ незашифрованный http", () => {
    // Данные заказчика по открытому каналу — то же, что без шлюза.
    const решение = шлюз().authorize({
      extensionId: "storhaus",
      url: "http://storhaus.apri.example/",
      dataClasses: ["object_meta"],
    });

    expect(решение.allowed).toBe(false);
    expect(решение.allowed === false && решение.reason).toContain("https");
  });

  it("БЛОКИРУЕТ нечитаемый адрес", () => {
    const решение = шлюз().authorize({
      extensionId: "storhaus",
      url: "не адрес вовсе",
      dataClasses: [],
    });

    expect(решение.allowed).toBe(false);
  });

  it("отвергает перенаправление, а не следует за ним", () => {
    // Разрешённый адрес, ответивший 302 на чужой, свёл бы проверку к нулю:
    // проверили одно, пошли в другое.
    expect(шлюз().redirectPolicy()).toBe("error");
  });
});

describe("след решения", () => {
  it("называет расширение, назначение и причину", () => {
    // Решение шлюза попадает в журнал (§12.1л). Запись «заблокировано» без
    // указания куда и почему не даёт ни разобраться, ни оспорить.
    const решение = шлюз().authorize({
      extensionId: "storhaus",
      url: "https://куда-нибудь.рф/",
      dataClasses: ["object_meta"],
    });

    expect(решение.record.extensionId).toBe("storhaus");
    // В следе — punycode: имя, в которое хост фактически разрешается. Показывать
    // кириллический вид значило бы записывать в журнал не то имя, к которому
    // обращались, — а на похожих именах это и есть суть подмены.
    expect(решение.record.host).toBe("xn----7sbejdwk1a4cg4h.xn--p1ai");
    expect(решение.record.allowed).toBe(false);
    expect(решение.record.reason.length).toBeGreaterThan(10);
  });

  it("НЕ помещает в след сам адрес с путём и запросом", () => {
    // Путь и строка запроса содержат идентификаторы объектов и документов.
    // Журнал отвечает на вопрос «куда ходили», а не «что именно вынесли».
    const решение = шлюз().authorize({
      extensionId: "storhaus",
      url: "https://storhaus.apri.example/api/v1/objects/КРГ-1?смета=секрет",
      dataClasses: ["object_meta"],
    });

    expect(JSON.stringify(решение.record)).not.toContain("секрет");
    expect(JSON.stringify(решение.record)).not.toContain("КРГ-1");
  });
});
