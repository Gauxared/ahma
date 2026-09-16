/**
 * Рыночные цены для листа `market_check` — парсеры конкретных площадок, а не
 * поисковик общего назначения.
 *
 * ПОЧЕМУ. Прогон 13 (08.09.2026) показал: поисковик через прокси находит
 * каталоги, но выдача по «Дагестан 2026» — Екатеринбург и Москва; роли
 * вписывали url, не открыв страницу («цена не извлечена»). При этом с адреса
 * сервера ОТКРЫВАЮТСЯ: Avito по региону (50 объявлений с ценой, продавцом и
 * городом в ссылке), tradedir.ru (карточки поставщиков с городом и датой),
 * региональные прайсы поставщиков из навыка легаси (Щебень-РФ Махачкала —
 * 40 строк цен). Закрыты: pulscen (проверка JavaScript), tiu.ru (сменил
 * владельца, теперь букмекеры), satom/blizko/regmarkets.
 *
 * Три источника собираются в одну таблицу предложений с городом продавца и
 * признаком «в регионе объекта»; страница поставщика читается кодом и даёт
 * строки цен. Что не открылось — названо словом, не пропущено.
 */
import { readFileSync } from "node:fs";

import { type HttpAnswer, readPageText, type SearchOptions, searchWeb, stripHtml } from "./web-search.js";

export interface PriceOffer {
  readonly name: string;
  /** Цена как на площадке: «1 600 ₽», «660 $/т.», «цена по запросу». */
  readonly price: string;
  readonly seller: string;
  /** Город продавца — слаг из ссылки Avito или текст tradedir. */
  readonly city: string;
  /** Город продавца входит в регион объекта. */
  readonly inRegion: boolean;
  readonly url: string;
  readonly date: string;
  readonly source: "avito" | "tradedir";
}

export interface SupplierPrices {
  readonly name: string;
  readonly city: string;
  readonly url: string;
  readonly status: string;
  /** Строки с ценами; сначала те, где есть слова запроса. */
  readonly lines: readonly string[];
}

export interface PriceReport {
  readonly query: string;
  readonly region: string;
  readonly offers: readonly PriceOffer[];
  readonly suppliers: readonly SupplierPrices[];
  readonly notes: readonly string[];
  readonly fetchedAt: string;
}

interface RegionEntry {
  readonly регион: string;
  readonly слаг: string;
  readonly города: readonly string[];
}

interface SupplierEntry {
  readonly регион: string;
  readonly город: string;
  readonly название: string;
  readonly url: string;
  readonly товары: readonly string[];
}

export interface MarketRegistry {
  readonly регионы: readonly RegionEntry[];
  readonly поставщики: readonly SupplierEntry[];
}

const REGISTRY_URL = new URL("../../config/market/поставщики.json", import.meta.url);

function loadMarketRegistry(): MarketRegistry {
  return JSON.parse(readFileSync(REGISTRY_URL, "utf8")) as MarketRegistry;
}

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3);

function regionOf(registry: MarketRegistry, region: string): RegionEntry {
  const wanted = region.trim().toLowerCase();
  return (
    registry.регионы.find((r) => r.регион.toLowerCase() === wanted || r.слаг === wanted) ??
    registry.регионы.find((r) => wanted !== "" && (r.регион.toLowerCase().includes(wanted) || wanted.includes(r.регион.toLowerCase()))) ??
    registry.регионы.find((r) => r.слаг === "rossiya") ?? { регион: region, слаг: "rossiya", города: [] }
  );
}

/** Объявления Avito: заголовок, цена, город из ссылки, дата. */
function parseAvito(html: string, cities: readonly string[]): PriceOffer[] {
  const offers: PriceOffer[] = [];
  const blocks = html.split(/data-marker="item"/).slice(1);
  for (const block of blocks) {
    const title = /data-marker="item-title"[^>]*>([^<]+)</.exec(block);
    const href = /data-marker="item-title"[^>]*href="([^"?]+)/.exec(block);
    if (title === null || href === null) continue;
    const price = /data-marker="item-price-value"[^>]*>([^<]+)/.exec(block);
    const date = /data-marker="item-date"[^>]*>([^<]+)/.exec(block);
    const location = /data-marker="item-location"[^>]*>([\s\S]{0,3000}?)<\/p>/.exec(block);
    const seller = /data-marker="seller-info\/name"[^>]*>([^<]+)</.exec(block) ?? /data-marker="item-line"[\s\S]{0,600}?title="([^"]+)"/.exec(block);
    const citySlug = href[1]!.split("/").filter((s) => s !== "")[0] ?? "";
    offers.push({
      name: stripHtml(title[1]!),
      price: price === null ? "цена не указана" : stripHtml(price[1]!),
      seller: seller === null ? "" : stripHtml(seller[1]!),
      city: location === null || stripHtml(location[1]!) === "" ? citySlug : stripHtml(location[1]!),
      inRegion: cities.includes(citySlug),
      url: `https://www.avito.ru${href[1]!}`,
      date: date === null ? "" : stripHtml(date[1]!),
      source: "avito",
    });
  }
  return offers;
}

