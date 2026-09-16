import type { ComponentProps, ReactNode } from "react";

import { cn } from "../cn.js";

/**
 * Поле ввода с подписью.
 *
 * Подпись — элемент `<label>`, обёрнутый вокруг поля, а не `placeholder`.
 * Подсказка внутри поля исчезает при первом символе: пользователь, отвлёкшийся
 * на середине формы, теряет вопрос, на который отвечает. Плюс её не видит
 * читалка экрана как имя поля.
 *
 * `hint` живёт ПОД полем, а не в `title`: пояснение, доступное только по
 * наведению, недоступно с клавиатуры и на планшете.
 */
export function Field({
  label,
  hint,
  children,
  className,
}: {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <label className={cn("field", className)}>
      <span className="field__label">{label}</span>
      {children}
      {hint === undefined ? null : <span className="field__hint">{hint}</span>}
    </label>
  );
}

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cn("input", className)} {...rest} />;
}
