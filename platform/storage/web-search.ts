/**
 * Поиск и чтение страниц для ролей экипажа — кодом, а не `grep` по HTML.
 *
 * НАЙДЕНО ТРЕМЯ ПРОГОНАМИ ДАГЕСТАНА (07–08.09.2026): роли ходили в сеть
 * командами и получали то CAPTCHA (DuckDuckGo, Яндекс, Google с адреса
 * сервера), то подставную выдачу (Bing отдаёт боту Toyota и Gmail на запрос о
 * битуме), то теряли ссылки неверным шаблоном (Марина: «внешние ссылки не
 * возвращены»). А домены в листах брались из памяти модели и выглядели как
 * источники.
 *
 * ЗАМЕРЕНО 08.09.2026: DuckDuckGo ЧЕРЕЗ ПРОКСИ сервера (sing-box,
 * 127.0.0.1:2080) отдаёт настоящую выдачу — pulscen, tt-oil, nefteterminal на
 * запрос о битуме. Напрямую — 202 и страница «anomaly» (CAPTCHA).
 *
 * ПОЭТОМУ ПОИСК — ОДИН ИНСТРУМЕНТ С ЦЕПОЧКОЙ КАНАЛОВ, и каждый канал назван в
 * ответе: API поиска по ключу (Brave, Serper), DuckDuckGo через прокси и
 * напрямую, публичные SearXNG с JSON, и в конце — Bing с ОТБРАКОВКОЙ: выдача,
 * в которой ни один результат не несёт слова запроса, — подставная и
 * отбрасывается словом, а не отдаётся роли. Пустая выдача — тоже результат:
 * роль пишет «источник недоступен» и берёт диапазон навыка с ⚠.
 *
 * Прокси — из `STROYINTELLECT_SEARCH_PROXY`; каналы через него идут первыми,
 * потому что именно он отличает выдачу от CAPTCHA.
 */
import { ProxyAgent, fetch as undiciFetch } from "undici";

export interface SearchHit {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

export interface SearchResult {
  readonly query: string;
  /** Канал, давший выдачу; «нет» — все отказали. */
  readonly engine: string;
  readonly hits: readonly SearchHit[];
  /** Какие каналы отказали и почему — роль переносит в лист словами. */
  readonly note: string;
  readonly fetchedAt: string;
}

export interface HttpAnswer {
  readonly status: number;
  readonly text: string;
}

export interface SearchOptions {
  readonly env?: NodeJS.ProcessEnv;
  /** Подмена сети — тестам; получает адрес, заголовки и признак «через прокси». */
  readonly get?: (url: string, headers: Record<string, string>, viaProxy: boolean) => Promise<HttpAnswer>;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const TIMEOUT_MS = 20_000;
const MAX_HITS = 10;
const MAX_PAGE_CHARS = 400_000;

async function httpGet(url: string, headers: Record<string, string>, viaProxy: boolean, env: NodeJS.ProcessEnv): Promise<HttpAnswer> {
  const proxy = env["STROYINTELLECT_SEARCH_PROXY"];
  const dispatcher = viaProxy && proxy ? new ProxyAgent(proxy) : undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await undiciFetch(url, {
      headers: { "user-agent": UA, "accept-language": "ru-RU,ru;q=0.9", ...headers },
      signal: controller.signal,
      redirect: "follow",
      ...(dispatcher === undefined ? {} : { dispatcher }),
    });
    return { status: response.status, text: await response.text() };
  } finally {
    clearTimeout(timer);
    await dispatcher?.close();
  }
}

/** Текст из HTML: без скриптов, стилей, тегов и сущностей. */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

/** Слова запроса длиннее трёх знаков — ими проверяется, о том ли выдача. */
function keywords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 3);
}

/** Выдача о том, о чём спрашивали: хотя бы один результат несёт слово запроса. */
export function relevant(hits: readonly SearchHit[], query: string): boolean {
  const words = keywords(query);
  if (words.length === 0) return hits.length > 0;
  return hits.some((hit) => {
    const text = `${hit.title} ${hit.snippet} ${hit.url}`.toLowerCase();
    return words.some((word) => text.includes(word));
  });
}

/** Ссылка DuckDuckGo `//duckduckgo.com/l/?uddg=<url>&rut=…` → настоящий адрес. */
export function unwrapDuckDuckGo(url: string): string {
  const match = /[?&]uddg=([^&]+)/.exec(url);
  if (match !== null) {
    try {
      return decodeURIComponent(match[1]!);
    } catch {
      return url;
    }
  }
  return url.startsWith("//") ? `https:${url}` : url;
}

/** Ссылка Bing `ck/a?…&u=a1<base64>` → настоящий адрес. */
export function unwrapBing(url: string): string {
  const match = /[?&]u=a1([A-Za-z0-9_-]+)/.exec(url);
  if (match === null) return url;
  try {
    const padded = match[1]! + "=".repeat((4 - (match[1]!.length % 4)) % 4);
    return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return url;
  }
}

