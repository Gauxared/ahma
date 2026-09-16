/**
 * Гейт контраста палитры (WCAG 2.1 AA).
 *
 * ПОЧЕМУ ЭТО ГЕЙТ, А НЕ ВЫЧИТКА
 *
 * Спека требует WCAG 2.1 AA на договорных пользовательских путях, и на макетах
 * заказчика это было главным провалом: янтарный и серый по почти-чёрному фону в
 * мета-строках давали около 2.5:1 при норме 4.5:1. Такую вещь глазом не поймать —
 * она выглядит «стильно приглушённой», а не сломанной, и обнаруживается на
 * приёмке или не обнаруживается вовсе.
 *
 * Три пары уже были найдены этой проверкой при первом же прогоне: `--text-4`
 * (2.56), `--brand` (3.79) и `--warn` (4.18) в светлой теме.
 *
 * ЧТО ПРОВЕРЯЕТСЯ
 *
 * Текстовые роли против фонов и каждый семантический цвет против собственной
 * `-soft` подложки — именно так они и стоят в интерфейсе: статус-токен рисует
 * цвет на своей приглушённой подложке, а не на белом. Полупрозрачные подложки
 * тёмной темы смешиваются с поверхностью, иначе замер врёт в лучшую сторону.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = join("apps", "web", "app", "globals.css");

/** Порог для обычного текста и для крупного/декоративного (WCAG 1.4.3). */
const AA_NORMAL = 4.5;
const AA_LARGE = 3;

/**
 * Порог для НЕТЕКСТОВЫХ объектов — WCAG 1.4.11, те же 3:1.
 *
 * Держится отдельной константой, хотя численно совпадает с `AA_LARGE`: это
 * разные требования, и если одно однажды поменяется, второе не должно
 * поехать за ним. Урок `Ф-33` был именно про то, что порог, унаследованный
 * не по своему поводу, разрешает лишнее.
 */
const AA_GRAPHIC = 3;

type Rgb = readonly [number, number, number];

function parseHex(value: string): Rgb | undefined {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (match === null) {
    return undefined;
  }
  const digits = match[1] as string;
  return [
    Number.parseInt(digits.slice(0, 2), 16),
    Number.parseInt(digits.slice(2, 4), 16),
    Number.parseInt(digits.slice(4, 6), 16),
  ];
}

function parseRgba(value: string): { readonly rgb: Rgb; readonly alpha: number } | undefined {
  const match = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i.exec(value.trim());
  if (match === null) {
    return undefined;
  }
  return {
    rgb: [Number(match[1]), Number(match[2]), Number(match[3])],
    alpha: Number(match[4]),
  };
}

function composite(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return [0, 1, 2].map((index) => Math.round((fg[index] as number) * alpha + (bg[index] as number) * (1 - alpha))) as unknown as Rgb;
}

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
}

function luminance(rgb: Rgb): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function contrast(a: Rgb, b: Rgb): number {
  const first = luminance(a);
  const second = luminance(b);
  const high = Math.max(first, second);
  const low = Math.min(first, second);
  return (high + 0.05) / (low + 0.05);
}

/** Достаёт объявления `--имя: значение` из одного блока правил по селектору. */
function tokensOf(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(selector);
  if (start === -1) {
    throw new Error(`Блок ${selector} не найден в ${CSS}`);
  }
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  /**
   * КОММЕНТАРИИ ВЫРЕЗАЮТСЯ ДО РАЗБОРА, И ЭТО НЕ ОПРЯТНОСТЬ.
   *
   * Разбор идёт регуляркой `--имя: значение;`, и она не различает объявление от
   * упоминания. Комментарий рядом с токеном написал «у тревоги свой красный
   * (`--danger: #c22a24`)» — регулярка приняла это за объявление и, не найдя
   * точки с запятой, проглотила всё до следующей, вместе с настоящим
   * `--brand: #8f1d2b;`. Гейт упал с сообщением «в теме «светлая» нет --brand»
   * — то есть назвал СЛЕДСТВИЕ, а причина была в прозе двумя строками выше.
   *
   * Объяснять токен в комментарии — обычное дело в этом файле стилей, и запрет
   * упоминать имена токенов был бы запретом объяснять. Вырезать комментарии
   * дешевле и надёжнее.
   */
  const body = css.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, "");

  const tokens = new Map<string, string>();
  for (const match of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(match[1] as string, (match[2] as string).trim());
  }
  return tokens;
}

