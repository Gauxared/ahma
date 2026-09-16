/**
 * Анонимизация и маскирование перед выходом наружу — ТЗ §8.3, §11, §12.1л.
 *
 * ЧТО ЭТО ЗАКРЫВАЕТ
 *
 * Egress-шлюз требует обезличивания, но принимал его как утверждение
 * вызывающего: `anonymized: true`. Здесь расписка перестаёт быть распиской —
 * её выдаёт анонимизатор, и выдаёт только после проверки собственного вывода.
 *
 * ЗАМЕНА, А НЕ УДАЛЕНИЕ
 *
 * Модель возвращает замечания, ссылающиеся на участников. Вырезав название, мы
 * получим замечание, которое не к кому отнести. Поэтому имена ЗАМЕЩАЮТСЯ
 * устойчивыми псевдонимами, а карта замен остаётся внутри контура.
 *
 * СПРЯТАТЬ СЛИШКОМ МНОГО — ТОЖЕ ОШИБКА, И ОНА НЕЗАМЕТНЕЕ
 *
 * «Устройство подстилающего слоя из щебня» — не сведения о заказчике, а сам
 * предмет проверки. Анонимизатор, замещающий и это, выполнит §11 и уничтожит
 * §5.2: наружу уйдёт текст, по которому нельзя ничего проверить, а выглядеть
 * это будет как успешное обезличивание. Поэтому замещается не «всё похожее на
 * имя», а объявленные сущности и узкий набор реквизитов.
 *
 * ДВА ИСТОЧНИКА, И ОНИ НЕ ВЗАИМОЗАМЕНЯЕМЫ
 *
 *  · СЛОВАРЬ — то, что система знает: названия из разобранных предложений, имя
 *    заказчика, наименование объекта. Здесь полнота достижима.
 *  · СЕТЬ — реквизиты по образцу: ИНН, ОГРН, КПП, почта, организация в
 *    кавычках. Здесь полнота недостижима, и сеть нужна ровно для того, что в
 *    словарь не попало.
 *
 * СКЛОНЕНИЕ — ГЛАВНАЯ ЛОВУШКА РУССКОГО ТЕКСТА
 *
 * `replaceAll("Оргэнергострой", …)` выглядит работающим и пропускает «договор
 * с Оргэнергостроем» и «письмо Оргэнергостроя». Пропущенное название — это
 * утечка, а текст после замены выглядит обезличенным.
 *
 * Поэтому сопоставление идёт по ПРЕФИКСУ, а не по стеммингу: у собственных
 * имён склонение меняет только окончание, а стеммер, обученный на нарицательных
 * («слой», «щебень»), на «Оргэнергострой» даёт непредсказуемый корень.
 *
 * ПРОВЕРКА СОБСТВЕННОГО ВЫВОДА — ТО, РАДИ ЧЕГО ВСЁ ОСТАЛЬНОЕ
 *
 * Ошибка анонимизатора не видна: пропущенное имя ничем не отличается от текста,
 * где имени и не было. Поэтому вывод перечитывается заново, ДРУГИМ способом —
 * простым поиском подстроки вместо разбора на слова. Совпадать в слепых пятнах
 * проверка и замена не должны, иначе проверка подтвердит ровно то, что замена
 * пропустила.
 */
import { createHash } from "node:crypto";

import { normalizeRussian } from "@contracts/index.js";

/**
 * Что и каким родом замещать.
 *
 * Род существен. Первая редакция называла ВСЁ «Организация-N», и код объекта
 * «КРГ-1» уходил к модели как «Организация-6287»: модели сообщали, что объект —
 * это компания, и она рассуждала бы об участнике там, где речь о стройке.
 * Псевдоним, скрывающий имя, не должен подменять род.
 */
export type KnownEntity = string | { readonly value: string; readonly kind: string };

export interface AnonymizeInput {
  readonly text: string;
  /** Названия, известные системе: подрядчики из предложений, заказчик, объект. */
  readonly knownEntities: readonly KnownEntity[];
  /**
   * Соль прогона. Разные прогоны обязаны давать разные псевдонимы одному
   * названию: устойчивый между прогонами псевдоним позволил бы внешней стороне
   * сопоставлять обращения и узнавать подрядчика по объёмам.
   */
  readonly salt: string;
  /** Только проверить, не замещая. Нужен, чтобы испытать саму проверку. */
  readonly dryRun?: boolean;
}

/**
 * Расписка об обезличивании.
 *
 * Относится к КОНКРЕТНОМУ тексту — отсюда отпечаток. Расписка без отпечатка
 * прикладывалась бы к любому тексту, и §12.1л снова стал бы обещанием.
 */
export interface AnonymizeReceipt {
  readonly clean: boolean;
  readonly replacements: number;
  /** Что осталось в тексте после замены. Пусто, когда `clean`. */
  readonly leftovers: readonly string[];
  readonly outputDigest: string;
}