const isAd = (url: string): boolean => /duckduckgo\.com\/y\.js|bing\.com\/aclick|ad_provider=/.test(url);

/** Выдача html.duckduckgo.com: `result__a` — ссылка и заголовок, `result__snippet` — описание. */
export function parseDuckDuckGoHtml(html: string): SearchHit[] {
  if (/anomaly-modal|class="anomaly|Unfortunately, bots use DuckDuckGo too/i.test(html)) throw new Error("CAPTCHA");
  const hits: SearchHit[] = [];
  for (const block of html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/).slice(1)) {
    const link = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (link === null) continue;
    const url = unwrapDuckDuckGo(stripHtml(link[1]!));
    if (isAd(url) || isAd(link[1]!)) continue;
    const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    hits.push({ title: stripHtml(link[2]!), url, snippet: snippet === null ? "" : stripHtml(snippet[1]!) });
  }
  return hits;
}

/** Выдача lite.duckduckgo.com: `result-link` и `result-snippet` в таблице. */
export function parseDuckDuckGoLite(html: string): SearchHit[] {
  if (/anomaly-modal|Unfortunately, bots use DuckDuckGo too/i.test(html)) throw new Error("CAPTCHA");
  const hits: SearchHit[] = [];
  const links = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]+class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/g)];
  const snippets = [...html.matchAll(/<td[^>]+class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g)];
  links.forEach((link, index) => {
    const url = unwrapDuckDuckGo(stripHtml(link[1]!));
    if (isAd(url) || isAd(link[1]!)) return;
    hits.push({ title: stripHtml(link[2]!), url, snippet: snippets[index] === undefined ? "" : stripHtml(snippets[index]![1]!) });
  });
  return hits;
}

/** Выдача Bing: блоки `b_algo`. */
export function parseBingHtml(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const block of html.matchAll(/<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/g)) {
    const link = /<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block[1]!);
    if (link === null) continue;
    const snippet = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block[1]!);
    hits.push({ title: stripHtml(link[2]!), url: unwrapBing(stripHtml(link[1]!)), snippet: snippet === null ? "" : stripHtml(snippet[1]!) });
  }
  return hits;
}

interface Channel {
  readonly name: string;
  readonly run: () => Promise<SearchHit[]>;
}

function statusOk(answer: HttpAnswer): HttpAnswer {
  if (answer.status === 202) throw new Error("CAPTCHA (HTTP 202)");
  if (answer.status !== 200) throw new Error(`HTTP ${answer.status}`);
  return answer;
}

/**
 * Каналы поиска в порядке доверия. Прокси-варианты идут перед прямыми: с
 * адреса сервера поисковики отвечают CAPTCHA, через прокси — выдачей.
 */
function channelsFor(query: string, env: NodeJS.ProcessEnv, get: NonNullable<SearchOptions["get"]>): Channel[] {
  const q = encodeURIComponent(query);
  const routes: readonly (readonly [string, boolean])[] = env["STROYINTELLECT_SEARCH_PROXY"] ? [["через прокси", true], ["напрямую", false]] : [["напрямую", false]];
  const channels: Channel[] = [];

  const braveKey = env["STROYINTELLECT_BRAVE_SEARCH_KEY"];
  if (braveKey) {
    channels.push({
      name: "Brave Search API",
      run: async () => {
        const { text } = statusOk(
          await get(`https://api.search.brave.com/res/v1/web/search?q=${q}&country=RU&search_lang=ru&count=${MAX_HITS}`, { accept: "application/json", "x-subscription-token": braveKey }, false),
        );
        const data = JSON.parse(text) as { web?: { results?: { title: string; url: string; description?: string }[] } };
        return (data.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description ?? "" }));
      },
    });
  }

  const serperKey = env["STROYINTELLECT_SERPER_KEY"];
  if (serperKey) {
    channels.push({
      name: "Serper (Google)",
      run: async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
          const response = await undiciFetch("https://google.serper.dev/search", {
            method: "POST",
            headers: { "X-API-KEY": serperKey, "content-type": "application/json" },
            body: JSON.stringify({ q: query, gl: "ru", hl: "ru", num: MAX_HITS }),
            signal: controller.signal,
          });
          if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
          const data = (await response.json()) as { organic?: { title: string; link: string; snippet?: string }[] };
          return (data.organic ?? []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet ?? "" }));
        } finally {
          clearTimeout(timer);
        }
      },
    });
  }

  for (const [label, viaProxy] of routes) {
    channels.push({
      name: `DuckDuckGo HTML ${label}`,
      run: async () => parseDuckDuckGoHtml(statusOk(await get(`https://html.duckduckgo.com/html/?q=${q}&kl=ru-ru`, {}, viaProxy)).text),
    });
  }
  for (const [label, viaProxy] of routes) {
    channels.push({
      name: `DuckDuckGo Lite ${label}`,
      run: async () => parseDuckDuckGoLite(statusOk(await get(`https://lite.duckduckgo.com/lite/?q=${q}&kl=ru-ru`, {}, viaProxy)).text),
    });
  }

  const searx = (env["STROYINTELLECT_SEARXNG_HOSTS"] ?? "").split(",").map((h) => h.trim()).filter((h) => h !== "");
  for (const host of searx) {
    for (const [label, viaProxy] of routes) {
      channels.push({
        name: `SearXNG ${host} ${label}`,
        run: async () => {
          const { text } = statusOk(await get(`https://${host}/search?q=${q}&format=json&language=ru-RU`, { accept: "application/json" }, viaProxy));
          const data = JSON.parse(text) as { results?: { title: string; url: string; content?: string }[] };
          return (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? "" }));
        },
      });
    }
  }

  for (const [label, viaProxy] of routes) {
    channels.push({
      name: `Bing HTML ${label}`,
      run: async () => parseBingHtml(statusOk(await get(`https://www.bing.com/search?q=${q.replace(/%20/g, "+")}&cc=RU&setlang=ru`, {}, viaProxy)).text),
    });
  }

  return channels;
}