interface Failure {
  readonly theme: string;
  readonly pair: string;
  readonly ratio: number;
  readonly need: number;
}

const failures: Failure[] = [];
let checked = 0;

function resolve(tokens: Map<string, string>, name: string, surface: Rgb): Rgb | undefined {
  const raw = tokens.get(name);
  if (raw === undefined) {
    return undefined;
  }

  const solid = parseHex(raw);
  if (solid !== undefined) {
    return solid;
  }

  const translucent = parseRgba(raw);
  if (translucent !== undefined) {
    // Подложка полупрозрачна — смешиваем с поверхностью, на которой лежит.
    // Без этого замер получается на «чистом» цвете и всегда проходит.
    return composite(translucent.rgb, translucent.alpha, surface);
  }

  return undefined;
}

function check(theme: string, pair: string, foreground: Rgb, background: Rgb, need: number): void {
  checked += 1;
  const ratio = contrast(foreground, background);
  if (ratio < need) {
    failures.push({ theme, pair, ratio, need });
  }
}

const css = readFileSync(CSS, "utf8");

const THEMES: readonly { readonly name: string; readonly selector: string }[] = [
  { name: "светлая", selector: '[data-theme="light"]' },
  { name: "тёмная", selector: '[data-theme="dark"]' },
];

/**
 * Текстовые роли и их пороги.
 *
 * У `text-4` порог ОБЫЧНЫЙ, а не «крупного текста», и это исправление, а не
 * придирка. Роль задумывалась декоративной, поэтому ей поставили 3:1 — но на
 * экране ею набраны приписка карточки (12px) и шапка колонки (11px). Это мелкий
 * текст, и WCAG требует для него 4.5:1.
 *
 * Гейт был зелёным, пока axe не нашёл 3.18:1 на шапке таблиц: проверка
 * кодировала МОЁ НАМЕРЕНИЕ насчёт роли, а не то, как роль применяется. Порог,
 * назначенный по замыслу, а не по употреблению, — это гейт, который разрешает
 * ровно то, ради чего заведён.
 *
 * `AA_LARGE` оставлен в файле осознанно: он понадобится, когда появится роль,
 * которой действительно набирают крупный текст. Порог не подгоняется под
 * значение — значение подгоняется под порог.
 */
const TEXT_ROLES: readonly { readonly token: string; readonly need: number }[] = [
  { token: "text", need: AA_NORMAL },
  { token: "text-2", need: AA_NORMAL },
  { token: "text-3", need: AA_NORMAL },
  { token: "text-4", need: AA_NORMAL },
];

const SEMANTIC = ["brand", "accent", "ok", "warn", "danger", "info", "unknown"] as const;

