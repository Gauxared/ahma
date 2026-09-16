/**
 * Архив в партии раскрывается НА МЕСТЕ — обходом, а не дверью (spec-demo-stage-1 А11).
 *
 * Дверь загрузки умеет только верхний ZIP: она работает в веб-процессе, и
 * тащить туда WASM-распаковщики RAR и 7z значило бы усложнить сборку Next ради
 * редкого пути. Вложенные архивы, `.rar` и `.7z` ложатся в партию файлами, а
 * здесь — в обходе, который идёт в воркере, — распаковываются в соседнюю папку
 * `<имя>.распаковано/`. Обход заходит в неё, как в любую подпапку.
 *
 * ОДИН РАЗ. Папка с распакованным — признак сделанной работы: повторный обход
 * той же партии находит её и не распаковывает второй раз. Это и защита от
 * бесконечного спуска: архив внутри архива внутри архива останавливается на
 * третьем уровне словом, а не памятью.
 *
 * ЧТО НЕ РАСКРЫВАЕТСЯ: книги и документы, которые по устройству — ZIP (xlsx,
 * docx, pptx, odt). Их узнаёт определитель формата, и для него они не архивы.
 *
 * ЗАЩИТА ТА ЖЕ, ЧТО У ДВЕРИ: путь записи проверяется посегментно, сумма
 * распакованного и число записей ограничены. Архив, пытающийся писать за
 * пределы своей папки, не раскрывается целиком — и это названо причиной.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import JSZip from "jszip";

import { detectFormat, zipEntryName, zipTailSignature } from "@modules/documents/format-detector.js";

export type ArchiveKind = "zip" | "rar" | "7z";

/** Сколько байт читается, чтобы отличить архив от книги: оглавлению хватает. */
const PROBE_BYTES = 64 * 1024;
export const EXPANDED_LIMIT_BYTES = 1024 * 1024 * 1024;
export const ENTRIES_LIMIT = 2000;
/** Архив в архиве в архиве — предел; глубже распаковка не идёт, и это сказано. */
export const NESTING_LIMIT = 3;
export const EXPANDED_SUFFIX = ".распаковано";

/** Вид архива по содержимому; `undefined` — не архив (в том числе книга-ZIP). */
export function archiveKind(bytes: Buffer, fileName: string): ArchiveKind | undefined {
  const format = detectFormat({ fileName, bytes }).format;

  if (format === "zip-архив") return "zip";
  if (format === "rar-архив") return "rar";
  if (format === "7z-архив") return "7z";

  return undefined;
}

