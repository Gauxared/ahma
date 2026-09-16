/**
 * Рабочая папка прогона — то, что роли экипажа читают сами (spec-demo-stage-1 А5).
 *
 * ДЕТЕРМИНИРОВАННЫЙ СЛОЙ ОСТАЁТСЯ ПЕРВЫМ. Обход, разбор смет, сходимость и
 * сверка со сводным делаются кодом, как в конвейере (ADR-V3-010): арифметика —
 * не предмет рассуждения модели. Здесь их результат раскладывается по файлам,
 * которые роль открывает командами оболочки в песочнице только для чтения.
 *
 * ПОЧЕМУ ФАЙЛЫ, А НЕ ИНСТРУМЕНТЫ. У конвейера шесть инструментов чтения, и
 * каждый — наш код: что читать, сколько показать, где обрезать. Codex-агент
 * читает сам: `grep` по TSV на сотню смет, `awk` по сумме раздела, `python3`
 * по всему листу. Мы перестаём решать, что ему показать, — и это и есть
 * разница между «мы выбрали материал» и «агент выбрал материал».
 *
 * БЮДЖЕТЫ КОНВЕЙЕРА ЗДЕСЬ НЕ ДЕЙСТВУЮТ. Текст РД кладётся целиком, а не
 * 40 000 знаков; листы чертежей — все отрендеренные, а не три. Роль платит за
 * чтение временем своего хода, и это её решение.
 *
 * ИМЕНА ФАЙЛОВ — РУССКИЕ, как у исходников: роль называет документ в ответе
 * тем именем, что видит в ОБЪЕКТ.md, и по нему находится строка (crew-output).
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, symlink, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { cwd, env } from "node:process";

import type { DocumentOutcome } from "@modules/workflow/check-object.js";

import type { CollectedDuringCheck } from "../execution/check-ports.js";
import { dumpWorkbook, sheetToTsv } from "../config/base-dump.js";

export interface WorkspaceRole {
  readonly capability: string;
  readonly person: string;
  readonly referenceBase?: string | undefined;
}

export interface WorkspaceInput {
  /** Корень рабочих папок (`STROYINTELLECT_CODEX_RUNS`). */
  readonly root: string;
  /** Имя папки прогона: шифр объекта и момент. */
  readonly label: string;
  readonly objectCode: string;
  readonly objectPath: string;
  readonly collected: CollectedDuringCheck;
  readonly documents: readonly DocumentOutcome[];
  readonly declaredTotal?: string | undefined;
  readonly roles: readonly WorkspaceRole[];
  /** Опорная база роли текстом; `undefined` — файла нет (режим [БЕЗ БАЗЫ]). */
  readonly referenceBaseText: (path: string) => Promise<string | undefined>;
  /** Наименование норматива по шифру из каталога. */
  readonly normOf: (code: string) => string | undefined;
  /**
   * ВСЕ источники базы — Т12. Не «книга своей роли»: каждая роль читает любую
   * книгу командами из `база/`, потому что вопрос сметчика к книге договорника
   * законен, а окно промпта на это не тратится.
   */
  readonly bases: readonly { readonly title: string; readonly path: string }[];
  /**
   * Папка с нормативными документами текстом — своды правил и ГОСТы (Т12).
   *
   * Пусто — их нет, и роль об этом читает словом. Ссылаясь на «СП 30.13330.2016»
   * без текста свода, роль берёт пункт из памяти модели, а это ровно то, что
   * Ядро р.7 запрещает: цифра без источника не принимается.
   */
  readonly normativeDir?: string | undefined;
  /**
   * Папка с кейсами прежней системы — что подавали на вход и что получали на
   * выходе (решение владельца 08.09.2026).
   *
   * Не образец для копирования, а ПЛАНКА: по объекту такого типа прежняя
   * система выдавала такие документы с такими листами, и наш результат должен
   * быть не хуже. Содержимого чужих объектов там нет — только состав.
   */
  readonly casesDir?: string | undefined;
  /**
   * ВЕСЬ нормативный каталог — Т12. `нормативы.tsv` рядом остаётся: там только
   * шифры, встреченные в сметах, и он короткий. Здесь — всё, что есть.
   */
  readonly catalogue: readonly {
    readonly code: string;
    readonly name: string;
    readonly unit: string;
    readonly system: string;
  }[];
  readonly coreRules: string;
}

export interface WorkspaceEstimate {
  readonly file: string;
  readonly path: string;
  readonly positions: number;
}