for (const theme of THEMES) {
  const tokens = tokensOf(css, theme.selector);

  const surface = parseHex(tokens.get("surface") ?? "");
  if (surface === undefined) {
    throw new Error(`В теме «${theme.name}» нет --surface`);
  }

  // Все грунты, на которых реально лежит текст. Пропустить хоть один — значит
  // получить гейт, который зелен на одном фоне и слеп на трёх остальных;
  // именно так `--surface-raised` едва не проехал непроверенным.
  const GROUNDS = ["bg", "surface", "surface-raised", "surface-sunken"] as const;
  const grounds = GROUNDS.map((name) => {
    const value = parseHex(tokens.get(name) ?? "");
    if (value === undefined) {
      throw new Error(`В теме «${theme.name}» нет --${name}`);
    }
    return { name, value };
  });

  for (const role of TEXT_ROLES) {
    const colour = resolve(tokens, role.token, surface);
    if (colour === undefined) {
      throw new Error(`В теме «${theme.name}» нет --${role.token}`);
    }
    for (const ground of grounds) {
      check(theme.name, `--${role.token} на --${ground.name}`, colour, ground.value, role.need);
    }
  }

  // Подсвеченные плитки Пульта: текст ложится на тревожную подложку, а не на
  // страничный грунт. Пара новая, и приносит её сама поверхность — иначе гейт
  // зелен ровно потому, что об этих подложках не знает (урок `Ф-33`, `Ф-41`).
  for (const soft of ["warn-soft", "danger-soft"] as const) {
    const ground = resolve(tokens, soft, surface);
    if (ground === undefined) continue;

    for (const role of ["text", "text-2", "text-3"] as const) {
      const colour = resolve(tokens, role, surface);
      if (colour !== undefined) {
        check(theme.name, `--${role} на --${soft}`, colour, ground, AA_NORMAL);
      }
    }
  }

  // Выбранная пилюля отбора: её текст ложится на `--accent-soft`, а число рядом
  // набрано `--text-4` того же кегля 11 px. Пара приносится вместе с примитивом
  // (`.filters__chip--on`): иначе гейт зелен ровно потому, что о новой подложке
  // не знает — та самая слепота, что дважды разрешала слабый цвет.
  const chipGround = resolve(tokens, "accent-soft", surface);
  const chipText = resolve(tokens, "accent-hover", surface);
  if (chipGround !== undefined && chipText !== undefined) {
    check(theme.name, "--accent-hover на --accent-soft (пилюля отбора)", chipText, chipGround, AA_NORMAL);
  }

  // Полоса доли (веха Ф10) — графический объект, а не текст: её заливка обязана
  // отличаться от жёлоба на 3:1, иначе доля не читается вовсе. Пара добавлена
  // вместе с примитивом, а не после жалобы.
  const share = resolve(tokens, "accent", surface);
  const trough = resolve(tokens, "surface-sunken", surface);
  if (share !== undefined && trough !== undefined) {
    check(theme.name, "--accent на --surface-sunken (полоса)", share, trough, AA_GRAPHIC);
  }

  for (const name of SEMANTIC) {
    const colour = resolve(tokens, name, surface);
    if (colour === undefined) {
      throw new Error(`В теме «${theme.name}» нет --${name}`);
    }
    check(theme.name, `--${name} на --surface`, colour, surface, AA_NORMAL);

    const soft = resolve(tokens, `${name}-soft`, surface);
    if (soft !== undefined) {
      check(theme.name, `--${name} на --${name}-soft`, colour, soft, AA_NORMAL);
    }
  }

  /**
   * Текст на ЗАЛИТОЙ БРЕНДОВОЙ кнопке — вход.
   *
   * Пара новая, и она приносится вместе с кнопкой. До входа брендовый цвет
   * нигде не был фоном текста, и гейт про эту пару не знал — то есть был бы
   * зелёным при белом тексте на чём угодно брендовом. Тот же класс слепоты, что
   * `Ф-33` и `Ф-41`: проверка зелена потому, что о новом применении не знает.
   *
   * Проверяются ОБА состояния: наведение — тоже фон текста, и темнеть ему можно
   * лишь до предела читаемости.
   */
  const brand = resolve(tokens, "brand", surface);
  const brandHover = resolve(tokens, "brand-hover", surface);
  const brandText = resolve(tokens, "brand-text", surface);

  if (brand !== undefined && brandText !== undefined) {
    check(theme.name, "--brand-text на --brand (кнопка входа)", brandText, brand, AA_NORMAL);
  }
  if (brandHover !== undefined && brandText !== undefined) {
    check(theme.name, "--brand-text на --brand-hover (кнопка входа)", brandText, brandHover, AA_NORMAL);
  }

  // Текст на залитой кнопке: единственная пара, где фон — сам акцент.
  const accent = resolve(tokens, "accent", surface);
  const accentText = resolve(tokens, "accent-text", surface);
  if (accent !== undefined && accentText !== undefined) {
    check(theme.name, "--accent-text на --accent", accentText, accent, AA_NORMAL);
  }
}

