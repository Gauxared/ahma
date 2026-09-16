/**
 * Реестр агентов: способность → кто это и что он смотрит.
 *
 * ЗАЧЕМ ОН ПОНАДОБИЛСЯ
 *
 * Ядро различает девять агентов — `DocumentReviewOutcome.capability`
 * заполняется во всех трёх фазах обзора. Обе поверхности это теряли: командная
 * строка подставляла в записку `agent: "Людмила"` ВСЕМ девяти, а веб выбрасывал
 * `capability` при группировке. Находки Виктора выходили за подписью сметчика,
 * а шесть объектных агентов схлопывались в один псевдодокумент с именем папки.
 *
 * Причина у обоих дефектов одна: имени и роли агента не существовало КАК
 * ДАННЫХ. Каждая поверхность придумывала их заново — и придумывала по-своему.
 *
 * ПОЧЕМУ ЭТО КОНФИГ, А НЕ ТАБЛИЦА В КОДЕ
 *
 * `tooling/verify-architecture.ts` роняет сборку на файле, где встречается три
 * и более имени агента подряд: правило `n-ary-agents`, ADR-R-011. Таблица
 * «capability → Людмила» в TypeScript — ровно то, что оно запрещает, и
 * запрещает по делу: десятый агент добавляется манифестом, а не правкой
 * девяти мест.
 *
 * Поэтому реестр собирается из `config/agents/*_/manifest.json`, где уже лежат
 * `provides` (способность), `displayName` (роль) и `checklistId` (приёмка);
 * блок `roster` добавляет к ним имя человека, предмет и порядок в конвейере.
 *
 * ЧТО ПРОВЕРЯЕТСЯ НА СТАРТЕ, А НЕ НА ВЫГРУЗКЕ (ADR-R-014, fail closed)
 *
 * Каждая проверка ниже закрывает СВОЙ способ потерять агента молча:
 *
 *  · `roster.capability` не входит в `provides` того же манифеста — агент не
 *    найдётся по способности из артефакта и выпадет из книги. Именно так едва
 *    не потерялся Артемий: его манифест зовётся `verdict`, а способность
 *    называется `object_verdict`;
 *  · повтор способности или порядка — два агента займут одну строку;
 *  · `checklistId` без файла приёмки — лист «Компетенции» покажет «0 из 0», и
 *    это будет выглядеть как результат приёмки, а не как её отсутствие.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { loadBundle } from "./bundle-loader.js";
import type { LoadedBundle } from "./bundle-loader.js";

/** Что агент смотрит: одну смету, объект целиком или сказанное остальными. */
export type AgentScope = "документ" | "объект" | "синтез";

/** Кто стоит за способностью. */
export interface AgentIdentity {
  /** Идентификатор бандла: `finance-model`. */
  readonly id: string;
  /** Способность, как она лежит в артефакте: `finance_model`. */
  readonly capability: string;
  /** Имя: «Ваныч». */
  readonly person: string;
  /** Роль: «Эконом». */
  readonly role: string;
  readonly scope: AgentScope;
  /** Порядок в конвейере тактов. */
  readonly order: number;
  /** Чек-лист приёмки §12.2. */
  readonly checklistId: string;
  /** Где лежит опорная база. Отсутствует — агент работает в режиме [БЕЗ БАЗЫ]. */
  readonly referenceBase?: string;
  /**
   * Каркас роли: листы, которые агент обязан дать ПРИ ЛЮБОМ ОБЪЕКТЕ.
   *
   * Не список предметных листов книги — те агент выбирает сам по объекту, и
   * задавать их конфигурацией нельзя: «Контактная сеть: смета против физики»
   * осмысленна на железнодорожном переезде и бессмысленна на жилом доме, а
   * агент, обязанный такой лист заполнить, начнёт его выдумывать.
   *
   * Здесь только то, на что роль отвечает независимо от объекта: сметчик — про
   * сходимость смет, снабженец — про сроки поставки, договорник — про реестр
   * правовых рисков. Такой лист не может «не подойти объекту»: если данных по
   * нему нет, ответ роли — назвать, чего не хватило.
   */
  readonly requiredSections: readonly RequiredSectionSpec[];
}

/** Лист каркаса роли: что требуется и почему роль обязана это дать. */
export interface RequiredSectionSpec {
  readonly id: string;
  readonly title: string;
  /** Основание требования. Уходит в промпт: требование без причины не выполняют. */
  readonly why: string;
  /**
   * Шапка листа. Задаётся ролью, потому что от объекта не зависит и потому что
   * документный агент, смотрящий сметы по одной, придумал бы её на каждой
   * заново — а сведённая из разных шапок таблица состоит из прочерков.
   */
  readonly columns?: readonly string[];
}

/**
 * Схема манифеста агента.
 *
 * Намеренно НЕ наследует `extensionManifestSchema`: та не знает про
 * `displayName` и срезала бы его, а вместе с ним роль агента.
 */
