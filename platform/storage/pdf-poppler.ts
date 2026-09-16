/**
 * PDF ЧЕРЕЗ POPPLER: РАСКЛАДКА КОЛОНОК И РЕНДЕР, КОТОРЫЙ НЕ ПУСТ.
 *
 * ДВА ЗАМЕРЕННЫХ ДЕФЕКТА, ИЗ-ЗА КОТОРЫХ ЭТОТ МОДУЛЬ ПОЯВИЛСЯ (09.09.2026,
 * кейс «Благоустройство», локальный сметный расчёт на 36 страниц).
 *
 * ПЕРВЫЙ: СТРАНИЦА РЕНДЕРИЛАСЬ ПУСТЫМ ЛИСТОМ. В этой смете шрифты НЕ встроены
 * (`pdffonts`: ArialMT, TimesNewRomanPSMT — `emb: no`), а pdf.js без набора
 * стандартных шрифтов текст не рисует. Страницы 6 и 10 дали один и тот же
 * файл в 6 589 байт — белый лист. Зрение честно отвечало «страница пуста», и
 * это выглядело фактом документа, а было нашим сбоем. Тот же лист poppler
 * рисует целиком: таблица позиций, шифры ГЭСН, суммы 15 674,15 и 100 286,14 ₽.
 *
 * ВТОРОЙ: ТЕКСТ ШЁЛ БЕЗ РАСКЛАДКИ. Наш текстовый слой отдавал по одному
 * значению на строку — «1», «ГЭСН09-01-015-01», «м3», «0,2» порознь, — и
 * структура сметы исчезала: непонятно, какое количество к какой работе.
 * `pdftotext -layout` сохраняет колонки пробелами, и строка сметы остаётся
 * строкой со своим шифром, единицей, количеством и суммой.
 *
 * ПОЧЕМУ ВНЕШНЯЯ ПРОГРАММА, А НЕ БИБЛИОТЕКА. В бандле `pdf-parse` нет ни
 * `standardFontDataUrl`, ни `useSystemFonts` — управлять шрифтами нечем, и
 * невстроенные шрифты не будут нарисованы никогда. Poppler — эталонная
 * реализация, ею открывают PDF просмотрщики Linux; она берёт шрифты системы.
 *
 * ОТСУТСТВИЕ POPPLER — НЕ ОТКАЗ. Если программы нет, вызывающий получает
 * `undefined` и работает прежним путём. Молча хуже не станет: прежний путь
 * остаётся тем же, каким был.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Сколько ждать poppler на одном документе. Смета на 400 страниц — минуты. */
const TIMEOUT_MS = 180_000;

/** Потолок вывода: подшивка чертежей даёт десятки мегабайт текста. */
const MAX_BUFFER = 256 * 1024 * 1024;

/** Разрешение рендера. 110 dpi — читаемая таблица при разумном весе картинки. */
const DPI = 110;

let доступен: boolean | undefined;

/**
 * Есть ли poppler в системе. Проверяется ОДИН раз за процесс: спрашивать при
 * каждом файле значит запускать лишний процесс на каждой странице партии.
 */
export async function popplerAvailable(): Promise<boolean> {
  if (доступен !== undefined) return доступен;

  try {
    await run("pdftotext", ["-v"], { timeout: 10_000 });
    доступен = true;
  } catch {
    доступен = false;
  }

  return доступен;
}

/**
 * Текст PDF С СОХРАНЁННОЙ РАСКЛАДКОЙ КОЛОНОК.
 *
 * `-layout` расставляет пробелы так, как текст расположен на странице: строка
 * сметы остаётся строкой. Именно этим текстом смету можно разложить в позиции,
 * а прежним — нельзя.
 *
 * `undefined` — poppler недоступен либо документ не отдал текста; и то и другое
 * означает «читай прежним путём», а не «текста нет».
 */
export async function pdfLayoutText(path: string): Promise<string | undefined> {
  if (!(await popplerAvailable())) return undefined;

  try {
    const { stdout } = await run("pdftotext", ["-q", "-layout", "-enc", "UTF-8", path, "-"], {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      encoding: "utf8",
    });

    return stdout.trim() === "" ? undefined : stdout;
  } catch {
    return undefined;
  }
}

/** Страница, отрисованная poppler: номер и картинка для зрения модели. */
export interface PopplerPage {
  readonly page: number;
  readonly dataUrl: string;
  readonly bytes: number;
}

/**
 * Рендер страниц документа.
 *
 * Рисует ВСЁ, что видит просмотрщик: и векторный текст невстроенными шрифтами,
 * и растровый скан. Именно этого не умеет наш прежний рендер, и именно поэтому
 * зрение получало пустые листы.
 */
export async function pdfRenderPages(path: string, limit: number): Promise<readonly PopplerPage[]> {
  if (limit <= 0 || !(await popplerAvailable())) return [];

  const каталог = await mkdtemp(join(tmpdir(), "страницы-"));

  try {
    await run("pdftoppm", ["-png", "-r", String(DPI), "-f", "1", "-l", String(limit), path, join(каталог, "стр")], {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    });

    const файлы = (await readdir(каталог)).filter((имя) => имя.endsWith(".png")).sort();
    const страницы: PopplerPage[] = [];

    for (const имя of файлы) {
      const bytes = await readFile(join(каталог, имя));
      // Имя вида `стр-06.png`: номер страницы — то, чем её назвал poppler.
      const номер = Number.parseInt(имя.replace(/^.*?-(\d+)\.png$/u, "$1"), 10);

      страницы.push({
        page: Number.isFinite(номер) ? номер : страницы.length + 1,
        dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
        bytes: bytes.byteLength,
      });
    }

    return страницы;
  } catch {
    return [];
  } finally {
    // Временные картинки удаляются всегда: подшивка на шестьдесят листов — это
    // сотни мегабайт, и оставлять их в `/tmp` до перезагрузки нельзя.
    await rm(каталог, { recursive: true, force: true });
  }
}
