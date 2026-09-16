/**
 * Egress-шлюз — ADR-R-017, ТЗ §8.3, §11, §12.1л.
 *
 * ЧТО ЭТО ЗА МЕХАНИЗМ
 *
 * Единственное место, где решается, уходит ли запрос за пределы контура. До
 * него декларация `egress.destinations` в манифесте была обещанием автора
 * расширения; после — условием, без выполнения которого запрос не уходит.
 *
 * ЗАКРЫТО ПО УМОЛЧАНИЮ
 *
 * Неизвестное расширение, неизвестное назначение, необъявленный класс данных —
 * отказ. Не потому, что каждый такой случай опасен, а потому, что обратное
 * правило («пропускаем, пока не запретили») делает реестр расширений
 * необязательным: достаточно не описать расширение, и оно свободно.
 *
 * ПОЧЕМУ ИМЕНА ХОСТОВ СРАВНИВАЮТСЯ ЦЕЛИКОМ
 *
 * `includes` и `startsWith` на именах хостов выглядят работающими и пропускают
 * `storhaus.apri.local.злоумышленник.рф`. Имя хоста — не строка, а
 * последовательность меток, разделённых точками; сравнивать её можно либо
 * целиком, либо по границе метки. Промежуточных вариантов нет.
 *
 * ОБЕ СТОРОНЫ ПРИВОДЯТСЯ К ОДНОМУ ВИДУ
 *
 * `new URL()` переводит имя в punycode: «куда-нибудь.рф» становится
 * «xn----7sbejdwk1a4cg4h.xn--p1ai». Сравнить его с назначением, записанным в
 * манифесте кириллицей, напрямую нельзя — не совпадёт НИКОГДА, и шлюз молча
 * запретит то, что разрешено. Поэтому назначение из манифеста проходит тот же
 * разбор.
 *
 * ПОЧЕМУ ШЛЮЗ НЕ ХОДИТ ПО ПЕРЕНАПРАВЛЕНИЯМ
 *
 * Разрешённый адрес, ответивший `302` на чужой, сводит проверку к нулю:
 * проверили одно, обратились к другому. Проверять адрес перенаправления —
 * значит вести гонку с сервером, который его выдаёт. Дешевле и надёжнее не
 * следовать за ними вовсе: расширение, которому нужно перенаправление, объявит
 * конечный адрес.
 *
 * КОНТУР — СВОЙСТВО НАЗНАЧЕНИЯ, А НЕ ТОЛЬКО РАСШИРЕНИЯ
 *
 * Первая редакция запрещала выход всякому расширению внутреннего контура — и
 * сразу же запретила разработке ходить на локальный прокси `127.0.0.1:8317`.
 * Отказ был технически последователен и по существу неверен: обращение к петле
 * НЕ ПОКИДАЕТ контур, а значит не является тем, что §12.1л регулирует.
 *
 * Поэтому правила различаются по назначению:
 *
 *  · внутреннее назначение — петля или частная сеть. Шифрование не требуется
 *    (перехватывать нечего), анонимизация не требуется (данные не уходят);
 *  · внешнее назначение — только https и только обезличенные сведения.
 *
 * САМОЕ ВАЖНОЕ ЗДЕСЬ — ПРОВЕРКА САМОЙ МЕТКИ «ВНУТРЕННИЙ»
 *
 * Если бы шлюз верил слову манифеста, обход состоял бы из одной строки:
 * объявить `contour: "internal"` и указать внешний адрес — и вместе с меткой
 * отпали бы и https, и анонимизация. Поэтому назначения внутреннего маршрута
 * ПРОВЕРЯЮТСЯ на принадлежность петле или частной сети, а несоответствие
 * останавливает не запрос, а сборку.
 *
 * ЧЕГО ЭТОТ ШЛЮЗ НЕ ДЕЛАЕТ
 *
 * Он проверяет ИМЯ, а не адрес, в который имя разрешится. Расширение,
 * получившее право ходить на своё имя, может направить его куда угодно через
 * DNS. Закрывается это не здесь, а сетевой политикой контура (§6.2), и
 * записано в roadmap-fact как открытый пункт, а не как решённый.
 */
import type { DataClass, ExtensionManifest } from "@platform/extensions/manifest.js";
import { isConfidential } from "@platform/extensions/manifest.js";

import type { AnonymizeReceipt } from "./anonymizer.js";

