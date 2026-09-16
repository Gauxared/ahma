/**
 * Машинные границы архитектуры (ADR-R-014, ADR-R-025, ADR-R-010).
 *
 * «Без хардкода» и «модули не знают друг о друге» — это не намерение, а гейт
 * сборки. Проверки намеренно узкие и работают по коду без комментариев и строк,
 * чтобы не ловить ложные срабатывания на пояснениях и тестах.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const SOURCE = /\.(ts|tsx)$/;
const IS_TEST = /\.test\.tsx?$/;

const IMPORT = /\b(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s*)["']([^"']+)["']/g;

/** Домен-модуль не зависит от фреймворка и рантайма (v3 §34.2). */
const FORBIDDEN_IN_MODULES = ["next", "@prisma/client", "@openai/codex-sdk"] as const;

/** Девять договорных агентов АПРИ — состав клиента, а не свойство платформы. */
const AGENT_IDS = [
  "chief_project_engineer_agent",
  "estimate_review_agent",
  "procurement_agent",
  "contractor_search_agent",
  "economist_agent",
  "pto_agent",
  "legal_agent",
  "project_manager_agent",
  "data_coordinator_agent",
] as const;

/** Ставки задаются параметром с датой действия (ТЗ §6.4). */
const RATE_ASSIGNMENT =
  /\b(?:const|let|var|readonly)?\s*[\w$.]*(?:vat|ндс|key_?rate|ключев\w*[_\s]*ставк\w*)[\w$]*\s*(?::[^=]+)?=\s*["']?-?\d+(?:\.\d+)?["']?/i;

/** Идентификатор клиента живёт только в config/customers/** (ADR-R-010). */
const CUSTOMER_LITERAL = /["'](?:apri|АПРИ)["']/i;

/**
 * Формула вне реестра запрещена (ADR-R-014, ТЗ §6.4).
 *
 * ПОЧЕМУ ГЕЙТ, А НЕ ВЫЗОВ РЕЕСТРА ИЗ МОДУЛЯ
 *
 * Доменные модули не знают о платформе (ADR-R-025) — иначе расчёт нельзя
 * запустить без загрузчика конфигов. Поэтому модуль объявляет идентификатор и
 * версию у себя, а реестр остаётся источником истины: константа модуля —
 * ПРОЕКЦИЯ реестра, и её расхождение с реестром валит сборку. Копия здесь
 * безопасна ровно потому, что её проверяет машина, а не память автора.
 */
// Завершающая запятая отделяет ПОЛЕ ОБЪЕКТА от ОБЪЯВЛЕНИЯ ТИПА: `formulaId: X,`
// в литерале против `readonly formulaId: string;` в интерфейсе. Без этого гейт
// требовал бы регистрации формулы по имени типа `string`.
const FORMULA_ID_FIELD = /formulaId:\s*(?:`\$\{([\w$]+)\}[^`]*`|["']([^"']+)["']|([\w$]+))\s*,/g;
const FORMULA_VERSION_FIELD = /formulaVersion:\s*(?:(\d+)|([\w$]+))\s*,/g;
const CONST_STRING = /\b(?:const|let)\s+([\w$]+)(?::[^=]+)?\s*=\s*["']([^"']+)["']/g;
const CONST_NUMBER = /\b(?:const|let)\s+([\w$]+)(?::[^=]+)?\s*=\s*(\d+)\b/g;

interface FormulaDeclaration {
  readonly id: string;
  readonly version: number;
}

function loadRegistry(): ReadonlyMap<string, FormulaDeclaration> {
  const path = join("config", "formulas", "registry.json");
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    formulas: readonly FormulaDeclaration[];
  };

  return new Map(parsed.formulas.map((formula) => [formula.id, formula]));
}

/** Значения строковых и числовых констант файла — для разрешения ссылок. */
function constantsOf(code: string): {
  strings: ReadonlyMap<string, string>;
  numbers: ReadonlyMap<string, number>;
} {
  const strings = new Map<string, string>();
  for (const match of code.matchAll(CONST_STRING)) {
    if (match[1] !== undefined && match[2] !== undefined) strings.set(match[1], match[2]);
  }

  const numbers = new Map<string, number>();
  for (const match of code.matchAll(CONST_NUMBER)) {
    if (match[1] !== undefined && match[2] !== undefined) numbers.set(match[1], Number(match[2]));
  }

  return { strings, numbers };
}

interface Violation {
  readonly file: string;
  readonly rule: string;
  readonly detail: string;
}

function sourceFiles(root: string): string[] {
  if (!existsSync(root)) return [];

  return readdirSync(root).flatMap((name) => {
    if (name === "node_modules" || name.startsWith(".")) return [];
    const path = join(root, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : SOURCE.test(path) ? [path] : [];
  });
}

/** Убирает комментарии и содержимое строк: проверяем код, а не пояснения. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

function importsOf(source: string): string[] {
  return [...source.matchAll(IMPORT)]
    .map((match) => match[1])
    .filter((specifier): specifier is string => specifier !== undefined);
}

function isPackage(specifier: string, name: string): boolean {
  return specifier === name || specifier.startsWith(`${name}/`);
}

/** Имя доменного модуля из пути `modules/<name>/...`. */
function moduleOf(file: string): string | undefined {
  const parts = relative(process.cwd(), file).split(sep);
  return parts[0] === "modules" ? parts[1] : undefined;
}

/**
 * В какой доменный модуль ведёт импорт.
 *
 * Путь именно РАЗРЕШАЕТСЯ, а не разбирается по сегментам: наивная проверка
 * первого сегмента после `../` принимает соседний каталог внутри того же
 * модуля за чужой модуль. `../parsers/x.js` из `modules/documents/operations/`
 * остаётся внутри `documents`, и запрещать это нечего.
 */
function targetModule(file: string, specifier: string): string | undefined {
  const aliased = /^@modules\/([^/]+)/.exec(specifier);
  if (aliased !== null) {
    return aliased[1];
  }

  if (!specifier.startsWith(".")) {
    return undefined;
  }

  const resolved = relative(process.cwd(), resolve(dirname(file), specifier));
  const parts = resolved.split(sep);

  return parts[0] === "modules" ? parts[1] : undefined;
}

const violations: Violation[] = [];

function report(file: string, rule: string, detail: string): void {
  violations.push({ file: relative(process.cwd(), file), rule, detail });
}

for (const file of sourceFiles("modules")) {
  const raw = readFileSync(file, "utf8");
  const code = codeOnly(raw);
  const specifiers = importsOf(code);
  const owner = moduleOf(file);

  for (const name of FORBIDDEN_IN_MODULES) {
    if (specifiers.some((specifier) => isPackage(specifier, name))) {
      report(file, "domain-isolation", `домен-модуль импортирует ${name}`);
    }
  }

  // ADR-R-025: между модулями ходит только узкая талия.
  for (const specifier of specifiers) {
    const target = targetModule(file, specifier);

    if (target !== undefined && owner !== undefined && target !== owner) {
      report(file, "narrow-waist", `импорт внутренностей модуля ${target} вместо @contracts`);
    }
  }
}

for (const file of sourceFiles("platform")) {
  const code = codeOnly(readFileSync(file, "utf8"));

  if (importsOf(code).some((specifier) => specifier.includes("config/customers"))) {
    report(file, "customer-isolation", "платформа импортирует конфигурацию клиента");
  }
}

// Хардкод проверяется в рабочем коде, но не в тестах: тест обязан утверждать
// про конкретные значения — в этом его смысл.
for (const root of ["modules", "platform", "apps", "packages"]) {
  for (const file of sourceFiles(root)) {
    if (IS_TEST.test(file)) continue;

    const code = codeOnly(readFileSync(file, "utf8"));

    if (RATE_ASSIGNMENT.test(code)) {
      report(file, "dated-parameters", "ставка НДС или ключевая ставка присвоена литералом (ТЗ §6.4)");
    }

    const roster = AGENT_IDS.filter((id) => code.includes(id));
    if (roster.length >= 3) {
      report(file, "n-ary-agents", `литеральный ростер агентов (${roster.length}) вместо реестра (ADR-R-011)`);
    }

    if (CUSTOMER_LITERAL.test(code) && !file.includes(join("config", "customers"))) {
      report(file, "customer-isolation", "идентификатор клиента в универсальном ядре (ADR-R-010)");
    }
  }
}

// ADR-R-014: формула вне реестра запрещена, а версия в коде обязана совпадать
// с реестровой. Расхождение опаснее отсутствия реестра: оно выглядит порядком.
const registry = loadRegistry();
const usedFormulas = new Set<string>();

for (const root of ["modules", "platform", "apps", "packages"]) {
  for (const file of sourceFiles(root)) {
    if (IS_TEST.test(file)) continue;
    // Сам реестр и его загрузчик оперируют идентификаторами как данными.
    if (file.includes(join("platform", "config", "formula-registry"))) continue;

    const code = codeOnly(readFileSync(file, "utf8"));
    const { strings, numbers } = constantsOf(code);

    const ids = [...code.matchAll(FORMULA_ID_FIELD)].map((match) => {
      const viaTemplate = match[1];
      const literal = match[2];
      const identifier = match[3];

      if (viaTemplate !== undefined) return strings.get(viaTemplate);
      if (literal !== undefined) return literal;
      if (identifier !== undefined) return strings.get(identifier);
      return undefined;
    });

    const versions = [...code.matchAll(FORMULA_VERSION_FIELD)].map((match) =>
      match[1] !== undefined ? Number(match[1]) : match[2] === undefined ? undefined : numbers.get(match[2]),
    );

    ids.forEach((id, index) => {
      if (id === undefined) {
        report(file, "formula-registry", "идентификатор формулы не выводится статически: реестр не может его проверить");
        return;
      }

      const declared = registry.get(id);
      if (declared === undefined) {
        report(file, "formula-registry", `формула ${id} не объявлена в config/formulas/registry.json`);
        return;
      }

      usedFormulas.add(id);

      const version = versions[index];
      if (version === undefined) {
        report(file, "formula-registry", `версия формулы ${id} не выводится статически`);
      } else if (version !== declared.version) {
        report(
          file,
          "formula-registry",
          `версия формулы ${id} в коде ${version}, в реестре ${declared.version}`,
        );
      }
    });
  }
}

// Объявленная, но нигде не считаемая формула — обещание расчёта, которого нет.
// Реестр читают как опись того, что система умеет; лишняя строка в описи врёт.
for (const id of registry.keys()) {
  if (!usedFormulas.has(id)) {
    report(
      join("config", "formulas", "registry.json"),
      "formula-registry",
      `формула ${id} объявлена, но не используется в коде`,
    );
  }
}


// ───────────────────── Механизм без применения (§8.4 плана) ─────────────────
//
// Семь раз за проект механизм был написан, покрыт тестами и НЕ ВЫЗВАН ниоткуда:
// KnowledgeScope, реестр форматов, журнал аудита, очередь, egress-журнал,
// JobQueue.heartbeat, ExtractionLedger. Пять раз это стоило качества, шестой —
// денег: модель позвали шесть раз вместо одного.
//
// Ловится это машиной, а не дисциплиной. Дисциплина уже не сработала семь раз.
//
// ЧТО ПРОВЕРЯЕТСЯ — ТОЛЬКО ПОВЕДЕНИЕ
//
// Функции, классы и публичные методы классов. Типы, интерфейсы и схемы —
// структура: неиспользуемый тип ничего не стоит и часто документирует контракт.
// Первая редакция правила флагала и их — 368 мест, то есть шум вместо сигнала.
//
// ТЕСТЫ ИСПОЛЬЗОВАНИЕМ НЕ СЧИТАЮТСЯ
//
// Механизм, который зовут только тесты, проверяет сам себя и не защищает ничего.
// Именно так выглядели все семь случаев.
//
// ИСПОЛЬЗОВАНИЕ ВНУТРИ СВОЕГО ФАЙЛА СЧИТАЕТСЯ
//
// Экспорт при этом лишний, но код работает. Ненужный экспорт — не то же, что
// неподключённый механизм, и смешивать их значит топить сигнал.

const EXPORTED_BEHAVIOUR = /^export\s+(?:async\s+)?(?:function|class)\s+([\w$]+)/gm;
const PUBLIC_METHOD = /^  (?:async\s+)?([a-zA-Z][\w$]*)\s*(?:<[^>]*>)?\s*\(/gm;
const NOT_A_METHOD = new Set(["if", "for", "while", "switch", "catch", "return", "constructor"]);

interface UnwiredBaseline {
  readonly unwired: readonly string[];
}

const baseline = new Set(
  (
    JSON.parse(
      readFileSync(join(process.cwd(), "tooling/unwired-baseline.json"), "utf8"),
    ) as UnwiredBaseline
  ).unwired,
);

{
  const roots = ["platform", "modules", "packages", "apps", "tooling"];
  const everything = new Map<string, string>();

  for (const root of roots) {
    for (const file of sourceFiles(root)) everything.set(file, readFileSync(file, "utf8"));
  }

  const usedOutside = (owner: string, pattern: RegExp): boolean => {
    for (const [file, body] of everything) {
      if (file === owner || IS_TEST.test(file)) continue;
      if (pattern.test(body)) return true;
    }
    return false;
  };

  for (const [file, source] of everything) {
    if (IS_TEST.test(file)) continue;
    if (!file.startsWith("platform/") && !file.startsWith("modules/")) continue;

    const relativePath = relative(process.cwd(), file);

    for (const match of source.matchAll(EXPORTED_BEHAVIOUR)) {
      const name = match[1]!;
      const word = new RegExp(`\\b${name}\\b`, "g");

      // Больше одного вхождения в своём файле — значит используется здесь же.
      if ((source.match(word) ?? []).length > 1) continue;
      if (usedOutside(file, new RegExp(`\\b${name}\\b`))) continue;

      const key = `${relativePath}: ${name}`;
      if (baseline.has(key)) continue;

      report(file, "unwired", `${name} не вызывается нигде, кроме тестов`);
    }

    for (const match of source.matchAll(PUBLIC_METHOD)) {
      const name = match[1]!;
      if (NOT_A_METHOD.has(name)) continue;
      if (new RegExp(`this\\.#?${name}\\b`).test(source)) continue;
      if (usedOutside(file, new RegExp(`\\.${name}\\b`))) continue;

      const key = `${relativePath}: .${name}()`;
      if (baseline.has(key)) continue;

      report(file, "unwired", `.${name}() не вызывается нигде, кроме тестов`);
    }
  }
}