export interface AnonymizeResult {
  readonly text: string;
  /** Псевдоним → исходное название. Не покидает контур. */
  readonly map: ReadonlyMap<string, string>;
  readonly receipt: AnonymizeReceipt;
}

const DEFAULT_KIND = "Организация";

function valueOf(entity: KnownEntity): string {
  return typeof entity === "string" ? entity : entity.value;
}

function kindOf(entity: KnownEntity): string {
  return typeof entity === "string" ? DEFAULT_KIND : entity.kind;
}

/**
 * Границы слова для кириллицы.
 *
 * `\b` здесь НЕ РАБОТАЕТ: он определён через `\w`, то есть `[A-Za-z0-9_]`, и
 * кириллицы не видит вовсе. `/\bИНН/u` не совпадает с «ИНН 5024185328» даже в
 * начале строки — вся сеть молча не срабатывала, а тесты на замену объявленных
 * названий при этом проходили.
 */
const LEFT = "(?<![\\p{L}\\p{N}])";
const RIGHT = "(?![\\p{L}\\p{N}])";

/** Реквизиты по образцу — сеть для того, чего нет в словаре. */
const PATTERNS: readonly { readonly id: string; readonly re: RegExp }[] = [
  // Ключевое слово обязательно: голое десятизначное число в смете — чаще
  // объём или цена, чем ИНН, и замещать его значило бы портить расчёт.
  { id: "ИНН", re: new RegExp(`${LEFT}ИНН[:\\s]*\\d{10,12}${RIGHT}`, "giu") },
  { id: "ОГРН", re: new RegExp(`${LEFT}ОГРНИ?П?[:\\s]*\\d{13,15}${RIGHT}`, "giu") },
  { id: "КПП", re: new RegExp(`${LEFT}КПП[:\\s]*\\d{9}${RIGHT}`, "giu") },
  { id: "БИК", re: new RegExp(`${LEFT}БИК[:\\s]*\\d{9}${RIGHT}`, "giu") },
  { id: "почта", re: /[\p{L}\p{N}._+-]+@[\p{L}\p{N}-]+\.[\p{L}\p{N}.-]{2,}/gu },
  { id: "телефон", re: /\+7[\s(-]?\d{3}[\s)-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/gu },
  // Организация в кавычках: название подрядчика может впервые встретиться
  // в самом документе и в словарь попасть не успеть.
  {
    id: "организация",
    re: new RegExp(`${LEFT}(?:ПАО|ОАО|ЗАО|АО|ООО|ИП|ГК|МУП|ГУП|ФГУП)\\s*«[^»]{2,80}»`, "gu"),
  },
];

/**
 * Ядро названия: то, что склоняется.
 *
 * «АО «Оргэнергострой»» → «Оргэнергострой». Организационная форма и кавычки
 * отбрасываются: склоняется именно название.
 */
function coreOf(entity: string): string {
  const quoted = entity.match(/«([^»]+)»|"([^"]+)"/u);
  if (quoted !== null) return (quoted[1] ?? quoted[2] ?? entity).trim();

  return entity.replace(/^(?:ПАО|ОАО|ЗАО|АО|ООО|ИП|ГК|МУП|ГУП|ФГУП)\s+/iu, "").trim();
}

/**
 * Неизменяемая часть названия.
 *
 * У собственных имён склонение меняет только окончание, поэтому отбрасываем три
 * последних знака — но не короче четырёх: у «МОДЦ» отбрасывать нечего, и
 * префикс в один знак совпал бы с половиной текста.
 */
function stableStem(core: string): string {
  return core.slice(0, Math.max(4, core.length - 3));
}

/**
 * Номер псевдонима.
 *
 * Выводится из соли и названия, а не из порядка появления: порядок одинаков во
 * всех прогонах, и «Организация-1» стала бы устойчивым обозначением одного и
 * того же подрядчика во внешнем контуре.
 */
function pseudonymNumber(salt: string, entity: string, taken: ReadonlySet<number>): number {
  const digest = createHash("sha256").update(`${salt} ${entity}`, "utf8").digest();
  let value = (digest.readUInt32BE(0) % 9000) + 1000;

  // Столкновение двух названий сделало бы их в глазах модели одним участником.
  while (taken.has(value)) value = value === 9999 ? 1000 : value + 1;

  return value;
}

/**
 * Ищет склоняемые формы названия и заменяет их.
 *
 * Слово считается формой названия, если начинается с неизменяемой части и не
 * длиннее её больше чем на четыре знака: «Оргэнергостроем» — форма,
 * «Оргэнергостроительство» — уже другое слово.
 */
function replaceDeclined(text: string, core: string, pseudonym: string): { text: string; hits: number } {
  const stem = stableStem(core);
  const normalizedStem = normalizeRussian(stem);
  let hits = 0;

  const result = text.replace(/[\p{L}\p{N}-]+/gu, (word) => {
    const normalized = normalizeRussian(word);

    if (!normalized.startsWith(normalizedStem)) return word;
    if (word.length > core.length + 4) return word;

    hits += 1;
    return pseudonym;
  });

  return { text: result, hits };
}

