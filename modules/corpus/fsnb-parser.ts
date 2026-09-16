/**
 * Разбор федеральной сметно-нормативной базы ФСНБ-2022 (ГЭСН, ФЕР, ФССЦ).
 *
 * Источник — официальный набор открытых данных ФГИС ЦС
 * (`/api/opendata`, набор «ФСНБ-2022», владелец ФАУ «Главгосэкспертиза России»).
 * Это государственный справочник, публикуемый приказами Минстроя и выложенный
 * для машинного использования.
 *
 * Почему разбор потоковый, а не через DOM: файлы базы — до 80 МБ каждый, всего
 * 165 МБ. Полная объектная модель такого XML съедает несколько гигабайт, а нам
 * нужны три атрибута на норму.
 *
 * Структура источника:
 *
 *   <ResourceCategory CodePrefix="ГЭСНм">
 *     <Section Type="Таблица" Code="01-01-001">
 *       <NameGroup BeginName="Станок в собранном виде: токарный">
 *         <Work Code="01-01-001-01" EndName="от 1,1 до 2 т" MeasureUnit="шт">
 *           <Resources><Resource Code="1-100-38" EndName="…"/></Resources>
 *
 * Наименование нормы собирается из `BeginName` группы и `EndName` самой нормы:
 * в источнике общая часть вынесена в группу, чтобы не повторяться.
 *
 * Ловушка: у `<Resource>` те же атрибуты `Code` и `EndName`, что у `<Work>`.
 * Ресурсов в базе на порядок больше, чем норм, и наивный разбор по атрибутам
 * дал бы каталог из расходников вместо расценок.
 */

/** Запись каталога сметных цен. Форма совпадает с нормой — их сводят в один каталог. */
export type FsbcEntry = FsnbEntry;

export interface FsnbEntry {
  /** Префикс системы: ГЭСН, ГЭСНм, ФЕР, ФЕРр и далее. */
  readonly system: string;
  readonly code: string;
  readonly name: string;
  readonly unit: string;
}

/** Запись каталога ресурсов ФСБЦ: у неё есть `Name`, в отличие от ссылки-расхода. */
const FSBC_RESOURCE = /<Resource\b([^>]*)>/g;
const FSBC_ATTR = /\b(Code|Name|MeasureUnit)="([^"]*)"/g;

const CATEGORY = /<ResourceCategory\b[^>]*\bCodePrefix="([^"]*)"/g;
const NAME_GROUP = /<NameGroup\b[^>]*\bBeginName="([^"]*)"/g;
/** Именно `<Work`, а не `<Resource`: см. ловушку в шапке модуля. */
const WORK = /<Work\b([^>]*)>/g;
const ATTR = /\b(Code|EndName|MeasureUnit)="([^"]*)"/g;

const ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
};

function decode(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

interface Marker {
  readonly index: number;
  readonly kind: "category" | "group" | "work";
  readonly value: string;
}

/**
 * Разбирает фрагмент базы.
 *
 * Работает по позициям в тексте, а не по вложенности: элементы обрабатываются
 * в порядке появления, поэтому текущие категория и группа наименований всегда
 * те, что встретились последними перед нормой. Для этого формата этого
 * достаточно, и такой разбор не требует держать документ в памяти.
 */
export function parseFsnbChunk(xml: string): readonly FsnbEntry[] {
  if (xml === "") return [];

  const markers: Marker[] = [];

  for (const match of xml.matchAll(CATEGORY)) {
    markers.push({ index: match.index, kind: "category", value: match[1] ?? "" });
  }
  for (const match of xml.matchAll(NAME_GROUP)) {
    markers.push({ index: match.index, kind: "group", value: match[1] ?? "" });
  }
  for (const match of xml.matchAll(WORK)) {
    markers.push({ index: match.index, kind: "work", value: match[1] ?? "" });
  }

  markers.sort((a, b) => a.index - b.index);

  const entries: FsnbEntry[] = [];
  let system = "";
  let beginName = "";

  for (const marker of markers) {
    if (marker.kind === "category") {
      system = marker.value;
      beginName = "";
      continue;
    }

    if (marker.kind === "group") {
      beginName = decode(marker.value);
      continue;
    }

    const attributes: Record<string, string> = {};
    for (const attribute of marker.value.matchAll(ATTR)) {
      attributes[attribute[1] ?? ""] = decode(attribute[2] ?? "");
    }

    const code = attributes["Code"];
    if (code === undefined || code === "") continue;

    const endName = attributes["EndName"] ?? "";
    const name = beginName === "" ? endName : `${beginName} ${endName}`.trim();

    entries.push({
      system,
      code,
      name,
      unit: attributes["MeasureUnit"] ?? "",
    });
  }

  return entries;
}

/**
 * Разбирает ФСБЦ — сметные цены материалов, оборудования и эксплуатации машин.
 *
 * Формат отличается от ГЭСН: наименование лежит целиком в `Name`, а не собирается
 * из группы и окончания, и корень документа — `<ResourceCatalog>`, а не `<base>`.
 *
 * Ловушка, обратная той, что в `parseFsnbChunk`: там `<Resource>` — это РАСХОД
 * внутри нормы, и его надо игнорировать; здесь `<Resource>` — сама запись
 * каталога, и игнорировать надо уже `<Work>`. Различаются они атрибутом `Name`:
 * у записи каталога есть собственное наименование, а у расхода — только `EndName`
 * со ссылкой и `Quantity`.
 *
 * Все три категории источника (материалы, оборудование, машины) относятся к
 * одной системе ФСБЦ: именно так шифр записан в реальной смете —
 * «ФСБЦ-08.3.05.02-0021», а не по категориям.
 */
export function parseFsbcChunk(xml: string): readonly FsbcEntry[] {
  if (xml === "") return [];

  const entries: FsbcEntry[] = [];

  for (const match of xml.matchAll(FSBC_RESOURCE)) {
    const attributes: Record<string, string> = {};
    for (const attribute of (match[1] ?? "").matchAll(FSBC_ATTR)) {
      attributes[attribute[1] ?? ""] = decode(attribute[2] ?? "");
    }

    const code = attributes["Code"];
    const name = attributes["Name"];

    // Без `Name` это ссылка на ресурс внутри нормы, а не запись каталога.
    if (code === undefined || code === "" || name === undefined || name === "") continue;

    entries.push({ system: "ФСБЦ", code, name, unit: attributes["MeasureUnit"] ?? "" });
  }

  return entries;
}
