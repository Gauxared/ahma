/**
 * Парсеры площадок цен — на разметке, снятой с сервера 08.09.2026 (Avito
 * Дагестан по битуму, tradedir по битуму БНД 70/100), укороченной до двух
 * карточек. Сеть подменяется целиком.
 */
import { describe, expect, it } from "vitest";

import { type MarketRegistry, type PriceOffer, renderPriceReport, searchPrices } from "./market-prices.js";

const AVITO = `
<div data-marker="catalog-serp">
<div data-marker="item" data-item-id="1"><div><h2><a itemProp="url" title="Битум бнд 70 100 в Махачкале" data-marker="item-title" href="/makhachkala/remont_i_stroitelstvo/bitum_bnd_70_100_8354366579?context=abc" class="x">Битум бнд 70 100</a></h2></div>
<p data-marker="item-price" itemProp="offers"><span><meta itemProp="price" content="52000"/><p data-marker="item-price-value" class="y">52 000 ₽ <div class="corner"></div></p></span></p>
<div data-marker="item-location"><div><p class="z"><span title=""><span class="pin"><svg></svg></span>Махачкала, Кирова 1</span></p></div></div>
<p data-marker="item-date">7 дней назад <button></button></p></div>
<div data-marker="item" data-item-id="2"><div><h2><a itemProp="url" title="Битум дорожный" data-marker="item-title" href="/tolyatti/remont_i_stroitelstvo/bitum_dorozhnyy_70100_4057249359?slocation=646710" class="x">Битум дорожный 70/100</a></h2></div>
<p data-marker="item-price-value" class="y">1 700 ₽ с НДС</p>
<div data-marker="item-location"><p class="z"><span><svg data-icon-name="localshipping"></svg></span></p></div>
<div data-marker="item-line"><a target="_blank" href="/brands/2b68" title="ООО Битумная компания">…</a></div>
</div>
</div>`;

const TRADEDIR = `
<ul>
<li class="clear "><div class="tovar"><div class="wrap clear"><div class="descr"><div class="title"><a href="https://kemerovo.tradedir.ru/good/p960777-bitum_neftyanoj_dorozhnyj_70100.htm">Битум нефтяной дорожный 70/100</a></div>
<div class="price"> <span class="descr_price">цена по запросу</span> <a href="#" class="buy" onclick="x">Купить</a></div></div></div></div>
<div class="contact"><ul><li class="name goodc "><a href="https://kemerovo.tradedir.ru/comp/c641942-tk_meroks_ooo.htm" class="hover-orange shadow" title='Проверенный поставщик'>&quot;ТК &quot;Мерокс&quot; ООО</a> </li><li class="descr shadow">Кемерово </li><li class="added">08.09.26</li></ul></div></li>
<li class="clear "><div class="tovar"><div class="wrap clear"><div class="descr"><div class="title"><a href="https://makhachkala.tradedir.ru/good/p1-bitum.htm">Битум БНД 70/100 наливом</a></div>
<div class="price">  <strong class="new">54 000 руб./т.</strong> <a href="#" class="buy" onclick="x">Купить</a></div></div></div></div>
<div class="contact"><ul><li class="name goodc "><a href="https://makhachkala.tradedir.ru/comp/c2-dagbitum.htm" class="hover-orange shadow">ДагБитум ООО</a> </li><li class="descr shadow">Махачкала </li><li class="added">01.09.26</li></ul></div></li>
</ul>`;

const РЕЕСТР: MarketRegistry = {
  регионы: [
    { регион: "Дагестан", слаг: "dagestan", города: ["dagestan", "makhachkala"] },
    { регион: "Россия", слаг: "rossiya", города: [] },
  ],
  поставщики: [
    { регион: "Дагестан", город: "Махачкала", название: "Щебень-РФ", url: "https://mahachkala.scheben-rf.ru/price/", товары: ["щебень", "отсев"] },
    { регион: "Россия", город: "РФ", название: "ТТ-Ойл", url: "https://tt-oil.ru/bitum", товары: ["битум"] },
  ],
};

/** Предложения одной площадки: остальная сеть молчит, поиск пуст. */
async function предложения(источник: "avito" | "tradedir", html: string): Promise<PriceOffer[]> {
  const отчёт = await searchPrices("битум БНД 70/100", "Дагестан", {
    env: {},
    registry: { ...РЕЕСТР, поставщики: [] },
    get: async (url) => (url.includes(источник) ? { status: 200, text: html } : { status: 404, text: "" }),
    search: async (q) => ({
      query: q,
      engine: "тест",
      hits: источник === "tradedir" ? [{ title: "", url: "https://www.tradedir.ru/good/bitum_bnd_70100.html", snippet: "" }] : [],
      note: "",
      fetchedAt: "",
    }),
  });
  return отчёт.offers.filter((o) => o.source === источник).sort((a, b) => (a.inRegion === b.inRegion ? 0 : a.inRegion ? -1 : 1));
}

