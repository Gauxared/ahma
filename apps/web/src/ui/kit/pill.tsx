import type { ReactNode } from "react";

import { cn } from "../cn.js";

/**
 * Статус-токен — единственный способ показать состояние в этом продукте.
 *
 * СЛОВО ОБЯЗАТЕЛЬНО, И ЭТО ВЫРАЖЕНО ТИПОМ
 *
 * `label` — обязательное свойство, а не желательное. Спека прямо требует: «цвет
 * не является единственным сигналом, все statuses имеют text/icon labels», и
 * ровно здесь макеты заказчика были неправы — колонка «Разрыв» несла смысл
 * одними кружками. Сделать `label` необязательным значило бы разрешить ту же
 * ошибку и ждать, что её поймает вычитка ревью. Здесь её ловит компилятор.
 *
 * ТИХИЙ ПО УМОЛЧАНИЮ, ГРОМКИЙ ПО ЗАЯВЛЕНИЮ
 *
 * В первой версии токен всегда рисовался с рамкой, заливкой, капсом и
 * разрядкой. На штабном экране их оказалось около двадцати пяти, и они
 * перекрикивали данные — а когда кричит всё, не слышно ничего.
 *
 * Теперь по умолчанию это цветное слово с точкой. `loud` включается там, где
 * статус — исключение, а не свойство: «критично», «разрыв», «не рассчитано».
 * Правило простое: **статус показателя и отсутствие значения — громко,
 * происхождение числа — тихо.** Происхождение есть у каждого числа, поэтому
 * громким оно быть не может по определению.
 */
export type PillTone = "ok" | "warn" | "danger" | "info" | "brand" | "plain";

const TONE: Record<PillTone, string> = {
  ok: "pill--ok",
  warn: "pill--warn",
  danger: "pill--danger",
  info: "pill--info",
  brand: "pill--brand",
  plain: "pill--plain",
};

export interface PillProps {
  readonly tone: PillTone;
  readonly label: string;
  readonly loud?: boolean;
  readonly dot?: boolean;
  readonly icon?: ReactNode;
  readonly title?: string;
  readonly className?: string;
}

export function Pill({ tone, label, loud, dot, icon, title, className }: PillProps) {
  return (
    <span className={cn("pill", TONE[tone], loud === true ? "pill--loud" : undefined, className)} title={title}>
      {icon}
      {icon === undefined && dot === true ? <span aria-hidden="true" className="pill__dot" /> : null}
      {label}
    </span>
  );
}