export const agentManifestSchema = z.object({
  id: z.string().min(1),
  provides: z.array(z.string().min(1)).min(1),
  displayName: z.string().min(1),
  checklistId: z.string().min(1),
  /** Путь к опорной базе агента. Книги заказчика монтируются, а не входят в образ. */
  referenceBase: z.string().min(1).optional(),
  /**
   * Каркас роли. Отсутствие блока и пустой список значат одно и то же — «эта
   * роль листов не обязана давать», — и различать их незачем: обязательность
   * объявляется, а не выводится из умолчания.
   */
  requiredSections: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        why: z.string().min(1),
        columns: z.array(z.string().min(1)).min(1).optional(),
      }),
    )
    .default([]),
  roster: z.object({
    person: z.string().min(1),
    capability: z.string().min(1),
    scope: z.enum(["документ", "объект", "синтез"]),
    order: z.number().int().positive(),
  }),
});

export type AgentManifest = z.infer<typeof agentManifestSchema>;

export class AgentRoster {
  private readonly byCapability: ReadonlyMap<string, AgentIdentity>;

  constructor(private readonly identities: readonly AgentIdentity[]) {
    this.byCapability = new Map(identities.map((identity) => [identity.capability, identity]));
  }

  /** Все девять, в порядке конвейера. */
  all(): readonly AgentIdentity[] {
    return this.identities;
  }

  find(capability: string): AgentIdentity | undefined {
    return this.byCapability.get(capability);
  }

  /**
   * Отказ вместо подстановки «Неизвестный».
   *
   * Молчаливая подстановка — это ровно то, как восемь агентов стали Людмилой:
   * неверная подпись выглядит как результат и не вызывает вопросов.
   */
  require(capability: string): AgentIdentity {
    const identity = this.byCapability.get(capability);

    if (identity === undefined) {
      throw new Error(
        `Способность «${capability}» не найдена в реестре агентов. ` +
          `Известны: ${this.identities.map((entry) => entry.capability).join(", ")}. ` +
          "Добавьте блок roster в config/agents/<агент>/manifest.json.",
      );
    }

    return identity;
  }
}

/**
 * Читает реестр. `knownChecklists` — идентификаторы загруженных чек-листов
 * приёмки; пустой список отключает эту проверку (нужно тестам загрузчика).
 */
export function loadAgentRoster(
  directory: string,
  knownChecklists: readonly string[] = [],
): { readonly roster: AgentRoster; readonly bundles: readonly LoadedBundle<AgentManifest>[] } {
  const bundles = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => loadBundle(join(directory, name, "manifest.json"), agentManifestSchema));

  const identities: AgentIdentity[] = [];
  const seenCapability = new Map<string, string>();
  const seenOrder = new Map<number, string>();

  for (const bundle of bundles) {
    const manifest = bundle.value;
    const { person, capability, scope, order } = manifest.roster;

    if (!manifest.provides.includes(capability)) {
      throw new Error(
        `Агент «${manifest.id}»: roster.capability = «${capability}», ` +
          `но provides = [${manifest.provides.join(", ")}]. ` +
          "Агент не нашёлся бы по способности из артефакта и выпал бы из выгрузки.",
      );
    }

    const capabilityTwin = seenCapability.get(capability);
    if (capabilityTwin !== undefined) {
      throw new Error(
        `Способность «${capability}» объявлена дважды: «${capabilityTwin}» и «${manifest.id}».`,
      );
    }
    seenCapability.set(capability, manifest.id);

    const orderTwin = seenOrder.get(order);
    if (orderTwin !== undefined) {
      throw new Error(
        `Порядок ${order} занят дважды: «${orderTwin}» и «${manifest.id}». ` +
          "Два агента встали бы на одну строку выгрузки.",
      );
    }
    seenOrder.set(order, manifest.id);

    if (knownChecklists.length > 0 && !knownChecklists.includes(manifest.checklistId)) {
      throw new Error(
        `Агент «${manifest.id}» ссылается на чек-лист «${manifest.checklistId}», ` +
          `которого нет среди загруженных (${knownChecklists.join(", ")}). ` +
          "Приёмка §12.2 показала бы «0 из 0» — это выглядит как результат, а не как его отсутствие.",
      );
    }

    identities.push({
      id: manifest.id,
      capability,
      person,
      role: manifest.displayName,
      scope,
      order,
      checklistId: manifest.checklistId,
      // Шапка листа необязательна в схеме, а `exactOptionalPropertyTypes`
      // отличает «ключа нет» от «ключ со значением undefined»: второе означало
      // бы «шапка задана и пуста».
      requiredSections: manifest.requiredSections.map((section) => ({
        id: section.id,
        title: section.title,
        why: section.why,
        ...(section.columns === undefined ? {} : { columns: section.columns }),
      })),
      ...(manifest.referenceBase === undefined ? {} : { referenceBase: manifest.referenceBase }),
    });
  }

  identities.sort((a, b) => a.order - b.order);

  return { roster: new AgentRoster(identities), bundles };
}
