import { Info, ShieldAlert, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../cn.js";

/**
 * Врезка: один вывод, который экран хочет сообщить прежде остального.
 *
 * ОДНА НА ЭКРАН
 *
 * На макетах заказчика это «КЛЮЧЕВОЙ РИСК», «КЛЮЧЕВОЙ ФОКУС НЕДЕЛИ»,
 * «КРИТИЧЕСКИЙ ТЕХНИЧЕСКИЙ УЗЕЛ» — и каждый раз ровно одна. Это правильно и
 * должно остаться правилом: две врезки на экране означают, что главного нет.
 *
 * Ширина текста ограничена 78ch в стиле, а не в разметке: строка на всю ширину
 * широкого монитора не читается, сколько бы места ни было.
 */
export type CalloutTone = "warn" | "danger" | "info";

const TONE: Record<CalloutTone, { readonly className: string; readonly Icon: typeof TriangleAlert }> = {
  warn: { className: "", Icon: TriangleAlert },
  danger: { className: "callout--danger", Icon: ShieldAlert },
  info: { className: "callout--info", Icon: Info },
};

export interface CalloutProps {
  readonly tone: CalloutTone;
  readonly title: string;
  readonly children: ReactNode;
  readonly className?: string;
}

export function Callout({ tone, title, children, className }: CalloutProps) {
  const { className: toneClass, Icon } = TONE[tone];

  return (
    <aside className={cn("callout", toneClass, className)}>
      <Icon aria-hidden="true" className="callout__icon" size={18} strokeWidth={2} />
      <div>
        <div className="callout__title">{title}</div>
        <div className="callout__body">{children}</div>
      </div>
    </aside>
  );
}