/**
 * Рельс навигации — отдельная палитра, отдельные пары.
 *
 * У рельса свои токены `--rail-*`, не зависящие от темы страницы (так же, как в
 * Pulse), и проверять их надо ОТДЕЛЬНО. Иначе получается ровно та слепота, из-за
 * которой `--surface-raised` едва не проехал непроверенным: гейт зелен на
 * страничных грунтах и ничего не знает о тёмной панели, на которой набрана
 * половина навигации.
 *
 * Грунтов два: сам рельс и подложка активного пункта. Пункт под курсором и
 * активный пункт лежат на `--rail-hover`, и текста там столько же.
 *
 * Порог обычный у всех трёх ролей, включая `--rail-text-dim`: ею набраны
 * надзаголовок группы (10px) и метка класса нехватки (9.5px) — это мелкий
 * текст. Урок `Ф-33` дословно: порог берётся из употребления, а не из замысла.
 */
{
  const tokens = tokensOf(css, ":root");

  const rail = parseHex(tokens.get("rail") ?? "");
  const railHover = parseHex(tokens.get("rail-hover") ?? "");
  if (rail === undefined || railHover === undefined) {
    throw new Error("Нет токенов --rail / --rail-hover");
  }

  const grounds = [
    { name: "rail", value: rail },
    { name: "rail-hover", value: railHover },
  ] as const;

  for (const role of ["rail-text", "rail-text-strong", "rail-text-dim"] as const) {
    const colour = resolve(tokens, role, rail);
    if (colour === undefined) {
      throw new Error(`Нет токена --${role}`);
    }
    for (const ground of grounds) {
      check("рельс", `--${role} на --${ground.name}`, colour, ground.value, AA_NORMAL);
    }
  }

  // Брэнд на рельсе: им набраны отметка продукта и инициал в подвале. Берётся
  // тёмная роль брэнда — рельс тёмный независимо от темы страницы.
  const darkTokens = tokensOf(css, '[data-theme="dark"]');
  const brand = resolve(darkTokens, "brand", rail);
  if (brand !== undefined) {
    check("рельс", "--brand (тёмная) на --rail", brand, rail, AA_NORMAL);
  }
}

/**
 * ПРОЗРАЧНОСТЬ У ТЕКСТА — СПОСОБ ПРОЙТИ ЭТОТ ГЕЙТ, НЕ ВЫПОЛНИВ ТРЕБОВАНИЕ.
 *
 * Гейт считает ПАРЫ ТОКЕНОВ. `opacity` смешивает цвет уже после подстановки
 * токена, то есть остаётся невидимой для расчёта: счётчик у вкладки был
 * `opacity: 0.6` и давал 2.8:1 при норме 4.5:1 — 62 пары были зелёными, а axe
 * нашёл нарушение на экране (`Ф-140`, тот же класс, что `Ф-33`).
 *
 * Поэтому правило машинное: в правиле, которое задаёт цвет или кегль,
 * прозрачности быть не может. Оттенок берётся из палитры, где он проверяется
 * вычислением. Прозрачность у рамок, теней и подложек не запрещена — там она
 * не подменяет цвет ТЕКСТА.
 */
const текстовыеПравила = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((rule) => {
  const body = rule[2] ?? "";
  return /\bopacity\s*:/.test(body) && /font-size\s*:|(?<!-)\bcolor\s*:/.test(body);
});

if (текстовыеПравила.length > 0) {
  process.stdout.write(
    `Прозрачность у текста: ${текстовыеПравила.length} правил(о). Гейт контраста их не проверяет.\n\n`,
  );

  for (const rule of текстовыеПравила) {
    const selector = (rule[1] ?? "").trim().split("\n").pop()?.trim() ?? "";
    process.stdout.write(`  ${selector}\n`);
  }

  process.stdout.write("\nЗадать тон токеном палитры вместо opacity.\n");
  process.exit(1);
}

if (failures.length > 0) {
  process.stdout.write(`Контраст ниже нормы AA: ${failures.length} из ${checked} пар\n\n`);
  for (const failure of failures) {
    process.stdout.write(
      `  ${failure.theme.padEnd(8)} ${failure.pair.padEnd(38)} ${failure.ratio.toFixed(2)} < ${failure.need}\n`,
    );
  }
  process.stdout.write("\nПравить токены в apps/web/app/globals.css, а не порог.\n");
  process.exit(1);
}

process.stdout.write(`Контраст: ${checked} пар, все не ниже AA.\n`);
