/**
 * Инструменты роли экипажа — детерминированные команды в рабочей папке.
 *
 * Роль зовёт их из оболочки: `инструменты/финмодель --цена … --ндс …`,
 * `инструменты/поиск "запрос"`, `инструменты/страница <url>`. Числа считает код
 * (ADR-V3-010), страницы читает код — роль получает готовую таблицу или текст с
 * пометкой источника и не пересчитывает и не грепает HTML сама.
 *
 * Вызывается обёрткой из `инструменты/` рабочей папки, которую пишет
 * `workspace.ts`: `exec <release>/node_modules/.bin/tsx <release>/apps/cli/src/tools.ts <команда> …`.
 */
import { fileURLToPath } from "node:url";

import { buildFinanceModel, renderFinanceModel, type FinanceModelInput } from "@modules/calculations/finance-model.js";
import { renderPriceReport, searchPrices } from "@platform/storage/market-prices.js";
import { readPageText, searchWeb } from "@platform/storage/web-search.js";

function flag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

function usage(): never {
  console.error(
    [
      "инструменты роли экипажа:",
      "  финмодель --цена <с НДС> --ндс 0.22 --срок <мес> --статья 'Материалы=120000000' [--статья …]",
      "            [--аванс 0.3] [--отсрочка 1] [--обеспечение 0.1 --бг 0.03] [--ставка 0.18]",
      "            [--оптимист -0.05] [--стресс 0.15] [--красная 0.05] [--год 2026=0.05 --год 2027=0.5 …]",
      "  документ <путь> [--с <знак>] [--знаков <сколько>]  — прочитать ЛЮБОЙ файл партии: книгу целиком по листам,",
      "            документ Word с таблицами по колонкам, PDF, RTF, презентацию. Читает тот же код, что и обход.",
      "  цены <запрос> --регион <Регион>  — предложения Avito региона и tradedir с городом продавца, прайсы поставщиков региона",
      "  источник <имя> <запрос> [--регион <Регион>] — парсер авторитетной площадки (браузер lightpanda); `источник список` — имена",
      "  поиск <запрос>           — до 10 ссылок с заголовком и описанием",
      "  страница <url> [--с <знак>] [--знаков <сколько>]           — текст страницы и строки с ценами",
    ].join("\n"),
  );
  process.exit(2);
}

async function цены(args: readonly string[]): Promise<void> {
  const region = flag(args, "регион") ?? "Россия";
  const query = args.filter((a, i) => a !== "--регион" && a !== "--json" && args[i - 1] !== "--регион").join(" ").trim();
  if (query === "") usage();
  const report = await searchPrices(query, region);
  console.log(renderPriceReport(report));
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
}

/**
 * Парсеры авторитетных источников — Python-пакет `tools/парсеры` (scrapling,
 * браузер lightpanda по CDP). Интерпретатор — `STROYINTELLECT_PYTHON` (на сервере
 * venv с зависимостями); без него — отказ словом, а не «ничего не нашлось».
 */
async function источник(args: readonly string[]): Promise<void> {
  const python = process.env["STROYINTELLECT_PYTHON"] ?? "python3";
  const cwd = fileURLToPath(new URL("../../../tools/парсеры/", import.meta.url));
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve) => {
    const child = spawn(python, ["-m", "parsers", ...args], { cwd, stdio: "inherit", env: process.env });
    child.on("error", (error) => {
      console.error(`парсеры недоступны: ${error.message} (интерпретатор ${python}; на сервере — STROYINTELLECT_PYTHON=/opt/stroyintellekt/var/pyenv/bin/python)`);
      resolve();
    });
    child.on("exit", (code) => {
      if (code !== 0 && code !== null) process.exitCode = code;
      resolve();
    });
  });
}