describe("разбор площадок", () => {
  it("Avito: заголовок, цена, город из ссылки и адреса, признак региона", async () => {
    const [первое, второе] = await предложения("avito", AVITO);

    expect(первое).toMatchObject({
      name: "Битум бнд 70 100",
      price: "52 000 ₽",
      city: "Махачкала, Кирова 1",
      inRegion: true,
      url: "https://www.avito.ru/makhachkala/remont_i_stroitelstvo/bitum_bnd_70_100_8354366579",
      date: "7 дней назад",
      source: "avito",
    });
    expect(второе).toMatchObject({ price: "1 700 ₽ с НДС", city: "tolyatti", inRegion: false, seller: "ООО Битумная компания" });
  });

  it("tradedir: товар, цена или «по запросу», поставщик, город, дата, регион по поддомену", async () => {
    const [махачкала, кемерово] = await предложения("tradedir", TRADEDIR);

    expect(кемерово).toMatchObject({
      name: "Битум нефтяной дорожный 70/100",
      price: "цена по запросу",
      seller: '"ТК "Мерокс" ООО',
      city: "Кемерово",
      inRegion: false,
      date: "08.09.26",
      source: "tradedir",
    });
    expect(махачкала).toMatchObject({ price: "54 000 руб./т.", seller: "ДагБитум ООО", city: "Махачкала", inRegion: true });
  });
});

describe("цены по региону", () => {
  it("собирает Avito, tradedir через поиск и прайсы поставщиков; в регионе — первыми", async () => {
    const запросы: string[] = [];
    const отчёт = await searchPrices("битум БНД 70/100", "Дагестан", {
      env: {},
      registry: РЕЕСТР,
      get: async (url) => {
        запросы.push(url);
        if (url.startsWith("https://www.avito.ru/dagestan/remont_i_stroitelstvo?q=")) return { status: 200, text: AVITO };
        if (url.includes("tradedir.ru/good/")) return { status: 200, text: TRADEDIR };
        if (url.includes("tt-oil.ru")) return { status: 200, text: "<p>Битум БНД 70/100 — 51 500 руб./т с НДС.</p><p>Мастика 90 руб./кг.</p>" };
        throw new Error("ECONNREFUSED " + url);
      },
      search: async (q) => ({ query: q, engine: "тест", hits: [{ title: "Битум", url: "https://www.tradedir.ru/good/bitum_bnd_70100.html", snippet: "" }], note: "", fetchedAt: "" }),
    });

    expect(отчёт.region).toBe("Дагестан");
    expect(отчёт.offers.map((o) => `${o.source}:${o.inRegion}`)).toEqual(["avito:true", "tradedir:true", "avito:false", "tradedir:false"]);
    // Щебень-РФ не подходит к запросу о битуме — не открывается; ТТ-Ойл (Россия, битум) — открывается.
    expect(отчёт.suppliers.map((s) => s.name)).toEqual(["ТТ-Ойл"]);
    expect(отчёт.suppliers[0]!.lines).toEqual(["Битум БНД 70/100 — 51 500 руб./т с НДС"]);
    expect(запросы.some((u) => u.includes("scheben-rf"))).toBe(false);

    const текст = renderPriceReport(отчёт);
    expect(текст).toContain("✅ в регионе");
    expect(текст).toContain("⚠ вне региона");
    expect(текст).toContain("ПОСТАВЩИК ТТ-Ойл (РФ) · HTTP 200");
  });

  it("лимит Avito и пустой поиск — отказ словом, а не пустая таблица без объяснения", async () => {
    const отчёт = await searchPrices("щебень 40-80", "Дагестан", {
      env: {},
      registry: РЕЕСТР,
      get: async (url) => (url.includes("avito") ? { status: 429, text: "" } : { status: 200, text: "<p>Щебень фр. 40-70 От 2150 руб за м3</p>" }),
      search: async (q) => ({ query: q, engine: "нет", hits: [], note: "все каналы отказали", fetchedAt: "" }),
    });

    expect(отчёт.offers).toEqual([]);
    expect(отчёт.notes[0]).toContain("Avito: 429");
    expect(отчёт.notes[1]).toContain("tradedir: страница товара не найдена");
    expect(отчёт.suppliers[0]).toMatchObject({ name: "Щебень-РФ", lines: ["Щебень фр. 40-70 От 2150 руб за м3"] });
  });

  it("неизвестный регион сводится к общероссийским источникам", async () => {
    const отчёт = await searchPrices("битум", "Луна", {
      env: {},
      registry: РЕЕСТР,
      get: async () => ({ status: 404, text: "" }),
      search: async (q) => ({ query: q, engine: "нет", hits: [], note: "", fetchedAt: "" }),
    });
    expect(отчёт.region).toBe("Россия");
    expect(отчёт.suppliers.map((s) => s.name)).toEqual(["ТТ-Ойл"]);
  });
});
