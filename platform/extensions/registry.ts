/**
 * Реестр расширений (ADR-R-017, ADR-R-023).
 *
 * Поведение fail-closed: расширение, чей манифест невалиден, несовместим по
 * мажорной версии контракта или дублирует существующий идентификатор, НЕ
 * регистрируется. Молчаливый пропуск запрещён — иначе система тихо теряет
 * функциональность и обнаруживает это на приёмке.
 *
 * Сознательно НЕ реализовано (ADR-R-028): песочница для расширений, горячая
 * загрузка, отдельный протокол между ядром и расширением. Расширение — это
 * обычный модуль в процессе, регистрируемый при старте.
 */
import { isCompatibleContract } from "@contracts/index.js";
import type { ExtensionKind, ExtensionManifest, DataClass } from "./manifest.js";
import { isConfidential } from "./manifest.js";

export class ExtensionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtensionError";
  }
}

export interface RegisteredExtension<T = unknown> {
  readonly manifest: ExtensionManifest;
  readonly implementation: T;
}

/**
 * РЕШЕНИЕ О ВЫХОДЕ НАРУЖУ ЗДЕСЬ БОЛЬШЕ НЕ ПРИНИМАЕТСЯ.
 *
 * До 02.09.2026 у реестра был собственный `checkEgress`: он сверял назначение
 * с декларацией манифеста и не пускал конфиденциальные классы во внешний контур.
 * Его вытеснил `platform/security/egress-gateway.ts` (О-67), и держать оба
 * оказалось опаснее, чем один.
 *
 * ПОЧЕМУ ИМЕННО ОПАСНЕЕ
 *
 * Старая проверка сравнивала назначения `destinations.includes(destination)` —
 * сырыми строками. Ни разбора имени хоста, ни приведения к punycode, ни маски
 * поддоменов, ни требования https, ни проверки метки «внутренний контур». То
 * есть она пропускала `storhaus.apri.local.злоумышленник.рф`, если его туда
 * передали, и не замечала кириллического имени, записанного в манифесте.
 *
 * Два механизма на одну задачу хуже одного даже когда оба работают: следующий
 * вызывающий возьмёт тот, который найдёт первым, и решит, что выход проверен.
 * Здесь же второй был вдобавок слабее.
 *
 * Реестр остался тем, чем должен быть: хранилищем манифестов. Решение о выходе
 * принимает шлюз, читающий те же манифесты.
 */

export class ExtensionRegistry {
  readonly #byKind = new Map<ExtensionKind, Map<string, RegisteredExtension>>();

  register<T>(manifest: ExtensionManifest, implementation: T): void {
    if (!isCompatibleContract(manifest.implements)) {
      throw new ExtensionError(
        `Расширение ${manifest.kind}:${manifest.id} объявляет контракт ${manifest.implements}, ` +
          "несовместимый с текущей мажорной версией ядра. Регистрация отклонена.",
      );
    }

    if (manifest.contour === "external" && manifest.egress === undefined) {
      throw new ExtensionError(
        `Расширение ${manifest.kind}:${manifest.id} объявлено внешним, но не декларирует egress. ` +
          "Внешнее расширение без декларации назначений не регистрируется (ТЗ §8.3).",
      );
    }

    const bucket = this.#byKind.get(manifest.kind) ?? new Map<string, RegisteredExtension>();

    if (bucket.has(manifest.id)) {
      throw new ExtensionError(`Расширение ${manifest.kind}:${manifest.id} уже зарегистрировано`);
    }

    bucket.set(manifest.id, { manifest, implementation });
    this.#byKind.set(manifest.kind, bucket);
  }

  get<T>(kind: ExtensionKind, id: string): RegisteredExtension<T> | undefined {
    return this.#byKind.get(kind)?.get(id) as RegisteredExtension<T> | undefined;
  }

  require<T>(kind: ExtensionKind, id: string): RegisteredExtension<T> {
    const found = this.get<T>(kind, id);
    if (found === undefined) {
      throw new ExtensionError(`Расширение ${kind}:${id} не зарегистрировано`);
    }
    return found;
  }

  all(kind: ExtensionKind): readonly RegisteredExtension[] {
    return [...(this.#byKind.get(kind)?.values() ?? [])];
  }

  ids(kind: ExtensionKind): readonly string[] {
    return [...(this.#byKind.get(kind)?.keys() ?? [])];
  }

}
