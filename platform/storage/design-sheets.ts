/**
 * Листы рабочей документации КАРТИНКОЙ — «понимать схемы и чертежи».
 *
 * ТРЕБОВАНИЕ ЗАДАЧИ ДОСЛОВНО
 *
 * «В PDF важно уметь работать не только с текстом, но и понимать схемы,
 * таблицы, чертёжные изображения и другие визуальные элементы, насколько это
 * возможно текущим стеком».
 *
 * Текстовый слой это требование закрывает наполовину: подписи он отдаёт, а
 * связи между ними — нет. На курганской структурной схеме электроснабжения
 * текстом видно «150м», «ШК 3.1», «325Вт» россыпью; чем какой шкаф питается и
 * что к чему подключено — только на картинке.
 *
 * ЧТО УМЕЕТ ТЕКУЩИЙ СТЕК, А ЧЕГО НЕ УМЕЕТ — ЗАМЕРЕНО, А НЕ ПРЕДПОЛОЖЕНО
 *
 * | Способ | Замер на курганских подшивках |
 * |---|---|
 * | текстовый слой | 270 тыс. знаков, читается (сделано отдельно) |
 * | извлечение ТАБЛИЦ (`getTable`) | 214 «таблиц», содержательных **ноль**: это рамки и штампы. Плюс 29 страниц из 86 роняют библиотеку |
 * | векторная геометрия (`getPathGeometry`) | возвращает пустое |
 * | рендер страницы (`getScreenshot`) | **работает:** 1,3 с на лист, PNG около 300 КБ |
 * | чтение листа моделью | **работает:** назвала 36 шкафов и длины 150/170/235 м |
 *
 * Отсюда решение: таблицы и векторную геометрию не извлекаем — на этих
 * документах они дают нули, и писать разбор, возвращающий нули, значит завести
 * механизм, который выглядит рабочим. Схемы читает модель по изображению.
 *
 * ГЛАВНАЯ ОГОВОРКА: С ЛИСТА ПРИХОДЯТ НАБЛЮДЕНИЯ, А НЕ ФАКТЫ
 *
 * На том же замере модель прочитала суммарную мощность «315 кВт» как «31,5».
 * Значит всё, взятое с чертежа, идёт уровнем доверия «ориентир» и требует
 * сверки человеком. Числа расчёта это не меняет ничем: их по-прежнему считает
 * расчётный модуль, а модель называет позицию (§12.1д).
 */
import { PDFParse } from "pdf-parse";

import { pdfRenderPages } from "./pdf-poppler.js";

/**
 * Доля коротких строк, начиная с которой лист считается ГРАФИЧЕСКИМ.
 *
 * Признак измерен, а не выбран: на курганской подшивке ЭОМ титульный лист и
 * пояснительная записка дают 16–20 % строк короче двенадцати знаков при
 * средней длине строки 42–53, а структурная схема — 65 % при средней 14, а
 * кабельные журналы 91 % при средней 7. Порог 55 % разделяет их с запасом в
 * обе стороны.
 *
 * Почему именно этот признак: чертёж — россыпь коротких подписей, текст —
 * абзацы. Ничего более прямого текущий стек не даёт: векторная геометрия
 * возвращает пустое, а «таблицы» чертежа — это его рамка.
 */
const SHORT_LINE_SHARE = 0.55;

/** Строка не длиннее этого считается подписью, а не фразой. */
const SHORT_LINE = 12;

/**
 * Сколько листов уходит агенту за один вызов.
 *
 * Три, а не «сколько найдётся». Лист стоит около 1,3 с на рендер и несколько
 * тысяч токенов, а техническое заключение вызывается ПО КАЖДОЙ смете: на
 * четырёх сметах три листа превращаются в двенадцать передач за прогон.
 * Потолок здесь не про один вызов, а про стоимость прогона.
 */
export const DESIGN_SHEETS_MAX = Number.parseInt(process.env["STROYINTELLECT_DESIGN_SHEETS"] ?? "3", 10);

