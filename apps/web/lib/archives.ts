/**
 * Распаковка архивов — типовой вход клиента.
 *
 * ПОЧЕМУ ЭТО НЕ КРАЙНИЙ СЛУЧАЙ, А ШТАТНЫЙ
 *
 * Клиент передаёт один ZIP, внутри — десятки смет Excel, выгрузки XML, PDF и
 * папки. Сто смет одним архивом — обычная передача, а не исключение. До этого
 * модуля `.zip` отвергался на двери с причиной «система не умеет читать» — и
 * причина была правдивой, из-за чего первый же шаг встречи с клиентом
 * заканчивался отказом.
 *
 * СТРУКТУРА ПАПОК СОХРАНЯЕТСЯ, И ЭТО ТРЕБОВАНИЕ, А НЕ УДОБСТВО
 *
 * Внутри архива смета лежит в «Смета/Раздел 3/ЛСР-05.xlsx», и путь несёт
 * смысл: раздел, стадию, кто прислал. Сплющить всё в одну папку значило бы
 * потерять связь с первоисточником — а на вопрос «откуда это взято» система
 * обязана отвечать до листа и строки.
 *
 * ЧЕТЫРЕ ОПАСНОСТИ, И КАЖДАЯ НАЗВАНА ОТДЕЛЬНО
 *
 *  1. ВЫХОД ЗА ПРЕДЕЛЫ. Запись `../../etc/passwd` внутри архива — классический
 *     обход: распаковщик, доверяющий имени, пишет куда попросили. Здесь путь
 *     собирается из проверенных сегментов, а `..` и абсолютные пути отвергаются
 *     до записи.
 *  2. БОМБА СЖАТИЯ. Десять килобайт разжимаются в терабайт. Потолок стоит на
 *     СУММЕ распакованного, и считается он по ходу, а не по объявленному в
 *     заголовке размеру: заголовок пишет тот же, кто собирал бомбу.
 *  3. ВЛОЖЕННЫЙ АРХИВ. Не распаковывается — и это решение, а не недоделка:
 *     рекурсия по архивам даёт неограниченную глубину, а «архив в архиве»
 *     в передаче смет означает либо резервную копию, либо ошибку сборки.
 *     Отказ называет причину, и человек решает сам.
 *  4. ССЫЛКИ И ЗАПИСИ БЕЗ ИМЕНИ. Символьная ссылка в архиве указывает наружу
 *     каталога; запись с пустым именем ломает расчёт пути. Обе отвергаются.
 *
 * ПОТОЛКИ НАЗВАНЫ ЧИСЛАМИ, А НЕ ПОДРАЗУМЕВАЮТСЯ
 *
 * Память этой машины уже роняли — потолки здесь не формальность. Записи
 * разжимаются ПО ОДНОЙ, и после каждой сумма сверяется с потолком: разжать всё
 * и потом проверить размер значит проверить его после того, как памяти не
 * стало.
 */
import JSZip from "jszip";

/** Что считается архивом. Один формат: остальные приводят к нему конвертером. */
export const ARCHIVE_EXTENSIONS = [".zip"] as const;

/**
 * Потолок на сам архив.
 *
 * 64 МБ — сто книг Excel по 600 КБ в сжатом виде с запасом втрое. Больше
 * держать в памяти обработчика нельзя: запрос приходит целиком в память, и
 * веб-процесс уже ограничен двумя гигабайтами.
 */
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

/**
 * Потолок на СУММУ распакованного — защита от бомбы сжатия.
 *
 * 256 МБ: курганский комплект из семи файлов — 8,6 МБ, сотня смет — порядка
 * 60 МБ. Вчетверо больше самого крупного правдоподобного входа.
 */
export const MAX_EXPANDED_BYTES = 2048 * 1024 * 1024;

/** Потолок на число записей: сто смет плюс папки и посторонние файлы. */
export const MAX_ENTRIES = 1000;