export interface EgressRequest {
  readonly extensionId: string;
  readonly url: string;
  /** Классы данных, которые уходят с этим запросом. */
  readonly dataClasses: readonly DataClass[];
  /**
   * Расписка анонимизатора (§8.3), а НЕ флаг.
   *
   * Первая редакция принимала `anonymized: boolean`. Написать `true` руками
   * стоило ровно ничего, и §12.1л держался на том, что никто так не сделает.
   * Расписку выдаёт только анонимизатор и только после проверки собственного
   * вывода; она несёт отпечаток текста, к которому относится, — и адаптер
   * сверяет этот отпечаток с тем, что уходит на самом деле.
   */
  readonly anonymization?: AnonymizeReceipt;
}

/**
 * След решения для журнала (§12.1л).
 *
 * Содержит ИМЯ хоста, но не путь и не строку запроса: там идентификаторы
 * объектов и документов, а журнал отвечает на вопрос «куда ходили», а не «что
 * именно вынесли». Иначе журнал сам стал бы местом утечки — тем более что он
 * защищён от удаления и хранится дольше самих данных.
 */
export interface EgressRecord {
  readonly extensionId: string;
  /** Имя хоста в том виде, в каком оно разрешается, — в punycode. */
  readonly host: string;
  /**
   * Покинул ли запрос контур. Определяется ПО ИМЕНИ хоста, а не по метке
   * манифеста: журнал обращений (§12.1л) различает внутренние и внешние вызовы,
   * и метка, принятая на слово, сделала бы это различение фиктивным.
   */
  readonly contour: "internal" | "external";
  readonly allowed: boolean;
  readonly reason: string;
  readonly dataClasses: readonly DataClass[];
  readonly anonymized: boolean;
}

export type EgressDecision =
  | { readonly allowed: true; readonly host: string; readonly record: EgressRecord }
  | { readonly allowed: false; readonly reason: string; readonly record: EgressRecord };

/** Метка-разделитель имени хоста. Вынесена, чтобы правило было видно. */
const LABEL_SEPARATOR = ".";

/**
 * Суффиксы имён, которые по соглашению не выходят за пределы сети.
 *
 * `.local` и `.internal` не разрешаются в публичном DNS, поэтому назначение с
 * таким именем не может оказаться чужим сервером в интернете.
 */
const INTERNAL_SUFFIXES = [".local", ".internal"] as const;

/**
 * Живёт ли имя внутри контура.
 *
 * Проверяется НЕ на доверии к манифесту, а по самому имени: метка «внутренний»,
 * принимаемая на слово, была бы обходом всех остальных правил разом.
 */