export interface Workspace {
  readonly root: string;
  readonly objectPath: string;
  readonly objectCode: string;
  /** Текст ОБЪЕКТ.md — вводная каждой роли начинается с него. */
  readonly summary: string;
  readonly estimates: readonly WorkspaceEstimate[];
  readonly texts: readonly string[];
  readonly sheets: readonly string[];
  /** Роли, у которых опорной базы не нашлось: им объявляется режим [БЕЗ БАЗЫ]. */
  readonly withoutBase: readonly string[];
}

/** Имя файла в папке прогона: без разделителей, без коллизий. */
function safeName(taken: Set<string>, original: string, extension: string): string {
  // Без пробелов и дефисов: такое имя роль пишет в команде оболочки без кавычек.
  const stem =
    basename(original)
      .replace(/\.[^.]+$/, "")
      .replace(/[\s/\\-]+/g, "_") || "документ";
  let candidate = `${stem}${extension}`;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${stem}_${n}${extension}`;
    n += 1;
  }
  taken.add(candidate);
  return candidate;
}

const tsvCell = (value: string | undefined): string => (value ?? "").replace(/[\t\r\n]+/g, " ").trim();

/** Команды `инструменты/…`: имя обёртки → подкоманда `apps/cli/src/tools.ts`. */
const WORKSPACE_TOOLS = ["документ", "финмодель", "цены", "источник", "поиск", "страница"] as const;

/** Переменные, которые инструмент получает от обёртки: сеть роли изолирована от окружения службы. */
const TOOL_ENV = [
  "STROYINTELLECT_SEARCH_PROXY",
  "STROYINTELLECT_SEARXNG_HOSTS",
  "STROYINTELLECT_BRAVE_SEARCH_KEY",
  "STROYINTELLECT_SERPER_KEY",
  "STROYINTELLECT_PYTHON",
  "STROYINTELLECT_CDP_URL",
] as const;

/**
 * Обёртка инструмента — исполняемый `sh`, зовущий `tsx` выпуска, из которого
 * работает служба (`cwd`). Пути абсолютные: роль запускает её из рабочей
 * папки, а `TSX_TSCONFIG_PATH` даёт tsx алиасы `@modules/…`, `@platform/…`.
 */
function toolWrapper(tool: (typeof WORKSPACE_TOOLS)[number], release: string, environment: NodeJS.ProcessEnv): string {
  const exports = TOOL_ENV.filter((name) => environment[name]).map((name) => `export ${name}=${JSON.stringify(environment[name])}`);
  return [
    "#!/bin/sh",
    `# инструмент платформы «${tool}»: числа считает код, страницы читает код (ADR-V3-010)`,
    `export TSX_TSCONFIG_PATH=${JSON.stringify(join(release, "tsconfig.json"))}`,
    ...exports,
    `exec ${JSON.stringify(join(release, "node_modules/.bin/tsx"))} ${JSON.stringify(join(release, "apps/cli/src/tools.ts"))} ${tool} "$@"`,
    "",
  ].join("\n");
}