export function anonymize(input: AnonymizeInput): AnonymizeResult {
  const map = new Map<string, string>();
  const taken = new Set<number>();
  let text = input.text;
  let replacements = 0;

  const pseudonymFor = (entity: string, kind = DEFAULT_KIND): string => {
    for (const [alias, original] of map) if (original === entity) return alias;

    const number = pseudonymNumber(input.salt, entity, taken);
    taken.add(number);

    const alias = `${kind}-${number}`;
    map.set(alias, entity);

    return alias;
  };

  if (input.dryRun !== true) {
    // Сначала объявленное целиком — «АО «Оргэнергострой»», — чтобы обратная
    // развёртка вернула ту форму, в которой название и было записано.
    for (const declared of input.knownEntities) {
      const entity = valueOf(declared);
      const alias = pseudonymFor(entity, kindOf(declared));
      const before = text;
      text = text.split(entity).join(alias);

      if (before !== text) replacements += 1;
    }

    // Затем ядро в любом падеже — то, что осталось после первого прохода.
    for (const declared of input.knownEntities) {
      const entity = valueOf(declared);
      const core = coreOf(entity);
      if (core === "") continue;

      const alias = pseudonymFor(entity, kindOf(declared));
      const { text: replaced, hits } = replaceDeclined(text, core, alias);

      text = replaced;
      replacements += hits;
    }

    // Сеть для необъявленного. Идёт последней: объявленное уже замещено, и
    // сеть не станет заводить второй псевдоним тому же участнику.
    for (const { id, re } of PATTERNS) {
      text = text.replace(re, (match) => {
        const alias = pseudonymFor(match);
        replacements += 1;
        return id === "организация" ? alias : `${id}-скрыт`;
      });
    }
  }

  // Псевдонимы, оставшиеся без единого вхождения, из карты убираются: карта —
  // это то, что предстоит развернуть обратно, а не перечень известных имён.
  for (const [alias] of map) {
    if (!text.includes(alias)) map.delete(alias);
  }

  const leftovers = findLeftovers(text, input.knownEntities);

  return {
    text,
    map,
    receipt: {
      clean: leftovers.length === 0,
      replacements,
      leftovers,
      outputDigest: createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16),
    },
  };
}

/**
 * Перечитывает вывод и ищет остаток.
 *
 * Намеренно ДРУГИМ способом, чем замена: простой поиск подстроки вместо разбора
 * на слова. Совпадай проверка с заменой в устройстве, она подтверждала бы ровно
 * то, что замена пропустила, — и была бы не проверкой, а её отражением.
 */
export function findLeftovers(text: string, knownEntities: readonly KnownEntity[]): readonly string[] {
  const normalized = normalizeRussian(text);
  const found: string[] = [];

  for (const declared of knownEntities) {
    const core = coreOf(valueOf(declared));
    if (core === "") continue;

    // Ищем неизменяемую часть, а не название целиком: «Оргэнергострой» не
    // является подстрокой «Оргэнергостроем», и проверка на полное имя
    // пропустила бы ровно тот случай, ради которого затевалась.
    const stem = normalizeRussian(stableStem(core));

    if (stem !== "" && normalized.includes(stem)) found.push(core);
  }

  for (const { id, re } of PATTERNS) {
    // Флаг `g` делает регулярное выражение stateful — новый экземпляр на каждый
    // проход. Иначе `lastIndex` от прошлого вызова пропустил бы совпадение.
    if (new RegExp(re.source, re.flags).test(text)) found.push(id);
  }

  return found;
}

/**
 * Разворачивает псевдонимы обратно.
 *
 * Применяется и к исходнику, и к ответу модели: замечание «Организация-4721
 * завысила объём» человеку заказчика бесполезно.
 *
 * Возвращается ОБЪЯВЛЕННАЯ форма названия. Для косвенного падежа это значит
 * именительный вместо творительного — грамматически хуже, фактически верно;
 * хранить форму каждого вхождения значило бы завести по псевдониму на вхождение
 * и лишить модель возможности понять, что это один и тот же участник.
 */
export function restore(text: string, map: ReadonlyMap<string, string>): string {
  let result = text;

  for (const [alias, original] of map) {
    result = result.split(alias).join(original);
  }

  return result;
}

/**
 * Разворачивает псевдонимы во всех строках разобранного ответа модели.
 *
 * Обходит структуру, а не сериализованный JSON: подстановка в текст JSON
 * сломала бы разбор на названии с кавычкой внутри. Такие названия есть —
 * в корпусе заказчика организации записаны как «АО «МОДЦ»».
 */
export function restoreDeep(value: unknown, map: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return restore(value, map);
  if (Array.isArray(value)) return value.map((item) => restoreDeep(item, map));

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, restoreDeep(item, map)]),
    );
  }

  return value;
}
