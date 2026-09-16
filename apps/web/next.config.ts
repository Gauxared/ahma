import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

/**
 * Псевдонимы повторяют `tsconfig.base.json`.
 *
 * Сборщик Next не читает `paths` из tsconfig для путей за пределами приложения,
 * а веб обязан ходить в платформу через тот же `@platform`, что и всё
 * остальное: второй способ адресовать один и тот же модуль — это второй способ
 * ошибиться.
 *
 * Разрешение расширений `.js` → `.ts` задаётся `experimental.extensionAlias`:
 * репозиторий пишет расширения по правилам ESM, а на диске лежит TypeScript.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  /**
   * Next 16 сам создаёт `AGENTS.md` и `CLAUDE.md` рядом с приложением.
   * Выключено: у репозитория свои соглашения, а второй файл с правилами внутри
   * `apps/web` — это второй источник истины, который разойдётся с первым молча.
   */
  agentRules: false,
  turbopack: {
    root,
    resolveAlias: {
      "@platform": resolve(root, "platform"),
      "@modules": resolve(root, "modules"),
      "@contracts": resolve(root, "packages", "contracts"),
      "@web": here,
    },
    resolveExtensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"],
  },
  /**
   * Сборка идёт webpack'ом, а не Turbopack, и причина одна.
   *
   * Весь репозиторий пишет импорты с расширением `.js` — этого требует запуск
   * под node и tsx. На диске лежит TypeScript, и связать одно с другим умеет
   * `resolve.extensionAlias`, которого у Turbopack нет.
   *
   * Альтернатива — переписать 443 импорта в 145 файлах ради одного
   * потребителя. Сборщик выбран под код, а не код под сборщик; когда у
   * Turbopack появится своё сопоставление расширений, настройка снимется.
   *
   * Команда сборки: `next build --webpack`.
   */
  webpack(config: { resolve?: { alias?: Record<string, string>; extensionAlias?: Record<string, string[]> } }) {
    config.resolve ??= {};
    config.resolve.alias = {
      ...config.resolve.alias,
      "@platform": resolve(root, "platform"),
      "@modules": resolve(root, "modules"),
      "@contracts": resolve(root, "packages", "contracts"),
      "@web": here,
    };
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };

    return config;
  },
};

export default nextConfig;