/**
 * Ищет по каналам по очереди; первый канал с РЕЛЕВАНТНОЙ выдачей выигрывает.
 * В ответе — имя канала и заметка: какие каналы отказали и почему.
 */
export async function searchWeb(query: string, options: SearchOptions = {}): Promise<SearchResult> {
  const env = options.env ?? process.env;
  const get = options.get ?? ((url, headers, viaProxy) => httpGet(url, headers, viaProxy, env));
  const fetchedAt = new Date().toISOString();
  const notes: string[] = [];

  for (const channel of channelsFor(query, env, get)) {
    try {
      const hits = await channel.run();
      if (hits.length === 0) {
        notes.push(`${channel.name}: пусто`);
        continue;
      }
      if (!relevant(hits, query)) {
        notes.push(`${channel.name}: выдача не о запросе (подставная), отброшена`);
        continue;
      }
      return {
        query,
        engine: channel.name,
        hits: hits.slice(0, MAX_HITS),
        note: notes.length === 0 ? "первый канал ответил" : `отказали: ${notes.join("; ")}`,
        fetchedAt,
      };
    } catch (error) {
      notes.push(`${channel.name}: ${(error as Error).message}`);
    }
  }

  return { query, engine: "нет", hits: [], note: `все каналы отказали: ${notes.join("; ")}`, fetchedAt };
}

export interface PageText {
  readonly url: string;
  readonly status: string;
  readonly chars: number;
  readonly text: string;
  /** Строки, где рядом с числом стоит «руб», «₽» или «р.». */
  readonly prices: readonly string[];
  readonly fetchedAt: string;
}

/** Строки с ценами из текста страницы — то, что роль переносит в лист. */
export function priceLines(text: string): string[] {
  // Границей строки служит точка перед заглавной буквой (конец фразы), а не
  // точка в «фр. 40-70» или «руб./т»: иначе строка прайса режется пополам.
  return [...text.matchAll(/(?:(?!\.\s[\p{Lu}])[^;|\n]){0,90}\d[\d\s ]{0,12}(?:[.,]\d+)?\s?(?:руб\.?|₽|тыс\.?\s?руб\.?|р\.)(?:\s?\/\s?\S+)?(?:(?!\.\s[\p{Lu}])[^;|\n]){0,60}/giu)]
    .map((m) => m[0].replace(/\s+/g, " ").trim())
    .filter((line, index, all) => all.indexOf(line) === index)
    .slice(0, 40);
}

/**
 * Текст страницы без разметки и строки с ценами. Напрямую, а если страница не
 * открылась (ошибка сети, 403, 429, 5xx) и прокси задан — ещё раз через него.
 */
export async function readPageText(url: string, options: SearchOptions = {}): Promise<PageText> {
  const env = options.env ?? process.env;
  const get = options.get ?? ((u, headers, viaProxy) => httpGet(u, headers, viaProxy, env));
  const fetchedAt = new Date().toISOString();
  const attempts: readonly boolean[] = env["STROYINTELLECT_SEARCH_PROXY"] ? [false, true] : [false];

  let status = "";
  for (const viaProxy of attempts) {
    try {
      const answer = await get(url, {}, viaProxy);
      status = `HTTP ${answer.status}${viaProxy ? " через прокси" : ""}`;
      if (answer.status >= 400 && answer.status !== 404 && viaProxy !== attempts.at(-1)) continue;
      const text = stripHtml(answer.text).slice(0, MAX_PAGE_CHARS);
      return { url, status, chars: text.length, text, prices: priceLines(text), fetchedAt };
    } catch (error) {
      status = `недоступна${viaProxy ? " и через прокси" : ""}: ${(error as Error).message}`;
    }
  }
  return { url, status, chars: 0, text: "", prices: [], fetchedAt };
}
