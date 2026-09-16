/**
 * Текст рабочей документации для агента — сжатие и объявленный бюджет.
 *
 * ЧЕГО НЕ БЫЛО ВООБЩЕ
 *
 * Текстовый слой PDF читался и ВЫБРАСЫВАЛСЯ: обход вызывал разбор только затем,
 * чтобы отличить документ от скана по §14, и результат не сохранял. В порт
 * технического заключения жёстко передавалось `hasDesignDocuments: false`.
 *
 * Видно это было на экране словами самих агентов: паспорт объекта ссылался на
 * «КУРГАН ЭОМ 07.04.2025.pdf», а техническое заключение в том же прогоне писало
 * «геометрия РД отсутствует». Два агента противоречили друг другу, и оба были
 * правы: файл в объекте есть, содержимое до агента не дошло.
 *
 * §14 ИСКЛЮЧАЕТ РАСПОЗНАВАНИЕ СКАНОВ, А НЕ ЧТЕНИЕ ТЕКСТОВОГО СЛОЯ
 *
 * Это разные вещи, и формулировка «§14 исключает разбор РД», стоявшая
 * комментарием в обходе, шире самого §14. Скан по-прежнему отвергается — у него
 * текстового слоя нет по определению, и порог в 100 знаков на страницу его
 * отделяет. У курганских РД вышло около 3000.
 *
 * ЗАЧЕМ СЖАТИЕ, А НЕ «ОТДАТЬ КАК ЕСТЬ»
 *
 * Замерено: две подшивки курганского объекта — 86 страниц и 270 тысяч знаков,
 * то есть порядка восьмидесяти тысяч токенов. В промпт технического заключения,
 * где уже лежит смета, они не помещаются, а помещённые вытеснили бы смету.
 *
 * Две трети этого объёма — повторы. На каждой странице стоит один и тот же
 * колонтитул («Запрещается без предварительного письменного разрешения
 * собственника воспроизводить…»), штамп и номер листа. Тридцать три копии
 * юридической оговорки не сообщают агенту ничего и стоят ровно столько же
 * токенов, сколько содержательный текст.
 *
 * СОКРАЩЕНИЕ ОБЪЯВЛЯЕТСЯ, А НЕ ДЕЛАЕТСЯ МОЛЧА
 *
 * Агент, получивший половину документации и не знающий об этом, отвечает так
 * же уверенно, как агент, получивший её целиком. Поэтому в промпт идёт и
 * замер: сколько страниц, сколько знаков было, сколько показано.
 */

/**
 * Сколько знаков рабочей документации уходит агенту за один вызов.
 *
 * ЧИСЛО, А НЕ «СКОЛЬКО ВЛЕЗЕТ». Замер курганского объекта: две подшивки, 86
 * страниц, 270 тысяч знаков после чтения и 214 тысяч после снятия повторов —
 * порядка шестидесяти тысяч токенов. В промпте технического заключения уже
 * лежит смета, и подшивки целиком вытеснили бы её.
 *
 * Сорок тысяч знаков — примерно двенадцать тысяч токенов, то есть заметная, но
 * не главная часть промпта. Техническое заключение вызывается ПО КАЖДОЙ смете,
 * и на четырёх сметах это четыре таких вставки: потолок здесь не про один
 * вызов, а про стоимость прогона.
 *
 * Переменной окружения поднимается: у владельца контура своя модель, свой
 * потолок контекста и своя цена обращения, и назначать их за него нельзя.
 */
export const DESIGN_TEXT_BUDGET = Number.parseInt(
  process.env["STROYINTELLECT_DESIGN_TEXT_CHARS"] ?? "40000",
  10,
);

/** Строка, повторяющаяся не реже чем на этой доле страниц, считается колонтитулом. */
const REPEAT_SHARE = 0.34;

/** Короткие повторы (номера листов, штампы) снимаются по тому же правилу. */
const MIN_REPEATS = 3;

export interface DesignDocument {
  /** Путь внутри партии — им же подписывается источник. */
  readonly path: string;
  readonly pages: number;
  readonly text: string;
}

export interface DesignExcerpt {
  readonly path: string;
  readonly pages: number;
  /** Сколько знаков было в текстовом слое до сжатия. */
  readonly chars: number;
  /** Сколько знаков осталось после снятия повторов. */
  readonly condensed: number;
  /** Что реально уходит агенту. */
  readonly text: string;
  /** Обрезано ли по бюджету — агент обязан знать. */
  readonly truncated: boolean;
}

export interface DesignBrief {
  readonly documents: readonly DesignExcerpt[];
  readonly pages: number;
  readonly chars: number;
  readonly shown: number;
}

