import type { ComponentProps, ReactNode } from "react";

import { cn } from "../cn.js";

/**
 * Карточка и её части. Составной набор, как `Card*` в Pulse: заголовок,
 * необязательная правая приписка, тело, подвал.
 *
 * `aside` в шапке — не украшение. На штабных экранах у каждого блока есть
 * приписка вида «сметная кросс-валидация» или «что убьёт проект», и она
 * объясняет, ПО КАКОМУ правилу собрано содержимое. Без отведённого места её
 * начинают вписывать в заголовок, и заголовок перестаёт быть заголовком.
 */
export function Card({ className, ...rest }: ComponentProps<"section">) {
  return <section className={cn("card", className)} {...rest} />;
}

/**
 * Шапка карточки: заголовок, пояснение ПОД ним, действие справа.
 *
 * `note` появился отдельно от `aside` намеренно. Раньше пояснение передавали
 * через `aside`, и оно уезжало к правому краю: глаз, прочитав заголовок слева,
 * до него не доходил. У Домовея пояснение стоит второй строкой под заголовком —
 * читается вместе с ним, — а справа остаётся только действие.
 *
 * `aside` сохранён для действий («все 167 →», «разбор →») и для сведений, у
 * которых место справа осмысленно: свежесть, число строк.
 */
export function CardHead({
  title,
  note,
  aside,
  className,
  children,
  ...rest
}: ComponentProps<"header"> & {
  readonly title: ReactNode;
  readonly note?: ReactNode;
  readonly aside?: ReactNode;
}) {
  return (
    <header className={cn("card__head", className)} {...rest}>
      <span className="card__head-main">
        <h2 className="card__title">{title}</h2>
        {note === undefined ? null : <span className="card__note">{note}</span>}
      </span>
      {children}
      {aside === undefined ? null : <span className="card__aside">{aside}</span>}
    </header>
  );
}

export function CardBody({ flush, className, ...rest }: ComponentProps<"div"> & { readonly flush?: boolean }) {
  return <div className={cn("card__body", flush === true ? "card__body--flush" : undefined, className)} {...rest} />;
}

export function CardFoot({ className, ...rest }: ComponentProps<"footer">) {
  return <footer className={cn("card__foot", className)} {...rest} />;
}