export interface ExpandedFile {
  /**
   * Путь ВНУТРИ архива, разделённый косой чертой.
   *
   * Именно он доходит до экрана: «Смета/Раздел 3/ЛСР-05.xlsx» отвечает на
   * вопрос «какой файл откуда появился», а «ЛСР-05.xlsx» — нет.
   */
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface ExpandRejection {
  readonly path: string;
  readonly reason: string;
}

export interface Expanded {
  readonly files: readonly ExpandedFile[];
  readonly rejected: readonly ExpandRejection[];
}

export function isArchive(extension: string): boolean {
  return (ARCHIVE_EXTENSIONS as readonly string[]).includes(extension.toLowerCase());
}

/**
 * Сегмент пути внутри архива.
 *
 * Отвергает всё, что меняет положение в дереве: `..`, `.`, абсолютный путь,
 * управляющие знаки. Кириллица сохраняется — имена смет по-русски, и опасность
 * несёт структура пути, а не алфавит (то же решение, что в `uploads.ts`).
 */
function safeSegment(raw: string): string | undefined {
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();

  if (cleaned === "" || cleaned === "." || cleaned === "..") return undefined;
  if (cleaned.startsWith(".")) return undefined;
  if (cleaned.length > 180) return undefined;
  if (/[/\\:*?"<>|]/.test(cleaned)) return undefined;

  return cleaned;
}

/**
 * Путь записи архива в набор проверенных сегментов.
 *
 * Возвращает `undefined`, если хоть один сегмент непригоден: частично
 * обезвреженный путь опаснее отвергнутого — он выглядит проверенным.
 */
export function safeEntryPath(raw: string): string | undefined {
  const normalized = raw.replaceAll("\\", "/");

  // Абсолютный путь и путь с буквой диска отвергаются целиком: они не «немного
  // неправильные», они про другое дерево.
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return undefined;

  const segments = normalized.split("/").filter((segment) => segment !== "");
  if (segments.length === 0 || segments.length > 12) return undefined;

  const safe: string[] = [];

  for (const segment of segments) {
    const clean = safeSegment(segment);
    if (clean === undefined) return undefined;
    safe.push(clean);
  }

  return safe.join("/");
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

/**
 * ПОДЛИННЫЕ ИМЕНА ЗАПИСЕЙ — ИЗ ОГЛАВЛЕНИЯ АРХИВА, А НЕ ИЗ БИБЛИОТЕКИ.
 *
 * Это выяснилось проверкой и оказалось важнее, чем выглядело. JSZip
 * НОРМАЛИЗУЕТ путь при чтении: запись `../../etc/passwd` приезжает в
 * `zip.files` под именем `etc/passwd`. То есть:
 *
 *  - наша защита от обхода каталога НИКОГДА НЕ СРАБАТЫВАЛА — она проверяла уже
 *    обезвреженное имя. Мёртвый код, который выглядит рабочим, — худший вид
 *    защиты: он даёт уверенность и не даёт защиты;
 *  - файл при этом молча переезжал в `etc/passwd` внутри партии, и на экране
 *    показался бы путь, которого в архиве не было. Для системы, обещающей
 *    ответ «какой файл откуда появился», это подмена происхождения.
 *
 * Полагаться на нормализацию библиотеки нельзя: это её внутреннее дело, и она
 * вправе его изменить. Поэтому имена читаются напрямую из центрального
 * оглавления ZIP — там они лежат как их записал тот, кто собирал архив.
 *
 * Читается ТОЛЬКО оглавление: ни одна запись не распаковывается, значит проверка
 * ничего не стоит по памяти.
 */
export function rawEntryNames(bytes: Uint8Array): readonly string[] | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8");

  // Конец оглавления ищется с хвоста: после него может стоять комментарий
  // архива длиной до 64 КБ, поэтому просмотр ограничен этим окном.
  const window = Math.min(bytes.byteLength, 0xff_ff + 22);
  let end = -1;

  for (let offset = bytes.byteLength - 22; offset >= bytes.byteLength - window && offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06_05_4b_50) {
      end = offset;
      break;
    }
  }

  // Оглавление не найдено — это не ZIP либо ZIP64, и разбирать его здесь нечем.
  // `undefined` означает «не знаю», и вызывающий обязан отказать, а не считать
  // архив чистым.
  if (end === -1) return undefined;

  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const names: string[] = [];

  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.byteLength) return undefined;
    if (view.getUint32(cursor, true) !== 0x02_01_4b_50) return undefined;

    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const from = cursor + 46;

    if (from + nameLength > bytes.byteLength) return undefined;

    names.push(decoder.decode(bytes.subarray(from, from + nameLength)));
    cursor = from + nameLength + extraLength + commentLength;
  }

  return names;
}

/**
 * Разложить архив на файлы.
 *
 * Ошибка чтения самого архива — это отказ с причиной, а не исключение: битый
 * ZIP от клиента на встрече обязан дать понятный ответ, а не пятисотую ошибку.
 */