/**
 * Снятие колонтитулов и штампов.
 *
 * Правило простое и объяснимое: строка, встречающаяся не реже чем на трети
 * страниц, — типографика листа, а не содержание. Порог не «на глаз»: на 33
 * страницах он отсекает то, что повторилось 12 раз и больше, а содержательная
 * строка чертежа столько раз не повторяется.
 *
 * ПЕРВОЕ ВХОЖДЕНИЕ ОСТАЁТСЯ. Колонтитул несёт название раздела и шифр проекта —
 * один раз это сведение, тридцать три раза это шум.
 */
export function condense(text: string, pages: number): string {
  const lines = text.split("\n").map((line) => line.trim());
  const counts = new Map<string, number>();

  for (const line of lines) {
    if (line === "") continue;
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }

  const threshold = Math.max(MIN_REPEATS, Math.ceil(pages * REPEAT_SHARE));
  const seen = new Set<string>();
  const kept: string[] = [];

  for (const line of lines) {
    if (line === "") continue;

    const repeats = counts.get(line) ?? 0;

    if (repeats >= threshold) {
      if (seen.has(line)) continue;
      seen.add(line);
    }

    kept.push(line);
  }

  return kept.join("\n");
}

/**
 * Выжимка по всем подшивкам в пределах бюджета.
 *
 * Бюджет делится ПОРОВНУ между документами, а не отдаётся первому: подшивка
 * «ЭОМ» и подшивка «СОТ» — разные разделы проекта, и отдать агенту один целиком
 * вместо двух наполовину значило бы решить за него, какой раздел важнее.
 *
 * Остаток от документов, уложившихся в свою долю, перераспределяется: если один
 * раздел короткий, второй получает больше — потолок общий, а не по документу.
 */
export function briefOf(documents: readonly DesignDocument[], budget: number): DesignBrief {
  const condensed = documents.map((document) => ({
    document,
    text: condense(document.text, document.pages),
  }));

  const total = condensed.reduce((sum, item) => sum + item.text.length, 0);

  // Влезает целиком — делить нечего.
  if (total <= budget) {
    return {
      documents: condensed.map(({ document, text }) => ({
        path: document.path,
        pages: document.pages,
        chars: document.text.length,
        condensed: text.length,
        text,
        truncated: false,
      })),
      pages: documents.reduce((sum, item) => sum + item.pages, 0),
      chars: documents.reduce((sum, item) => sum + item.text.length, 0),
      shown: total,
    };
  }

  /**
   * Доля на документ с перераспределением остатка.
   *
   * Считается по возрастанию длины: короткие берут своё целиком, а всё, что
   * они не выбрали, достаётся длинным. Иначе один длинный раздел съедал бы
   * бюджет и короткий не попадал бы вовсе.
   */
  const byLength = [...condensed].sort((left, right) => left.text.length - right.text.length);
  const share = new Map<string, number>();
  let left = budget;
  let rest = byLength.length;

  for (const item of byLength) {
    const quota = Math.floor(left / rest);
    const take = Math.min(item.text.length, quota);
    share.set(item.document.path, take);
    left -= take;
    rest -= 1;
  }

  const excerpts = condensed.map(({ document, text }) => {
    const take = share.get(document.path) ?? 0;

    return {
      path: document.path,
      pages: document.pages,
      chars: document.text.length,
      condensed: text.length,
      text: text.slice(0, take),
      truncated: take < text.length,
    };
  });

  return {
    documents: excerpts,
    pages: documents.reduce((sum, item) => sum + item.pages, 0),
    chars: documents.reduce((sum, item) => sum + item.text.length, 0),
    shown: excerpts.reduce((sum, item) => sum + item.text.length, 0),
  };
}

/**
 * Выжимка в текст промпта — вместе с замером.
 *
 * Замер обязателен. Агент, получивший половину документации и не знающий об
 * этом, отвечает так же уверенно, как агент, получивший её целиком, — и его
 * «в РД этого нет» становится утверждением о нашем бюджете, а не о проекте.
 */
export function briefToPrompt(brief: DesignBrief): readonly string[] {
  if (brief.documents.length === 0) return [];

  const lines: string[] = [
    "РАБОЧАЯ ДОКУМЕНТАЦИЯ (текстовый слой PDF, повторяющиеся колонтитулы сняты):",
    `  подшивок ${brief.documents.length}, страниц ${brief.pages}, знаков в источнике ${brief.chars}, показано ${brief.shown}`,
  ];

  if (brief.shown < brief.chars) {
    lines.push(
      "  ВНИМАНИЕ: показана ЧАСТЬ документации — она не поместилась целиком. " +
        "Отсутствие сведения в показанном тексте не означает его отсутствия в проекте.",
    );
  }

  lines.push("  Геометрия чертежей, схемы и растровые изображения НЕ разбираются: это текстовый слой.");

  for (const document of brief.documents) {
    lines.push("", `--- ${document.path} (страниц ${document.pages}${document.truncated ? ", показана часть" : ""})`);
    lines.push(document.text);
  }

  return lines;
}
