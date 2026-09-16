/**
 * Поиск для ролей: каналы по очереди, CAPTCHA и подставная выдача — отказ
 * словом, а не «источник». Сеть подменяется: сюда не ходит ни один запрос.
 */
import { describe, expect, it } from "vitest";

import {
  parseBingHtml,
  parseDuckDuckGoHtml,
  parseDuckDuckGoLite,
  priceLines,
  readPageText,
  relevant,
  searchWeb,
  unwrapBing,
  unwrapDuckDuckGo,
  type HttpAnswer,
} from "./web-search.js";

const ЗАПРОС = "битум БНД 70/100 цена тонна";

const ВЫДАЧА_DDG = `
<div class="serp__results">
<div class="result results_links results_links_deep result--ad">
  <div class="links_main links_deep result__body">
    <h2 class="result__title"><a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad_provider=bingv7aa&amp;u3=https%3A%2F%2Fwww.bing.com%2Faclick">Реклама битума</a></h2>
    <a class="result__snippet" href="https://duckduckgo.com/y.js?ad_provider=bingv7aa">купите у нас</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.pulscen.ru%2Fprice%2F100609-bitum&amp;rut=abc">Битум 70/100 в РОССИИ по выгодной цене</a></h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.pulscen.ru%2Fprice%2F100609-bitum">Битум <b>БНД</b> 70/100 — цена от 52&nbsp;000 руб./т</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ftt-oil.ru%2Fbitum-bnd-70-100&amp;rut=def">Купить битум БНД 70/100 по цене производителя</a></h2>
    <a class="result__snippet" href="#">Отгрузка с завода</a>
  </div>
</div>
</div>`;

const ВЫДАЧА_BING_ПОДСТАВНАЯ = `
<ol id="b_results">
<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;u=a1aHR0cHM6Ly93d3cudG95b3RhLnJ1Lw&amp;ntb=1">Toyota Россия</a></h2><p>Официальный сайт автомобилей</p></li>
<li class="b_algo"><h2><a href="https://mail.google.com/">Gmail</a></h2><p>Почта Google</p></li>
</ol>`;

const CAPTCHA_DDG = `<html><body><div class="anomaly-modal__title">Unfortunately, bots use DuckDuckGo too.</div></body></html>`;

describe("разбор выдачи", () => {
  it("DuckDuckGo HTML: снимает обёртку uddg, пропускает рекламу, чистит описание", () => {
    const результаты = parseDuckDuckGoHtml(ВЫДАЧА_DDG);

    expect(результаты).toHaveLength(2);
    expect(результаты[0]).toEqual({
      title: "Битум 70/100 в РОССИИ по выгодной цене",
      url: "https://www.pulscen.ru/price/100609-bitum",
      snippet: "Битум БНД 70/100 — цена от 52 000 руб./т",
    });
    expect(результаты[1]!.url).toBe("https://tt-oil.ru/bitum-bnd-70-100");
  });

  it("DuckDuckGo: страница «bots use DuckDuckGo too» — это CAPTCHA, а не пустая выдача", () => {
    expect(() => parseDuckDuckGoHtml(CAPTCHA_DDG)).toThrow(/CAPTCHA/);
    expect(() => parseDuckDuckGoLite(CAPTCHA_DDG)).toThrow(/CAPTCHA/);
  });

  it("DuckDuckGo Lite: ссылки и описания из таблицы", () => {
    const html = `<table><tr><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnefteterminal.ru%2Fbitum" class='result-link'>Битум оптом</a></td></tr>
      <tr><td class='result-snippet'>цена за литр</td></tr></table>`;

    expect(parseDuckDuckGoLite(html)).toEqual([{ title: "Битум оптом", url: "https://nefteterminal.ru/bitum", snippet: "цена за литр" }]);
  });

  it("Bing: блоки b_algo и base64-обёртка ссылок", () => {
    const результаты = parseBingHtml(ВЫДАЧА_BING_ПОДСТАВНАЯ);

    expect(результаты).toHaveLength(2);
    expect(результаты[0]!.url).toBe("https://www.toyota.ru/");
    expect(unwrapBing("https://example.org/plain")).toBe("https://example.org/plain");
    expect(unwrapDuckDuckGo("//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.ru%2Fb%3Fc%3D1&rut=x")).toBe("https://a.ru/b?c=1");
  });

  it("релевантность: выдача без слов запроса — подставная", () => {
    expect(relevant(parseBingHtml(ВЫДАЧА_BING_ПОДСТАВНАЯ), ЗАПРОС)).toBe(false);
    expect(relevant(parseDuckDuckGoHtml(ВЫДАЧА_DDG), ЗАПРОС)).toBe(true);
  });
});