/** Карточки tradedir.ru: товар, цена или «по запросу», поставщик, город, дата. */
function parseTradedir(html: string, regionCities: readonly string[], regionName: string): PriceOffer[] {
  const offers: PriceOffer[] = [];
  const cards = html.split(/<div class="tovar">/).slice(1);
  const known = new Set(regionCities.map((c) => c.toLowerCase()));
  for (const card of cards) {
    const title = /<div class="title"><a href="([^"]+)"[^>]*>([^<]+)</.exec(card);
    if (title === null) continue;
    const price = /<div class="price">([\s\S]*?)<a href="#" class="buy"/.exec(card);
    const seller = /<li class="name[^"]*"><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(card);
    const city = /<li class="descr[^"]*">([^<]*)</.exec(card);
    const date = /<li class="added">([^<]*)</.exec(card);
    const cityText = city === null ? "" : stripHtml(city[1]!);
    const sellerSlug = seller === null ? "" : new URL(seller[1]!).hostname.split(".")[0] ?? "";
    offers.push({
      name: stripHtml(title[2]!),
      price: price === null ? "цена не указана" : stripHtml(price[1]!) || "цена не указана",
      seller: seller === null ? "" : stripHtml(seller[2]!),
      city: cityText,
      inRegion: known.has(sellerSlug) || (regionName !== "" && cityText.toLowerCase().includes(regionName.toLowerCase())),
      url: title[1]!,
      date: date === null ? "" : stripHtml(date[1]!),
      source: "tradedir",
    });
  }
  return offers;
}

export interface PriceOptions extends SearchOptions {
  readonly registry?: MarketRegistry;
  /** Подмена поиска — тестам. */
  readonly search?: typeof searchWeb;
}

/**
 * Цены по запросу в регионе: Avito региона, tradedir через поиск, страницы
 * курируемых поставщиков региона и общероссийских. Каждый отказ — в notes.
 */