async function main(argv: readonly string[]): Promise<void> {
  const [command, ...args] = argv;

  if (command === "финмодель") {
    const price = flag(args, "цена");
    const vat = flag(args, "ндс") ?? "0.22";
    const months = Number.parseInt(flag(args, "срок") ?? "", 10);
    if (price === undefined || !Number.isFinite(months)) usage();

    const costs: { name: string; amount: string }[] = [];
    const years: { year: number; share: string }[] = [];
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === "--статья" && args[i + 1] !== undefined) {
        const [name, amount] = args[i + 1]!.split("=");
        if (name && amount) costs.push({ name, amount });
      }
      if (args[i] === "--год" && args[i + 1] !== undefined) {
        const [year, share] = args[i + 1]!.split("=");
        if (year && share) years.push({ year: Number.parseInt(year, 10), share });
      }
    }
    if (costs.length === 0) usage();

    const input: FinanceModelInput = {
      priceWithVat: price!,
      vatRate: vat,
      costs,
      months,
      ...(flag(args, "аванс") === undefined ? {} : { advanceShare: flag(args, "аванс")! }),
      ...(flag(args, "отсрочка") === undefined ? {} : { paymentLagMonths: Number.parseInt(flag(args, "отсрочка")!, 10) }),
      ...(flag(args, "обеспечение") === undefined ? {} : { guaranteeShare: flag(args, "обеспечение")! }),
      ...(flag(args, "бг") === undefined ? {} : { guaranteeRatePerYear: flag(args, "бг")! }),
      ...(flag(args, "ставка") === undefined ? {} : { financingRatePerYear: flag(args, "ставка")! }),
      ...(flag(args, "оптимист") === undefined ? {} : { optimisticCostShift: flag(args, "оптимист")! }),
      ...(flag(args, "стресс") === undefined ? {} : { stressCostShift: flag(args, "стресс")! }),
      ...(flag(args, "красная") === undefined ? {} : { redLine: flag(args, "красная")! }),
      ...(years.length === 0 ? {} : { fundingByYear: years }),
    };

    const model = buildFinanceModel(input);
    console.log(renderFinanceModel(model));
    if (args.includes("--json")) console.log(JSON.stringify(model, null, 2));
    return;
  }

  if (command === "цены") return цены(args);
  if (command === "источник") return источник(args);

  if (command === "поиск") {
    const query = args.join(" ").trim();
    if (query === "") usage();
    const result = await searchWeb(query);
    console.log(`ПОИСК: «${query}» · источник выдачи: ${result.engine} · ${result.note}`);
    for (const [index, hit] of result.hits.entries()) {
      console.log(`${index + 1}. ${hit.title}\n   ${hit.url}\n   ${hit.snippet}`);
    }
    if (result.hits.length === 0) console.log("Выдача пуста: назови в листе «источник недоступен» и возьми диапазон из навыка construction-cost-analysis со статусом ⚠.");
    return;
  }

  if (command === "страница") {
    const url = args[0];
    if (url === undefined) usage();
    const page = await readPageText(url!);
    console.log(`СТРАНИЦА: ${page.url} · ${page.status} · ${page.chars} знаков · ${page.fetchedAt}`);
    if (page.prices.length > 0) {
      console.log("СТРОКИ С ЦЕНАМИ:");
      for (const line of page.prices) console.log("  · " + line);
    }
    /**
     * ОБРЕЗАНИЕ ОБЪЯВЛЕНО И ПРОДОЛЖАЕМО.
     *
     * Здесь стоял немой срез на шести тысячах знаков: роль видела начало
     * страницы и не знала, что дальше есть ещё. Прайс поставщика, у которого
     * нужная позиция стоит в конце таблицы, читался как «такой позиции нет».
     */
    const с = Number.parseInt(flag(args, "с") ?? "0", 10);
    const сколько = Number.parseInt(flag(args, "знаков") ?? "6000", 10);
    const кусок = page.text.slice(с, с + сколько);

    console.log(
      `ПОКАЗАНО: знаки ${с}–${с + кусок.length} из ${page.text.length}` +
        (с + кусок.length < page.text.length ? `; дальше — «--с ${с + кусок.length}»` : "; это конец"),
    );
    console.log(кусок);
    return;
  }

  /**
   * ЧТЕНИЕ ЛЮБОГО ФАЙЛА ПО ТРЕБОВАНИЮ РОЛИ.
   *
   * ПОЧЕМУ ЭТО НЕ ДУБЛИРУЕТ `документация/`. Мы кладём в рабочую папку заранее
   * извлечённый текст — это удобно и это ВЫБОР ЗА РОЛЬ: мы решили, что и в
   * каком виде ей показать. Замер 08.09.2026 показал цену такого решения:
   * книга старого формата доезжала одним листом из четырёх, а таблица в Word —
   * потоком значений без колонок. Каждая такая потеря — наша ошибка в
   * посреднике, о которой роль не узнает никогда.
   *
   * ПОЧЕМУ РОЛЬ НЕ ЧИТАЕТ САМА. Исходники ей доступны (`additionalDirectories`),
   * но `.xlsx`, `.docx`, `.pdf` — двоичные контейнеры, а в окружении роли нет
   * ни одной библиотеки для них: замерено на сервере, `openpyxl`, `pandas`,
   * `python-docx`, `pdfplumber` — ничего. `cat` по такому файлу даёт мусор.
   *
   * Поэтому инструмент: роль сама решает, ЧТО и КОГДА прочитать — как в
   * эталонной системе, где агент работал с исходниками, — а разбирает файл
   * общий читатель, тот же, что у обхода. Посредник остаётся, но перестаёт
   * решать за роль.
   */
  if (command === "документ") {
    const path = args[0];
    if (path === undefined) usage();

    const { readAnything } = await import("@platform/storage/universal-reader.js");
    const с = Number.parseInt(flag(args, "с") ?? "0", 10);
    const сколько = Number.parseInt(flag(args, "знаков") ?? "40000", 10);

    const result = await readAnything(path!);
    const кусок = result.text.slice(с, с + сколько);

    console.log(`ДОКУМЕНТ: ${path}`);
    console.log(`КАК ПРОЧИТАН: ${result.how} · формат ${result.format} · знаков всего ${result.text.length}`);
    if (result.caveat !== undefined) console.log(`ОГОВОРКА: ${result.caveat}`);
    if (result.images.length > 0) console.log(`ИЗОБРАЖЕНИЙ ВНУТРИ: ${result.images.length} (лежат в листы/ рабочей папки)`);
    console.log(`ПОКАЗАНО: знаки ${с}–${с + кусок.length} из ${result.text.length}` +
      (с + кусок.length < result.text.length ? `; дальше — «--с ${с + кусок.length}»` : "; это конец"));
    console.log("");
    console.log(кусок);
    return;
  }

  usage();
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`инструмент отказал: ${(error as Error).message}`);
  process.exit(1);
});