/**
 * ПРАВИЛО «НЕИЗВЕСТНОЕ НЕ СТАНОВИТСЯ НУЛЁМ» — ТЗ §9, ПРОВЕРЯЕТСЯ СБОРКОЙ.
 *
 * ПОЧЕМУ ПРАВИЛО, А НЕ ЕЩЁ ОДНА ПРАВКА. За один день эта ошибка нашлась в пяти
 * разных местах: в разборе, в гейтах, на экране, в сводке и — дольше всех — в
 * КНИГЕ, которую заказчик уносит со встречи. Каждый раз её чинили в одном
 * месте, и каждый раз оставалось следующее. Пять одинаковых дефектов — это не
 * пять ошибок, а отсутствие правила.
 *
 * ЧТО ИМЕННО ЗАПРЕЩЕНО: подстановка нуля вместо отсутствующей ДЕНЕЖНОЙ либо
 * ОБЪЁМНОЙ величины — `?? "0.00"`, `?? 0`, `|| "0"` рядом с именем, означающим
 * деньги или количество.
 *
 * ЦЕНА ОШИБКИ ИМЕННО ЗДЕСЬ. «Расхождение 0,00 ₽» читается как доказанная
 * сходимость, а означает «сверять было нечем». Ноль не пустое место — это
 * утверждение, и оно переворачивает смысл на противоположный.
 *
 * КАК РАЗРЕШИТЬ ОСОЗНАННО: строкой-исключением над местом —
 * `// ноль-осознанно: <почему именно ноль, а не отсутствие>`. Исключение
 * требует объяснения, потому что молчаливое подавление правила и есть то, от
 * чего правило защищает.
 */
