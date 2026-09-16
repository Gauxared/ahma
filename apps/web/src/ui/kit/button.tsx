import type { ComponentProps } from "react";

import { cn } from "../cn.js";

/**
 * Кнопка. Перенесена из Pulse (`domovey/apps/web-crm/src/components/pulse-kit/button.tsx`):
 * примитив тонкий, вся стилизация — в семантических классах `globals.css`.
 *
 * Вариантов ровно пять, и `link` среди них нет намеренно: ссылка — это `<a>`,
 * а кнопка, выглядящая ссылкой, ломает и клавиатурную навигацию, и ожидание
 * «откроется в новой вкладке».
 */
export type ButtonVariant = "primary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "btn--primary",
  outline: "btn--outline",
  ghost: "btn--ghost",
  danger: "btn--danger",
};

const SIZE: Record<Exclude<ButtonSize, "icon">, string> = {
  sm: "btn--sm",
  md: "",
  lg: "btn--lg",
};

export type ButtonProps = ComponentProps<"button"> & {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
};

export function Button({ className, variant = "outline", size = "md", type = "button", ...rest }: ButtonProps) {
  // Размер `icon` — отдельная база `.icon-btn` (квадрат), а не `.btn` с правками:
  // квадратная кнопка отличается от прямоугольной не только шириной.
  const classes =
    size === "icon"
      ? cn("icon-btn", variant === "outline" ? "icon-btn--outline" : undefined, className)
      : cn("btn", VARIANT[variant], SIZE[size], className);

  return <button className={classes} type={type} {...rest} />;
}

/**
 * Ссылка, выглядящая кнопкой.
 *
 * Обратное запрещено — кнопка, выглядящая ссылкой, ломает клавиатуру и ожидание
 * «откроется в новой вкладке», — а это направление законно и обычно: элемент
 * остаётся `<a href>`, значит работает средняя кнопка мыши, «открыть в новой
 * вкладке» и чтение адреса читалкой. Вид кнопки здесь сообщает не механику, а
 * ВЕС действия: «Загрузка и прогон» — главное, что делают на карточке объекта.
 *
 * Заведено вместе с первым потребителем, а не про запас: примитив без
 * применения в этом проекте ловится гейтом.
 */
export type ButtonLinkProps = ComponentProps<"a"> & {
  readonly variant?: ButtonVariant;
  readonly size?: Exclude<ButtonSize, "icon">;
};

export function ButtonLink({ className, variant = "outline", size = "md", ...rest }: ButtonLinkProps) {
  return <a className={cn("btn", VARIANT[variant], SIZE[size], className)} {...rest} />;
}
