import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "СтройИнтеллект — проверка строительных объектов",
  description: "Демо-контур СтройИнтеллект для проверки объектов, документов, КП и расчётов."
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  /**
   * Тема по умолчанию — светлая, и она задаётся ЯВНО.
   *
   * Полагаться на `:root` без атрибута было бы можно, но тогда светлая тема
   * существует «по отсутствию», а не по объявлению, и поддерево с
   * `data-theme="dark"` нечем вернуть обратно в светлое. Штабные экраны
   * переключают тему на себе (`data-theme="dark"`), рабочие поверхности
   * остаются светлыми.
   */
  return (
    <html data-theme="light" lang="ru">
      <body>{children}</body>
    </html>
  );
}