export async function materializeWorkspace(input: WorkspaceInput): Promise<Workspace> {
  const root = join(input.root, input.label.replace(/[^\p{L}\p{N}._-]+/gu, "_"));

  for (const folder of ["сметы", "документация", "листы", "опора", "база", "передачи", "выход", "инструменты"]) {
    await mkdir(join(root, folder), { recursive: true });
  }

  // ── Инструменты роли: детерминированные команды в рабочей папке ─────────
  for (const tool of WORKSPACE_TOOLS) {
    await writeFile(join(root, "инструменты", tool), toolWrapper(tool, cwd(), env), { encoding: "utf8", mode: 0o755 });
  }

  const relPath = (path: string): string => {
    const rel = relative(input.objectPath, path);
    return rel === "" || rel.startsWith("..") ? path : rel;
  };

  // ── Сметы: позиции TSV + сходимость ──────────────────────────────────────
  const taken = new Set<string>();
  const estimates: WorkspaceEstimate[] = [];
  const byDocument = new Map<string, typeof input.collected.extracted>();

  for (const row of input.collected.extracted) {
    const rows = byDocument.get(row.document) ?? [];
    byDocument.set(row.document, [...rows, row]);
  }

  for (const [path, rows] of byDocument) {
    const file = safeName(taken, path, ".tsv");
    const outcome = input.documents.find((d) => d.path === path);
    const header = "№\tраздел\tнаименование\tшифр\tед.\tкол-во\tсумма, ₽\tстрока листа";
    const body = rows.map((r) =>
      [r.ordinal, r.section, r.sourceName, r.basis, r.unit, r.quantity, r.amount ?? "", String(r.sourceRow)]
        .map(tsvCell)
        .join("\t"),
    );

    await writeFile(join(root, "сметы", file), `${header}\n${body.join("\n")}\n`, "utf8");

    const convergence = [
      `# Сходимость: ${relPath(path)}`,
      "",
      "Посчитано расчётным модулем, не моделью (ADR-V3-010).",
      "",
      `- позиций извлечено: ${rows.length}`,
      `- сумма позиций известна у: ${rows.filter((r) => r.amount !== undefined).length}`,
      `- итог сметы по документу: ${outcome?.documentTotal ?? "не указан (смета без стоимостной части либо итог не найден)"}`,
      `- сошлось: ${outcome?.converged === undefined ? "сверять было нечего" : outcome.converged ? "да" : "НЕТ"}`,
      `- расхождение, ₽: ${outcome?.delta ?? "—"}`,
      `- позиций с шифром каталога: ${outcome?.byCode ?? "—"}`,
    ].join("\n");

    await writeFile(join(root, "сметы", file.replace(/\.tsv$/, ".сходимость.md")), `${convergence}\n`, "utf8");
    estimates.push({ file, path, positions: rows.length });
  }

  // ── Тексты: РД, договоры, ТЗ, книги-не-сметы ─────────────────────────────
  const texts: string[] = [];
  const textNames = new Set<string>();

  for (const document of input.collected.designDocuments) {
    const file = safeName(textNames, document.path, ".txt");
    await writeFile(
      join(root, "документация", file),
      `# ${relPath(document.path)}\n# страниц: ${document.pages}\n\n${document.text}\n`,
      "utf8",
    );
    texts.push(file);
  }

  // ── Листы чертежей картинками ────────────────────────────────────────────
  const sheets: string[] = [];
  const sheetNames = new Set<string>();

  for (const sheet of input.collected.designSheets) {
    const match = /^data:image\/(\w+);base64,(.+)$/s.exec(sheet.dataUrl);
    if (match === null) continue;
    const file = safeName(sheetNames, `${basename(sheet.document).replace(/\.[^.]+$/, "")}-стр${sheet.page}`, `.${match[1] === "jpeg" ? "jpg" : match[1]}`);
    await writeFile(join(root, "листы", file), Buffer.from(match[2]!, "base64"));
    sheets.push(file);
  }

  // ── Изображения партии — картинками в листы/: роль смотрит их сама (А11) ──
  for (const document of input.documents) {
    if (document.kind !== "скан" || !/\.(png|jpe?g|tiff?|bmp|gif|webp)$/iu.test(document.path)) continue;
    if (input.collected.designSheets.some((sheet) => sheet.document === document.path)) continue;

    const file = safeName(sheetNames, basename(document.path).replace(/\.[^.]+$/, ""), `.${document.path.split(".").pop()!.toLowerCase()}`);
    await copyFile(document.path, join(root, "листы", file));
    sheets.push(file);
  }

  // ── Нормативы: наименование по каждому шифру, встреченному в сметах ──────
  const codes = new Set(input.collected.extracted.map((r) => r.basis.trim()).filter((c) => c !== ""));
  const norms = [...codes].sort().map((code) => `${code}\t${input.normOf(code) ?? "не найден в каталоге"}`);
  await writeFile(join(root, "нормативы.tsv"), `шифр\tнаименование · единица · система\n${norms.join("\n")}\n`, "utf8");

  // ── Опорные базы ролей ───────────────────────────────────────────────────
  const withoutBase: string[] = [];

  for (const role of input.roles) {
    const text = role.referenceBase === undefined ? undefined : await input.referenceBaseText(role.referenceBase);
    if (text === undefined) {
      withoutBase.push(role.person);
      continue;
    }
    await writeFile(join(root, "опора", `${role.person}.md`), `${text}\n`, "utf8");
  }

  await writeFile(join(root, "ядро.md"), `${input.coreRules}\n`, "utf8");

  // ── База целиком: все книги, все листы, все строки (Т12) ─────────────────
  const inventory: string[] = [
    "# БАЗА ЦЕЛИКОМ",
    "",
    "Здесь лежат источники ПОЛНОСТЬЮ: лист как в книге, строка как в листе.",
    "`опора/<Роль>.md` рядом — выжимка для чтения, а это — источник для сверки.",
    "Утверждение о норме, цене или порядке подкрепляй ссылкой ОТСЮДА: книга, лист,",
    "номер строки. Норму, которой здесь нет, не выдавай за проверенную.",
    "",
    "| источник | листов | строк | отпечаток | где |",
    "|---|---:|---:|---|---|",
  ];

  const baseNames = new Set<string>();

  for (const base of input.bases) {
    const book = await dumpWorkbook(base.path);
    if (book === undefined) {
      inventory.push(`| ${base.title} | — | — | — | НЕ ПРОЧИТАН: файла нет либо книга не открывается — ${base.path} |`);
      continue;
    }

    const folder = safeName(baseNames, base.title, "");
    await mkdir(join(root, "база", folder), { recursive: true });

    const sheetNames2 = new Set<string>();
    for (const sheet of book.sheets) {
      const file = safeName(sheetNames2, sheet.name, ".tsv");
      await writeFile(join(root, "база", folder, file), sheetToTsv(sheet), "utf8");
    }

    inventory.push(
      `| ${base.title} | ${book.sheets.length} | ${book.rowCount} | ${book.contentHash.slice(0, 12)} | \`база/${folder}/\` |`,
    );
  }

  // Каталог нормативов целиком: роль поднимает ЛЮБОЙ шифр, а не только тот,
  // что встретился в смете этого объекта.
  const catalogueRows = input.catalogue.map(
    (item) => `${item.code}\t${tsvCell(item.name)}\t${tsvCell(item.unit)}\t${item.system}`,
  );
  await writeFile(
    join(root, "база", "нормативный-каталог.tsv"),
    `шифр\tнаименование\tединица\tсистема\n${catalogueRows.join("\n")}\n`,
    "utf8",
  );
  inventory.push(
    `| нормативный каталог | 1 | ${catalogueRows.length} | — | \`база/нормативный-каталог.tsv\` |`,
    "",
    "Поиск по базе — командой: `grep -i «что ищешь» база/*/*.tsv база/*.tsv`.",
  );

  // ── Нормативные документы: своды правил и ГОСТы текстом ──────────────────
  //
  // ССЫЛКОЙ, А НЕ КОПИЕЙ: корпус весит десятки мегабайт, а прогонов на диске
  // держится три. Копия умножила бы его на число прогонов ради данных, которые
  // от прогона к прогону не меняются.
  if (input.normativeDir !== undefined && existsSync(input.normativeDir)) {
    const link = join(root, "база", "нормативные-документы");
    try {
      await symlink(input.normativeDir, link, "dir");
      inventory.push(`| нормативные документы (СП, ГОСТ) | — | см. ОПИСЬ внутри | — | \`база/нормативные-документы/\` |`);
    } catch {
      inventory.push("| нормативные документы | — | — | — | ССЫЛКА НЕ СОЗДАНА |");
    }
  } else {
    inventory.push(
      "| нормативные документы (СП, ГОСТ) | — | — | — | ИХ НЕТ: ссылаясь на свод правил, помечай пункт ⚠ — текста свода у тебя нет |",
    );
  }

  // ── Кейсы прежней системы: планка по составу входа и выхода ─────────────
  if (input.casesDir !== undefined && existsSync(input.casesDir)) {
    try {
      await symlink(input.casesDir, join(root, "база", "кейсы"), "dir");
      inventory.push(
        "| кейсы прежней системы | — | см. ОПИСЬ внутри | — | `база/кейсы/` — что подавали и что получали |",
      );
    } catch {
      inventory.push("| кейсы прежней системы | — | — | — | ССЫЛКА НЕ СОЗДАНА |");
    }
  }

  await writeFile(join(root, "база", "ОПИСЬ.md"), `${inventory.join("\n")}\n`, "utf8");

  // ── ОБЪЕКТ.md — перечень, с которого начинается вводная каждой роли ──────
  const kinds = new Map<string, number>();
  for (const d of input.documents) kinds.set(d.kind, (kinds.get(d.kind) ?? 0) + 1);

  const documentLines = input.documents.map((d) => {
    const estimate = estimates.find((e) => e.path === d.path);
    const text = input.collected.designDocuments.some((t) => t.path === d.path);
    // Нечитаемому файлу называется путь: в песочнице роль может открыть его
    // сама (`strings`, `unzip -p`), и знать, где он лежит, — половина дела.
    /**
     * КНИГА МОЖЕТ ЛЕЖАТЬ В ДВУХ МЕСТАХ СРАЗУ — и роль обязана это знать.
     *
     * С 08.09.2026 разобранная смета уходит и позициями (`сметы/*.tsv`), и
     * текстом целиком (`документация/`, Т10). Написать про неё только «сметы/»
     * значило бы скрыть вторые листы и примечания; написать «документация/» —
     * пригласить переписать уже посчитанные строки в `positions`. Названы оба
     * места и сказано, что из них считается.
     */
    const where =
      estimate !== undefined && text
        ? `сметы/${estimate.file} (позиции формы УЖЕ ПОСЧИТАНЫ) + документация/ — та же книга целиком`
        : estimate !== undefined
        ? `сметы/${estimate.file}`
        : text
        ? "документация/"
        : `только исходник: ${relPath(d.path)}`;
    return `| ${relPath(d.path)} | ${d.kind} | ${d.status} | ${d.positions ?? "—"} | ${d.documentTotal ?? "—"} | ${d.converged === undefined ? "—" : d.converged ? "да" : "НЕТ"} | ${where} |${d.reason === undefined ? "" : ` ${d.reason}`}`;
  });

  const summary = [
    `# ОБЪЕКТ ${input.objectCode}`,
    "",
    `Партия: ${input.objectPath}`,
    `Документов: ${input.documents.length} (${[...kinds].map(([k, n]) => `${k}: ${n}`).join(", ")})`,
    `Итог по сводному расчёту (цена заказчику): ${input.declaredTotal ?? "сводного расчёта нет"}`,
    "",
    "| Файл | Вид | Разбор | Позиций | Итог, ₽ | Сошлось | Где читать |",
    "|---|---|---|---|---|---|---|",
    ...documentLines,
    "",
    "## Устройство рабочей папки",
    "",
    "- `сметы/<файл>.tsv` — позиции разобранных смет: № · раздел · наименование · шифр · ед. · кол-во · сумма · **строка листа** (её называй в находках);",
    "- `сметы/<файл>.сходимость.md` — что насчитал расчётный модуль;",
    `- \`документация/\` — текстовый слой РД, договоров, ТЗ и КНИГ ЦЕЛИКОМ, включая разобранные сметы: все листы, формулы, примечания (${texts.length} файлов). У разобранной сметы позиции формы 421/пр уже посчитаны в \`сметы/*.tsv\` — переписывать их в \`positions\` не нужно; выписывай оттуда то, чего в форме нет: другие листы, расчёты, ведомости, и называй лист;`,
    `- \`листы/\` — листы чертежей картинками (${sheets.length});`,
    "- `нормативы.tsv` — наименование каждого шифра из смет по каталогу;",
    "- `опора/<Роль>.md` — выжимка опорной базы роли; нет файла — режим [БЕЗ БАЗЫ] (Ядро р.8);",
    "- `база/` — ВСЕ источники целиком: книги по листам и нормативный каталог. Опись — `база/ОПИСЬ.md`;",
    "- `ядро.md` — общие правила экипажа;",
    "- `передачи/для-<Имя>.md` — блоки, адресованные роли;",
    "- `выход/<Имя>.json` — ответы уже отработавших ролей;",
    "- `инструменты/` — команды платформы: `инструменты/финмодель` (сценарии, маржа, БДДС, стоимость денег — считает код по формуле calculation.finance-model; запусти без параметров, чтобы увидеть флаги), `инструменты/цены <запрос> --регион <Регион объекта>` (предложения Avito региона и tradedir.ru с продавцом, городом и признаком «в регионе», строки прайсов поставщиков региона — с этого начинается лист market_check), `инструменты/источник <имя> <запрос> [--регион …]` (парсеры авторитетных площадок через браузер: `инструменты/источник список` покажет имена — pulscen и другие; страницы с проверкой JavaScript читаются только так), `инструменты/поиск <запрос>` (до 10 ссылок с заголовком, описанием и именем канала выдачи; подставная выдача отброшена инструментом), `инструменты/страница <url>` (текст без разметки и строки с ценами);",
    "- исходные файлы партии подключены только для чтения по пути выше.",
    "",
    "Читай файлы командами оболочки (`cat`, `grep`, `awk`, `python3`). В сеть ходи только `инструменты/цены`, `инструменты/поиск` и `инструменты/страница`; url попадает в лист, только если его вернул `цены` или открыла `страница`. Финансы считай только `инструменты/финмодель`. Ничего не изменяй.",
  ].join("\n");

  await writeFile(join(root, "ОБЪЕКТ.md"), `${summary}\n`, "utf8");

  return { root, objectPath: input.objectPath, objectCode: input.objectCode, summary, estimates, texts, sheets, withoutBase };
}