/** Масштаб рендера. Полтора — читаемые подписи при PNG около 300 КБ. */
const SCALE = 1.5;

export interface DesignSheet {
  readonly document: string;
  readonly page: number;
  /** `data:image/png;base64,…` — то, что уходит модели. */
  readonly dataUrl: string;
  readonly bytes: number;
  /**
   * Сколько страниц в документе ВСЕГО.
   *
   * Нужно, чтобы отличить «документ кончился» от «упёрлись в потолок». Без
   * этого числа роль не может знать, прочитано ли всё, а «в спецификации этого
   * нет» о непрочитанной странице — наш сбой, выданный за факт документа.
   */
  readonly total?: number;
}

interface PageMetric {
  readonly page: number;
  readonly lines: number;
  readonly share: number;
}

/**
 * Насколько лист графический — по тексту, без рендера.
 *
 * Считается на всей подшивке одним чтением: рендерить 86 листов, чтобы выбрать
 * три, значило бы потратить две минуты на выбор.
 */
export function graphicPages(pages: readonly { readonly text: string; readonly num: number }[]): readonly PageMetric[] {
  return pages
    .map((page) => {
      const lines = page.text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");
      const short = lines.filter((line) => line.length <= SHORT_LINE).length;

      return { page: page.num, lines: lines.length, share: lines.length === 0 ? 0 : short / lines.length };
    })
    .filter((metric) => metric.share >= SHORT_LINE_SHARE && metric.lines >= 20)
    /**
     * Порядок — по числу подписей, а не по номеру листа.
     *
     * Лист с восемью сотнями подписей несёт кабельный журнал, лист с сотней —
     * структурную схему. Оба полезны, но при потолке в три листа выбирать надо
     * плотные: пустой лист с рамкой формально тоже «графический».
     */
    .sort((left, right) => right.lines - left.lines);
}

/**
 * Рендер выбранных листов подшивки.
 *
 * ОТКАЗ НА ОДНОМ ЛИСТЕ НЕ УНОСИТ ОСТАЛЬНЫЕ. Замерено: `getTable` роняет
 * библиотеку на 29 страницах из 86, и хотя рендер — другой путь, полагаться на
 * его безотказность после такого нельзя. Лист, который не отрисовался, просто
 * не попадает агенту: это меньше сведений, а не поломка прогона.
 */
/**
 * Листы чертежей — тем же рендером, что и всё прочее.
 *
 * Отбор листов по плотности подписей остаётся: подшивка на восемьдесят листов
 * стоит дорого. Но отрисовываются отобранные листы poppler, иначе роль получит
 * белые прямоугольники вместо схем.
 */
export async function renderDesignSheets(
  document: string,
  bytes: Buffer,
  limit = DESIGN_SHEETS_MAX,
): Promise<readonly DesignSheet[]> {
  if (limit <= 0) return [];

  const reader = new PDFParse({ data: bytes });
  let metrics: readonly PageMetric[];

  try {
    const read = await reader.getText();
    const pages = ((read as unknown as { pages?: readonly { text?: string; num?: number }[] }).pages ?? [])
      .map((page) => ({ text: page.text ?? "", num: page.num ?? 0 }))
      .filter((page) => page.num > 0);

    metrics = graphicPages(pages).slice(0, limit);
  } catch {
    return [];
  } finally {
    await reader.destroy();
  }

  const sheets: DesignSheet[] = [];
  const порядок = [...metrics].sort((left, right) => left.page - right.page);

  /**
   * ОТОБРАННЫЕ ЛИСТЫ РИСУЕТ POPPLER — иначе роль получает белые прямоугольники
   * вместо схем (см. `renderAllPages`). Рендерится диапазон до последнего
   * отобранного листа, а берутся из него только отобранные: poppler рисует
   * страницы подряд, и просить у него разрозненные номера дороже, чем отсеять
   * лишнее здесь.
   */
  const последний = порядок[порядок.length - 1]?.page ?? 0;
  const попплером = последний > 0 ? await pdfRenderPages(document, последний) : [];

  if (попплером.length > 0) {
    const нужные = new Set(порядок.map((m) => m.page));

    return попплером
      .filter((с) => нужные.has(с.page))
      .map((с) => ({ document, page: с.page, dataUrl: с.dataUrl, bytes: с.bytes }));
  }

  // Листы отдаются В ПОРЯДКЕ НОМЕРОВ, а не в порядке плотности: агент читает
  // подшивку, и лист 8 после листа 24 — это не подшивка, а набор картинок.
  for (const metric of порядок) {
    const page = new PDFParse({ data: bytes });

    try {
      const shot = await page.getScreenshot({ first: metric.page, last: metric.page, scale: SCALE } as never);
      const rendered = (shot as unknown as { pages?: readonly { dataUrl?: string }[] }).pages ?? [];
      const dataUrl = rendered[0]?.dataUrl;

      if (dataUrl === undefined || !dataUrl.startsWith("data:image")) continue;

      sheets.push({
        document,
        page: metric.page,
        dataUrl,
        // Байты считаются по кодированному представлению: именно оно уходит в
        // запрос, и именно оно стоит токенов.
        bytes: Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75),
      });
    } catch {
      continue;
    } finally {
      await page.destroy();
    }
  }

  return sheets;
}


