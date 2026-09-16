/**
 * PostCSS для веб-приложения.
 *
 * Tailwind v4 подключается плагином, а не конфиг-файлом с `content`: в четвёртой
 * версии сканирование задаётся из CSS (`@import "tailwindcss"`), и отдельный
 * `tailwind.config.js` не нужен. Это же устройство у Domovey — сборка одна и та
 * же, чтобы перенесённые компоненты вели себя одинаково в двух репозиториях.
 *
 * Сборщик у нас webpack (`next build --webpack`, см. next.config.ts), и он
 * читает postcss штатно — Tailwind v4 работает без правок конфигурации сборки.
 */
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