export async function searchPrices(query: string, region: string, options: PriceOptions = {}): Promise<PriceReport> {
  const registry = options.registry ?? loadMarketRegistry();
  const env = options.env ?? process.env;
  const entry = regionOf(registry, region);
  const fetchedAt = new Date().toISOString();
  const notes: string[] = [];
  const offers: PriceOffer[] = [];
  const queryWords = words(query);

  // ── Avito региона ────────────────────────────────────────────────────────
  const avitoUrl = `https://www.avito.ru/${entry.слаг}/remont_i_stroitelstvo?q=${encodeURIComponent(query)}`;
  const avitoPage = await pageOf(avitoUrl, options, env);
  if (avitoPage.status === 200) {
    const parsed = parseAvito(avitoPage.text, entry.города);
    if (parsed.length === 0) notes.push("Avito: страница открылась, объявлений не разобрано");
    offers.push(...parsed);
  } else {
    notes.push(`Avito: ${avitoPage.status === 429 ? "429 — лимит запросов, повторить позже" : `HTTP ${avitoPage.status}`}`);
  }

  // ── tradedir через поиск ─────────────────────────────────────────────────
  const search = options.search ?? searchWeb;
  const found = await search(`${query} site:tradedir.ru`, { ...(options.env === undefined ? {} : { env: options.env }), ...(options.get === undefined ? {} : { get: options.get }) });
  const tradedirUrl = found.hits.find((h) => /tradedir\.ru\/good\//.test(h.url))?.url;
  if (tradedirUrl === undefined) {
    notes.push(`tradedir: страница товара не найдена поиском (${found.engine}: ${found.note})`);
  } else {
    const page = await pageOf(tradedirUrl, options, env);
    if (page.status === 200) {
      const parsed = parseTradedir(page.text, entry.города, entry.регион);
      if (parsed.length === 0) notes.push(`tradedir: ${tradedirUrl} открылась, карточек не разобрано`);
      offers.push(...parsed);
    } else {
      notes.push(`tradedir: HTTP ${page.status} на ${tradedirUrl}`);
    }
  }

  // ── Поставщики региона и общероссийские ──────────────────────────────────
  const matching = registry.поставщики.filter(
    (s) => (s.регион === entry.регион || s.регион === "Россия") && (s.товары.includes("*") || s.товары.some((t) => queryWords.some((w) => w.includes(t.toLowerCase()) || t.toLowerCase().includes(w)))),
  );
  const suppliers: SupplierPrices[] = [];
  for (const s of matching) {
    const page = await readPageText(s.url, { ...(options.env === undefined ? {} : { env: options.env }), ...(options.get === undefined ? {} : { get: options.get }) });
    const relevantLines = page.prices.filter((line) => queryWords.some((w) => line.toLowerCase().includes(w)));
    suppliers.push({
      name: s.название,
      city: s.город,
      url: s.url,
      status: page.status,
      lines: (relevantLines.length > 0 ? relevantLines : page.prices).slice(0, 15),
    });
  }
  if (matching.length === 0) notes.push(`поставщики: в реестре нет источника по «${query}» для региона «${entry.регион}»`);

  // В регионе — первыми; остальные — как ориентир с пометкой.
  offers.sort((a, b) => Number(b.inRegion) - Number(a.inRegion));

  return { query, region: entry.регион, offers, suppliers, notes, fetchedAt };
}

async function pageOf(url: string, options: PriceOptions, env: NodeJS.ProcessEnv): Promise<HttpAnswer> {
  if (options.get !== undefined) return options.get(url, {}, false);
  const page = await readPageTextRaw(url, env);
  return page;
}

/** Сырой HTML нужен парсерам: readPageText снимает разметку, здесь — нет. */
async function readPageTextRaw(url: string, env: NodeJS.ProcessEnv): Promise<HttpAnswer> {
  const { fetch: undiciFetch, ProxyAgent } = await import("undici");
  const attempts: readonly boolean[] = env["STROYINTELLECT_SEARCH_PROXY"] ? [false, true] : [false];
  let last: HttpAnswer = { status: 0, text: "" };
  for (const viaProxy of attempts) {
    const proxy = env["STROYINTELLECT_SEARCH_PROXY"];
    const dispatcher = viaProxy && proxy ? new ProxyAgent(proxy) : undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await undiciFetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
          "accept-language": "ru-RU,ru;q=0.9",
        },
        signal: controller.signal,
        redirect: "follow",
        ...(dispatcher === undefined ? {} : { dispatcher }),
      });
      last = { status: response.status, text: await response.text() };
      if (last.status < 400) return last;
    } catch (error) {
      last = { status: 0, text: (error as Error).message };
    } finally {
      clearTimeout(timer);
      await dispatcher?.close();
    }
  }
  return last;
}

/** Таблица для роли: предложения с городом и признаком региона, строки прайсов поставщиков. */
export function renderPriceReport(report: PriceReport): string {
  const lines: string[] = [];
  lines.push(`ЦЕНЫ: «${report.query}» · регион ${report.region} · ${report.fetchedAt.slice(0, 10)} · источники: Avito региона, tradedir.ru, прайсы поставщиков (config/market/поставщики.json)`);
  if (report.offers.length > 0) {
    lines.push("");
    lines.push("ПРЕДЛОЖЕНИЯ (в регионе объекта — первыми; «вне региона» — ориентир без доставки):");
    lines.push("  наименование | цена | продавец | город | регион | дата | источник | url");
    for (const o of report.offers.slice(0, 30)) {
      lines.push(`  ${o.name} | ${o.price} | ${o.seller || "—"} | ${o.city || "—"} | ${o.inRegion ? "✅ в регионе" : "⚠ вне региона"} | ${o.date || "—"} | ${o.source} | ${o.url}`);
    }
  }
  for (const s of report.suppliers) {
    lines.push("");
    lines.push(`ПОСТАВЩИК ${s.name} (${s.city}) · ${s.status} · ${s.url}`);
    if (s.lines.length === 0) lines.push("  строк с ценами не найдено — цена по запросу или прайс картинкой");
    for (const line of s.lines) lines.push("  · " + line);
  }
  if (report.notes.length > 0) {
    lines.push("");
    lines.push("НЕ ОТВЕТИЛИ: " + report.notes.join("; "));
  }
  if (report.offers.length === 0 && report.suppliers.every((s) => s.lines.length === 0)) {
    lines.push("");
    lines.push("Цен не найдено: в листе пиши «источник недоступен: <заметка выше>» и бери диапазон навыка construction-cost-analysis со статусом ⚠.");
  }
  lines.push("");
  lines.push("Каждая цифра в лист — с тегом [ИСТОЧНИК: <url>, <дата>, ✅/⚠]; предложения «вне региона» — только со статусом ⚠ и словами «без доставки до объекта».");
  return lines.join("\n");
}