function сеть(ответы: Record<string, HttpAnswer>): (url: string) => Promise<HttpAnswer> {
  return async (url) => {
    const ключ = Object.keys(ответы).find((k) => url.includes(k));
    if (ключ === undefined) throw new Error(`ECONNREFUSED ${url}`);
    return ответы[ключ]!;
  };
}

describe("поиск по каналам", () => {
  it("берёт первую релевантную выдачу и называет канал", async () => {
    const итог = await searchWeb(ЗАПРОС, {
      env: {},
      get: сеть({ "html.duckduckgo.com": { status: 200, text: ВЫДАЧА_DDG } }),
    });

    expect(итог.engine).toBe("DuckDuckGo HTML напрямую");
    expect(итог.hits.map((h) => h.url)).toEqual(["https://www.pulscen.ru/price/100609-bitum", "https://tt-oil.ru/bitum-bnd-70-100"]);
    expect(итог.note).toBe("первый канал ответил");
  });

  it("CAPTCHA и подставная выдача — отказ словом, без единой ссылки", async () => {
    const итог = await searchWeb(ЗАПРОС, {
      env: {},
      get: сеть({
        "html.duckduckgo.com": { status: 202, text: CAPTCHA_DDG },
        "lite.duckduckgo.com": { status: 202, text: CAPTCHA_DDG },
        "www.bing.com": { status: 200, text: ВЫДАЧА_BING_ПОДСТАВНАЯ },
      }),
    });

    expect(итог.engine).toBe("нет");
    expect(итог.hits).toEqual([]);
    expect(итог.note).toContain("DuckDuckGo HTML напрямую: CAPTCHA (HTTP 202)");
    expect(итог.note).toContain("Bing HTML напрямую: выдача не о запросе (подставная), отброшена");
  });

  it("с прокси каналы через него идут первыми, а сеть недоступна — тоже отказ словом", async () => {
    const маршруты: boolean[] = [];
    const итог = await searchWeb(ЗАПРОС, {
      env: { STROYINTELLECT_SEARCH_PROXY: "http://127.0.0.1:2080" },
      get: async (url, _headers, viaProxy) => {
        маршруты.push(viaProxy);
        if (url.includes("html.duckduckgo.com") && viaProxy) return { status: 200, text: ВЫДАЧА_DDG };
        throw new Error("ECONNREFUSED");
      },
    });

    expect(маршруты[0]).toBe(true);
    expect(итог.engine).toBe("DuckDuckGo HTML через прокси");
  });

  it("ключ Brave включает API-канал первым", async () => {
    const итог = await searchWeb(ЗАПРОС, {
      env: { STROYINTELLECT_BRAVE_SEARCH_KEY: "ключ" },
      get: сеть({
        "api.search.brave.com": {
          status: 200,
          text: JSON.stringify({ web: { results: [{ title: "Битум БНД 70/100", url: "https://zavod.ru/bitum", description: "цена тонны" }] } }),
        },
      }),
    });

    expect(итог.engine).toBe("Brave Search API");
    expect(итог.hits[0]!.url).toBe("https://zavod.ru/bitum");
  });
});

describe("страница", () => {
  it("снимает разметку и вынимает строки с ценами", async () => {
    const html = `<html><head><style>p{}</style><script>var a=1;</script></head><body>
      <h1>Битум БНД 70/100</h1><p>Отпускная цена от 52&nbsp;000 руб./т с завода.</p><p>Щебень фр. 20-40 — 1 850 ₽/м3.</p></body></html>`;
    const страница = await readPageText("https://zavod.ru/bitum", { env: {}, get: async () => ({ status: 200, text: html }) });

    expect(страница.status).toBe("HTTP 200");
    expect(страница.text).not.toContain("var a=1");
    expect(страница.prices.some((line) => line.includes("52 000 руб./т"))).toBe(true);
    expect(страница.prices.some((line) => line.includes("1 850 ₽/м3"))).toBe(true);
    expect(priceLines("без цен здесь нет")).toEqual([]);
  });

  it("403 напрямую — повтор через прокси; без прокси — недоступна словом", async () => {
    const через = await readPageText("https://satom.ru/x", {
      env: { STROYINTELLECT_SEARCH_PROXY: "http://127.0.0.1:2080" },
      get: async (_url, _headers, viaProxy) => (viaProxy ? { status: 200, text: "<p>Битум 50 000 руб.</p>" } : { status: 403, text: "" }),
    });
    expect(через.status).toBe("HTTP 200 через прокси");
    expect(через.prices).toHaveLength(1);

    const без = await readPageText("https://satom.ru/x", {
      env: {},
      get: async () => {
        throw new Error("ETIMEDOUT");
      },
    });
    expect(без.status).toBe("недоступна: ETIMEDOUT");
    expect(без.chars).toBe(0);
  });
});