/**
 * РЕНДЕР ВСЕХ СТРАНИЦ ПОДРЯД — для сканов (Т2.2б).
 *
 * `renderDesignSheets` выбирает листы по плотности подписей В ТЕКСТОВОМ СЛОЕ, и
 * для скана он вернёт пусто: слоя нет, метрики считать не по чему. Именно
 * поэтому сканы и оставались нечитаемыми — отбор листов молча не находил
 * ничего там, где читать надо было всё.
 *
 * Здесь отбора нет: страницы идут подряд от первой, до потолка. Потолок
 * обязателен — подшивка на восемьдесят листов, отправленная зрением целиком,
 * стоит как весь остальной прогон.
 */
export async function renderAllPages(
  document: string,
  bytes: Buffer,
  limit = DESIGN_SHEETS_MAX,
): Promise<readonly DesignSheet[]> {
  if (limit <= 0) return [];

  /**
   * СНАЧАЛА POPPLER: ОН РИСУЕТ ТО, ЧТО ВИДИТ ЧЕЛОВЕК.
   *
   * Замерено 09.09.2026: у локального сметного расчёта шрифты не встроены
   * (`pdffonts`: emb=no), и pdf.js рисовал ПУСТОЙ БЕЛЫЙ ЛИСТ — страницы 6 и 10
   * дали один и тот же файл в 6 589 байт. Зрение честно отвечало «страница
   * пуста», и наш сбой выглядел фактом документа. Poppler рисует ту же
   * страницу целиком: 668 КБ, таблица позиций с шифрами и суммами.
   *
   * Откат на прежний рендер остаётся: без poppler система работает как
   * работала.
   */
  const попплером = await pdfRenderPages(document, limit);
  if (попплером.length > 0) {
    return попплером.map((с) => ({ document, page: с.page, dataUrl: с.dataUrl, bytes: с.bytes }));
  }

  const sheets: DesignSheet[] = [];

  for (let page = 1; page <= limit; page += 1) {
    const reader = new PDFParse({ data: bytes });

    try {
      const shot = await reader.getScreenshot({ first: page, last: page, scale: SCALE } as never);
      const ответ = shot as unknown as { pages?: readonly { dataUrl?: string }[]; total?: number };
      const rendered = ответ.pages ?? [];
      const dataUrl = rendered[0]?.dataUrl;

      // Страниц кончилось — рендер возвращает пусто. Это не отказ, а конец
      // документа, и различать их важно: отказ надо назвать, конец — нет.
      if (dataUrl === undefined || !dataUrl.startsWith("data:image")) break;

      sheets.push({
        document,
        page,
        dataUrl,
        bytes: dataUrl.length,
        ...(typeof ответ.total === "number" ? { total: ответ.total } : {}),
      });
    } catch {
      break;
    } finally {
      await reader.destroy();
    }
  }

  return sheets;
}