/** Безопасный относительный путь записи: без `..`, без корня, без буквы диска. */
export function safeRelativePath(raw: string): string | undefined {
  const normalized = raw.replaceAll("\\", "/");

  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return undefined;

  const segments = normalized.split("/").filter((segment) => segment !== "");
  if (segments.length === 0) return undefined;

  for (const segment of segments) {
    // eslint-disable-next-line no-control-regex
    const cleaned = segment.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (cleaned === "" || cleaned === "." || cleaned === ".." || cleaned.length > 180) return undefined;
    if (/[:*?"<>|]/.test(cleaned)) return undefined;
  }

  return segments.join("/");
}

export interface ExpandedInPlace {
  readonly folder: string;
  readonly files: number;
  readonly rejected: readonly { readonly path: string; readonly reason: string }[];
}

interface Entry {
  readonly path: string;
  readonly bytes: Uint8Array;
}

async function zipEntries(bytes: Buffer): Promise<Entry[]> {
  /**
   * ИМЯ ЗАПИСИ ДЕКОДИРУЕТСЯ НАМИ, А НЕ БИБЛИОТЕКОЙ.
   *
   * JSZip по умолчанию читает имена как UTF-8. В архивах Windows флаг UTF-8
   * (бит 11) обычно не выставлен, а имена записаны в CP866 — замерено на кейсе
   * «Йошкар-Ола». Файл с нечитаемым именем ложится на диск таким же, попадает в
   * перечень документов роли и перестаёт быть находимым человеком.
   *
   * Флага у JSZip в обработчике нет, поэтому решаем по содержимому: имя, не
   * декодируемое в UTF-8 без замен, читается как CP866.
   */
  const zip = await JSZip.loadAsync(bytes, {
    decodeFileName: (raw: string[] | Buffer | Uint8Array) =>
      Array.isArray(raw) ? raw.join("") : zipEntryName(Buffer.from(raw), 0),
  });
  const out: Entry[] = [];

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    out.push({ path: entry.name, bytes: await entry.async("uint8array") });
  }

  return out;
}

async function rarEntries(bytes: Buffer): Promise<Entry[]> {
  const { createExtractorFromData } = await import("node-unrar-js");
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const extractor = await createExtractorFromData({ data });
  const extracted = extractor.extract({});
  const out: Entry[] = [];

  for (const file of extracted.files) {
    if (file.fileHeader.flags.directory || file.extraction === undefined) continue;
    out.push({ path: file.fileHeader.name, bytes: file.extraction });
  }

  return out;
}

async function sevenZipEntries(bytes: Buffer): Promise<Entry[]> {
  const factory = (await import("7z-wasm")).default;
  // Вывод утилиты подавляется: он шёл бы в журнал воркера построчно.
  const seven = await factory({ print: () => undefined, printErr: () => undefined });
  const fs = seven.FS;

  fs.mkdir("/вход");
  fs.mkdir("/выход");
  fs.writeFile("/вход/архив.7z", bytes);
  seven.callMain(["x", "/вход/архив.7z", "-o/выход", "-y", "-bso0", "-bse0"]);

  const walk = (folder: string, prefix: string): Entry[] => {
    const out: Entry[] = [];

    for (const name of fs.readdir(folder) as string[]) {
      if (name === "." || name === "..") continue;
      const full = `${folder}/${name}`;
      const info = fs.stat(full) as { mode: number };

      if (fs.isDir(info.mode)) {
        out.push(...walk(full, `${prefix}${name}/`));
      } else {
        out.push({ path: `${prefix}${name}`, bytes: fs.readFile(full) as Uint8Array });
      }
    }

    return out;
  };

  return walk("/выход", "");
}

/**
 * Раскрывает архив рядом с ним. `undefined` — файл не архив, обход читает его
 * как документ. Папка уже есть — возвращается без распаковки.
 */
/**
 * Есть ли в хвосте файла конец центрального каталога ZIP.
 *
 * Читается ровно окно, в котором он может находиться: сама запись плюс
 * комментарий архива длиной до 65 535 байт. Читать файл целиком ради этого
 * нельзя — в партии встречаются архивы на сотни мегабайт.
 */
async function хвостАрхива(path: string, size: number): Promise<boolean> {
  const окно = Math.min(size, 66_000);
  const buffer = Buffer.alloc(окно);
  const handle = await (await import("node:fs/promises")).open(path, "r");

  try {
    await handle.read(buffer, 0, окно, size - окно);
  } finally {
    await handle.close();
  }

  return zipTailSignature(buffer);
}

export async function expandArchiveInPlace(path: string): Promise<ExpandedInPlace | undefined> {
  // Глубина вложенности — по числу `.распаковано` в пути: третий уровень не
  // раскрывается, архив остаётся файлом с причиной у обхода.
  const nesting = path.split(EXPANDED_SUFFIX).length - 1;
  if (nesting >= NESTING_LIMIT) return undefined;

  const size = (await stat(path)).size;
  if (size === 0) return undefined;

  const probe = Buffer.alloc(Math.min(size, PROBE_BYTES));
  const handle = await (await import("node:fs/promises")).open(path, "r");
  try {
    await handle.read(probe, 0, probe.length, 0);
  } finally {
    await handle.close();
  }

  /**
   * ОПОЗНАНИЕ ПО ПРОБЕ ВИДИТ ТОЛЬКО НАЧАЛО ФАЙЛА, А У ZIP ГЛАВНОЕ — В КОНЦЕ.
   *
   * Замерено на кейсе «Йошкар-Ола»: приложения ПСД (31 файл) и РД начинались не
   * с `PK\x03\x04`, и проба их архивом не признавала. Авторитетный перечень
   * записей у ZIP лежит в центральном каталоге ХВОСТА — так их и открывают
   * `unzip` и Python, не жалуясь. Поэтому, когда проба молчит, дочитываем хвост.
   */
  const имя = path.split("/").pop() ?? path;
  const поПробе = detectFormat({ fileName: имя, bytes: probe }).format;

  /**
   * ХВОСТ СМОТРИМ ТОЛЬКО У ТОГО, ЧТО НЕ ОПОЗНАНО ВОВСЕ.
   *
   * `.xlsx`, `.docx` и `.pptx` — тоже ZIP, и EOCD у них в хвосте есть. Приняв
   * их за архивы, обход разложил бы книгу на `xl/worksheets/sheet1.xml` вместо
   * того, чтобы прочитать её сметой. Поймано набором сразу после правки.
   */
  const kind =
    archiveKind(probe, имя) ??
    (поПробе === "неопознан" && (await хвостАрхива(path, size)) ? "zip" : undefined);

  if (kind === undefined) return undefined;

  const folder = `${path}${EXPANDED_SUFFIX}`;

  if (existsSync(folder)) {
    return { folder, files: (await readdir(folder)).length, rejected: [] };
  }

  const bytes = await readFile(path);
  const rejected: { path: string; reason: string }[] = [];
  let entries: Entry[];

  try {
    entries = kind === "zip" ? await zipEntries(bytes) : kind === "rar" ? await rarEntries(bytes) : await sevenZipEntries(bytes);
  } catch (cause) {
    // Битый или зашифрованный архив — документ с причиной, а не обрыв обхода.
    // Папка заводится пустой с пометкой: повторный обход не будет биться о него снова.
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "НЕ_РАСПАКОВАН.txt"), `Архив ${kind} не распакован: ${(cause as Error).message}\n`, "utf8");
    return { folder, files: 0, rejected: [{ path, reason: `архив ${kind} не распакован: ${(cause as Error).message}` }] };
  }

  const dangerous = entries.filter((entry) => safeRelativePath(entry.path) === undefined);

  if (dangerous.length > 0) {
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, "НЕ_РАСПАКОВАН.txt"),
      `Архив не раскрыт: записи ведут за пределы папки — ${dangerous.map((d) => d.path).join(", ")}\n`,
      "utf8",
    );
    return {
      folder,
      files: 0,
      rejected: dangerous.map((d) => ({ path: d.path, reason: "путь записи ведёт за пределы партии: архив не раскрыт" })),
    };
  }

  await mkdir(folder, { recursive: true });
  let expanded = 0;
  let files = 0;

  for (const entry of entries) {
    if (files >= ENTRIES_LIMIT) {
      rejected.push({ path: entry.path, reason: `из архива берётся не больше ${ENTRIES_LIMIT} записей` });
      continue;
    }

    expanded += entry.bytes.byteLength;

    if (expanded > EXPANDED_LIMIT_BYTES) {
      rejected.push({ path: entry.path, reason: `сумма распакованного превысила ${EXPANDED_LIMIT_BYTES / 1024 / 1024} МБ: похоже на бомбу сжатия` });
      continue;
    }

    const target = join(folder, safeRelativePath(entry.path)!);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, entry.bytes);
    files += 1;
  }

  if (rejected.length > 0) {
    await writeFile(
      join(folder, "НЕ_РАСПАКОВАНО_ЧАСТИЧНО.txt"),
      rejected.map((r) => `${r.path}: ${r.reason}`).join("\n") + "\n",
      "utf8",
    );
  }

  return { folder, files, rejected };
}