export function isInternalHost(host: string): boolean {
  if (host === "localhost" || host === "::1" || host === "[::1]") return true;

  if (INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;

  const octets = host.split(LABEL_SEPARATOR);
  if (octets.length !== 4 || !octets.every((part) => /^\d{1,3}$/.test(part))) return false;

  const [a, b] = octets.map(Number) as [number, number, number, number];

  // RFC 1918 и петля. Диапазон 172 — только 16…31: писать `a === 172` целиком
  // значило бы отнести к частным сетям 172.32.x, которая публичная.
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;

  return false;
}

/**
 * Приводит объявленное назначение к тому же виду, что и хост из адреса.
 *
 * Разбирается через `URL`, а не через `toLowerCase()`: только так кириллическое
 * имя из манифеста и punycode из адреса окажутся сравнимы.
 */
function normalizeDestination(destination: string): { host: string; wildcard: boolean } | undefined {
  const wildcard = destination.startsWith("*.");
  const bare = wildcard ? destination.slice(2) : destination;

  try {
    const { hostname } = new URL(`https://${bare}`);
    return hostname === "" ? undefined : { host: hostname, wildcard };
  } catch {
    return undefined;
  }
}

/**
 * Совпадает ли хост с объявленным назначением.
 *
 * Точное назначение — полное равенство. Маска `*.домен` — только СОБСТВЕННЫЕ
 * поддомены: сам домен под неё не подпадает. Разница существенна: автор
 * манифеста, написавший `*.apri.local`, разрешил дочерние узлы, а не корневой,
 * и расширять это за него значит выдать разрешение, которого не давали.
 */
function hostMatches(host: string, declared: { host: string; wildcard: boolean }): boolean {
  if (declared.wildcard) {
    return host.endsWith(LABEL_SEPARATOR + declared.host);
  }

  return host === declared.host;
}

export class EgressGateway {
  private readonly manifests: ReadonlyMap<string, ExtensionManifest>;

  constructor(manifests: readonly ExtensionManifest[]) {
    this.manifests = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  }

  /**
   * Политика перенаправлений для транспорта.
   *
   * Значение годится для `fetch(url, { redirect: gateway.redirectPolicy() })`:
   * решение принимается здесь, а не оставляется на усмотрение вызывающего.
   */
  redirectPolicy(): "error" {
    return "error";
  }

  authorize(request: EgressRequest): EgressDecision {
    // Обезличено — значит расписка есть И она чистая. Расписка с остатком
    // означает, что анонимизатор нашёл в собственном выводе то, что должен
    // был убрать: это отказ, а не «почти обезличено».
    const anonymized = request.anonymization?.clean === true;

    const deny = (host: string, reason: string): EgressDecision => ({
      allowed: false,
      reason,
      record: {
        extensionId: request.extensionId,
        host,
        contour: host !== "" && isInternalHost(host) ? "internal" : "external",
        allowed: false,
        reason,
        dataClasses: request.dataClasses,
        anonymized,
      },
    });

    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      // Имени хоста нет — записывать в след нечего. Пустая строка честнее
      // подстановки самого адреса: он не разобран, и что в нём — неизвестно.
      return deny("", "адрес не разбирается как URL: выход не разрешён");
    }

    const host = url.hostname;

    const manifest = this.manifests.get(request.extensionId);
    if (manifest === undefined) {
      return deny(
        host,
        `расширение «${request.extensionId}» не зарегистрировано: выход запрещён (закрыто по умолчанию)`,
      );
    }

    // Метка манифеста ПРОВЕРЯЕТСЯ по самому имени, а не принимается на слово.
    // Иначе обход состоял бы из одной строки: объявить маршрут внутренним и
    // указать внешний адрес, разом отменив и https, и анонимизацию.
    const internalHost = isInternalHost(host);
    const declaredInternal = manifest.contour === "internal";

    if (declaredInternal && !internalHost) {
      return deny(
        host,
        `расширение «${manifest.id}» объявлено для внутреннего контура, но «${host}» ` +
          "не принадлежит петле или частной сети: выход наружу требует contour: \"external\"",
      );
    }

    // Шифрование обязательно там, где есть что перехватывать. Требовать https от
    // обращения к петле — не строгость, а запрет работать: это тот самый отказ,
    // на который налетела разработка с локальным прокси.
    if (!internalHost && url.protocol !== "https:") {
      return deny(
        host,
        `схема «${url.protocol.replace(":", "")}» не допускается: во внешний контур только https`,
      );
    }

    const declared = manifest.egress?.destinations ?? [];
    const normalized = declared
      .map(normalizeDestination)
      .filter((value): value is { host: string; wildcard: boolean } => value !== undefined);

    if (!normalized.some((destination) => hostMatches(host, destination))) {
      return deny(
        host,
        `назначение «${host}» не задекларировано расширением «${manifest.id}»` +
          (declared.length === 0 ? ": egress в манифесте не объявлен вовсе" : ""),
      );
    }

    // Манифест — не только разрешение, но и предел: расширение, объявившее
    // «object_meta», не выносит цены. Проверяется ДО анонимизации, потому что
    // отвечает на другой вопрос — не «можно ли выпускать эти сведения», а
    // «имеет ли это расширение к ним отношение».
    const undeclared = request.dataClasses.filter(
      (dataClass) => !manifest.dataClasses.includes(dataClass),
    );
    if (undeclared.length > 0) {
      return deny(
        host,
        `классы данных [${undeclared.join(", ")}] не объявлены манифестом расширения «${manifest.id}»`,
      );
    }

    // Анонимизация — требование к тому, что ПОКИДАЕТ контур. Данные, идущие на
    // локальную модель, его не покидают, и обезличивать их значило бы ухудшать
    // проверку ради правила, которое здесь неприменимо.
    const confidential = internalHost ? [] : request.dataClasses.filter(isConfidential);
    if (confidential.length > 0 && !anonymized) {
      return deny(
        host,
        `классы [${confidential.join(", ")}] не выпускаются в исходном виде (ТЗ §12.1л): ` +
          "требуется анонимизация и маскирование",
      );
    }

    const reason =
      `назначение задекларировано расширением «${manifest.id}», ` +
      `контур ${internalHost ? "внутренний" : "внешний"}, ` +
      `цель «${manifest.egress?.purpose ?? "не указана"}»`;

    return {
      allowed: true,
      host,
      record: {
        extensionId: request.extensionId,
        host,
        contour: internalHost ? "internal" : "external",
        allowed: true,
        reason,
        dataClasses: request.dataClasses,
        anonymized,
      },
    };
  }
}