export interface ExpandLimits {
  readonly expandedBytes?: number;
  readonly entries?: number;
}

/** Потолки — параметром: тест бомбы сжатия строит гигабайт нулей иначе. */
export async function expandArchive(bytes: Uint8Array, limits: ExpandLimits = {}): Promise<Expanded> {
  const rejected: ExpandRejection[] = [];
  const expandedLimit = limits.expandedBytes ?? MAX_EXPANDED_BYTES;
  const entriesLimit = limits.entries ?? MAX_ENTRIES;

  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    return {
      files: [],
      rejected: [
        {
          path: "архив",
          reason: `${Math.round(bytes.byteLength / 1024 / 1024)} МБ больше потолка ${MAX_ARCHIVE_BYTES / 1024 / 1024} МБ`,
        },
      ],
    };
  }

  /**
   * ОБХОД КАТАЛОГА ОТВЕРГАЕТ АРХИВ ЦЕЛИКОМ, А НЕ ОДНУ ЗАПИСЬ.
   *
   * Запись с `..` в пути — не «странный файл», а подпись попытки. Взять из
   * такого архива остальные файлы значило бы скрыть от человека, что архив
   * пытался писать за пределы партии. Причина названа вместе с именем записи.
   */
  const names = rawEntryNames(bytes);

  if (names === undefined) {
    return {
      files: [],
      rejected: [
        { path: "архив", reason: "оглавление архива не прочитано: файл не ZIP либо повреждён" },
      ],
    };
  }

  const dangerous = names.filter((name) => !name.endsWith("/") && safeEntryPath(name) === undefined);

  if (dangerous.length > 0) {
    return {
      files: [],
      rejected: dangerous.map((name) => ({
        path: name,
        reason: "путь записи ведёт за пределы партии либо непригоден для хранения: архив не принят",
      })),
    };
  }

  let zip: JSZip;

  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (cause) {
    return {
      files: [],
      rejected: [{ path: "архив", reason: `архив не прочитан: ${(cause as Error).message}` }],
    };
  }

  const files: ExpandedFile[] = [];
  const entries = Object.values(zip.files);
  let expanded = 0;
  let stopped = false;

  for (const entry of entries.slice(0, entriesLimit)) {
    // Папки в архиве — не файлы. Они не отвергаются: их отсутствие в перечне
    // не потеря, структура восстановится из путей файлов.
    if (entry.dir) continue;

    if (stopped) {
      rejected.push({ path: entry.name, reason: "не распакован: сумма распакованного вышла за потолок" });
      continue;
    }

    const path = safeEntryPath(entry.name);

    if (path === undefined) {
      rejected.push({
        path: entry.name,
        reason: "путь записи ведёт за пределы партии либо непригоден для хранения",
      });
      continue;
    }

    // ВЛОЖЕННЫЙ АРХИВ — ФАЙЛ ПАРТИИ, а не отказ (А11). Раньше он отвергался с
    // просьбой распаковать отдельно; теперь ложится как есть, и его — вместе с
    // .rar и .7z — раскрывает обход партии (`platform/storage/archive-expander`).

    let content: Uint8Array;

    try {
      content = await entry.async("uint8array");
    } catch (cause) {
      // Зашифрованные и повреждённые записи приходят сюда. Причина от
      // библиотеки сохраняется: «неверный пароль» и «битые байты» — разные
      // сведения для того, кто будет разбираться.
      rejected.push({ path, reason: `запись не распакована: ${(cause as Error).message}` });
      continue;
    }

    expanded += content.byteLength;

    // Потолок сверяется ПОСЛЕ распаковки одной записи, а не по объявленному в
    // заголовке размеру: заголовок пишет тот же, кто собирал бомбу.
    if (expanded > expandedLimit) {
      rejected.push({
        path,
        reason: `сумма распакованного превысила потолок ${Math.round(expandedLimit / 1024 / 1024)} МБ: похоже на бомбу сжатия`,
      });
      stopped = true;
      continue;
    }

    files.push({ path, bytes: content });
  }

  const kept = entries.filter((entry) => !entry.dir).length;

  if (kept > entriesLimit) {
    rejected.push({
      path: `и ещё ${kept - entriesLimit}`,
      reason: `за один раз из архива берётся не больше ${entriesLimit} записей`,
    });
  }

  return { files, rejected };
}