const MONEY_WORDS =
  /(amount|sum|total|итог|сумм|delta|расхожд|price|цена|стоимост|rub|деньг|money|quantity|кол-во|объ[её]м|volume)/i;
const ZERO_DEFAULT = /(\?\?|\|\|)\s*(0(?![.\d])|"0(\.0+)?"|'0(\.0+)?'|`0(\.0+)?`)/;

for (const file of [...sourceFiles("modules"), ...sourceFiles("platform"), ...sourceFiles("apps")]) {
  if (/\.test\.tsx?$/.test(file)) continue;

  const lines = readFileSync(file, "utf8").split("\n");

  for (const [index, line] of lines.entries()) {
    // Комментарий, описывающий дефект, — не дефект. Первая редакция правила
    // ловила текст о нём и давала шум вместо сигнала.
    const без = line.replace(/^\s*(\*|\/\/).*$/u, "");
    if (!ZERO_DEFAULT.test(без)) continue;

    // Смотрим ЛЕВУЮ часть: ноль опасен там, где слева деньги или объём.
    const left = без.slice(0, без.search(ZERO_DEFAULT));
    if (!MONEY_WORDS.test(left)) continue;

    // Объяснение бывает многострочным: смотрим окно, а не одну строку выше.
    const выше = lines.slice(Math.max(0, index - 6), index).join("\n");
    if (/ноль-осознанно:/.test(выше)) continue;

    report(
      file,
      "неизвестное-не-ноль",
      `строка ${index + 1}: ноль подставлен вместо отсутствующей величины — ` +
        "«0» здесь утверждение, а не пустота (ТЗ §9). Разрешить осознанно: `// ноль-осознанно: <почему>`",
    );
  }
}

if (violations.length > 0) {
  const byRule = new Map<string, Violation[]>();
  for (const violation of violations) {
    byRule.set(violation.rule, [...(byRule.get(violation.rule) ?? []), violation]);
  }

  const lines = [...byRule.entries()].flatMap(([rule, items]) => [
    `  [${rule}]`,
    ...items.map((item) => `    ${item.file}: ${item.detail}`),
  ]);

  console.error(`Нарушены границы архитектуры (${violations.length}):\n${lines.join("\n")}`);
  process.exit(1);
}

console.log("Границы архитектуры соблюдены");
