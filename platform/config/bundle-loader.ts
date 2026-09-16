/**
 * Загрузка конфигурационных бандлов (ADR-R-014, ADR-R-027).
 *
 * Управление конфигами без валидации схемой — это перенос хардкода в файлы, а не
 * его устранение. Поэтому невалидный бандл ОСТАНАВЛИВАЕТ запуск и не деградирует
 * в умолчание.
 *
 * Каждый бандл получает хэш содержимого: он попадает в `SourceRef` значений,
 * пришедших из конфига, и делает прогон воспроизводимым без копирования бандла
 * в снапшот.
 *
 * ПУТИ СЧИТАЮТСЯ ОТ КОРНЯ РЕПОЗИТОРИЯ, А НЕ ОТ ТЕКУЩЕГО КАТАЛОГА
 *
 * Относительный путь работает ровно до первого процесса, запущенного из другого
 * места. Веб-сервер Next стартует из `apps/web` — и не нашёл ни одного конфига,
 * хотя те же конфиги командная строка читала годами. Отказ при этом выглядел
 * как «файла нет», а не как «искали не там».
 *
 * Корень ищется от собственного расположения модуля вверх. Переменная окружения
 * не годится: её забудут выставить ровно в том процессе, где она нужна, и
 * вернётся та же ошибка.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { z } from "zod";

import { sha256 } from "@contracts/index.js";
import type { Sha256 } from "@contracts/index.js";

export interface LoadedBundle<T> {
  readonly value: T;
  readonly contentHash: Sha256;
  readonly path: string;
}

export class ConfigError extends Error {
  constructor(
    readonly path: string,
    message: string,
    readonly issues: readonly string[] = [],
  ) {
    super(issues.length > 0 ? `${path}: ${message}\n  ${issues.join("\n  ")}` : `${path}: ${message}`);
    this.name = "ConfigError";
  }
}

/**
 * Корень репозитория.
 *
 * Признак — каталог, где `package.json` лежит РЯДОМ с `config`. Одного `config`
 * мало: этот модуль сам живёт в `platform/config`, и поиск по одному лишь имени
 * каталога останавливается на `platform`. Ошибка нашлась сразу, потому что
 * сообщение о неудачном чтении называет полный путь.
 *
 * Поиск идёт от места самого модуля, а не от `process.cwd()`: первое не зависит
 * от того, кто и откуда запустил процесс.
 */
function repositoryRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url));

  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(join(directory, "package.json")) && existsSync(join(directory, "config"))) {
      return directory;
    }

    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  // Не нашли — возвращаем текущий каталог: хуже прежнего не станет, а ошибка
  // чтения назовёт полный путь, по которому искали.
  return process.cwd();
}

const ROOT = repositoryRoot();

/** Абсолютный путь к конфигу. Абсолютные пути пропускаются как есть. */
export function configPath(path: string): string {
  return isAbsolute(path) ? path : resolve(ROOT, path);
}

export function contentHashOf(raw: string): Sha256 {
  return sha256(createHash("sha256").update(raw, "utf8").digest("hex"));
}

/**
 * Читает, хэширует и валидирует бандл. Любая ошибка — отказ, а не умолчание.
 */
export function loadBundle<T>(path: string, schema: z.ZodType<T>): LoadedBundle<T> {
  const absolute = configPath(path);
  const shortPath = relative(ROOT, absolute) || absolute;

  let raw: string;
  try {
    raw = readFileSync(absolute, "utf8");
  } catch (cause) {
    // Полный путь в сообщении обязателен: без него «файла нет» и «искали не
    // там» неразличимы, а это разные починки.
    throw new ConfigError(
      shortPath,
      `не удалось прочитать бандл (искали ${absolute}): ${(cause as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ConfigError(shortPath, `невалидный JSON: ${(cause as Error).message}`);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const at = issue.path.length > 0 ? issue.path.join(".") : "<корень>";
      return `${at}: ${issue.message}`;
    });
    throw new ConfigError(shortPath, "бандл не соответствует схеме", issues);
  }

  return { value: result.data, contentHash: contentHashOf(raw), path: shortPath };
}
