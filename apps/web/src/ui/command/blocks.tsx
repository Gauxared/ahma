import { ArrowRight, Check, CircleAlert, Clock, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../cn.js";
import { Pill, type PillTone } from "../kit/pill.js";

/**
 * Блоки штабного экрана.
 *
 * Каркас взят из макетов заказчика (Волковский ГОК, три режима) и там он
 * одинаков для всех трёх ролей: шапка со свежестью данных → цепочка чтения →
 * одна врезка → показатели → четыре квадранта. Это не совпадение, а находка:
 * один ритм на три роли означает, что руководитель, директор и ПТО читают экран
 * одним движением глаз. Здесь ритм оформлен компонентами, чтобы три режима не
 * разошлись при первой правке.
 */

/* ------------------------------------------------------------------------- */

/**
 * Свежесть источников.
 *
 * В макете это три подписи в шапке: ЦИМ 22.08, полевой факт 20.08, сборка 25.08
 * — три РАЗНЫХ возраста данных, а не одна дата «обновлено». Сохранено; добавлено
 * то, чего в макете не было: просроченное помечается словом.
 *
 * Подписи набраны строчными. Заглавные в этом продукте отданы надзаголовку и
 * шапке колонки; шапка экрана, где капсом были и подписи, и бейдж режима,
 * читалась криком, а не структурой.
 */
export interface Freshness {
  readonly label: string;
  readonly date: string;
  readonly note?: string;
  readonly stale?: boolean;
}

export function FreshnessBar({ items }: { readonly items: readonly Freshness[] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap items-baseline gap-x-4 gap-y-1.5 p-0">
      {items.map((item, index) => (
        <li className="flex items-baseline gap-2" key={item.label}>
          {index > 0 ? (
            <span aria-hidden="true" className="text-[var(--line-strong)]">
              ·
            </span>
          ) : null}
          <span className="text-[var(--t-meta)] text-[var(--text-3)]">{item.label}</span>
          <span className="num text-[var(--t-meta)] font-semibold text-[var(--text-2)]">{item.date}</span>
          {item.note === undefined ? null : (
            <span className="text-[var(--t-micro)] text-[var(--text-4)]">{item.note}</span>
          )}
          {item.stale === true ? <Pill dot label="устарело" title="Старше порога свежести" tone="warn" /> : null}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------------- */

/**
 * Цепочка чтения экрана.
 *
 * В макете это строка «Деньги → срок → заморожено → решение сегодня»: она
 * объявляет порядок чтения. Но вёрстка макета его не поддерживала — шесть
 * показателей стояли одним весом, и глазу негде было начать. Здесь цепочка
 * пронумерована, а главный показатель получает свою ступень кегля.
 */
export function ReadingChain({ steps }: { readonly steps: readonly string[] }) {
  return (
    <ol className="m-0 flex list-none flex-wrap items-center gap-x-2.5 gap-y-1 p-0">
      {steps.map((step, index) => (
        <li className="flex items-center gap-2.5" key={step}>
          {index > 0 ? <ArrowRight aria-hidden="true" className="text-[var(--text-4)]" size={13} /> : null}
          <span className="flex items-baseline gap-1.5">
            <span className="num text-[var(--t-micro)] font-bold text-[var(--text-4)]">{index + 1}</span>
            <span className="text-[var(--t-body)] font-semibold">{step}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------------- */

/**
 * Цепочка состояний предмета: выполнено → предъявлено → подписано → оплачено.
 *
 * В макете это четыре галочки и крестика — и это самая содержательная часть
 * карточки: видно, что физика есть, а денег нет.
 *
 * НО СПИСКОМ ОНА БЫЛА НЕ ЦЕПОЧКОЙ. Четыре строки в сетке показывают, ЧТО не
 * сделано, и не показывают, ГДЕ рвётся. Здесь звенья соединены рельсом, и место
 * разрыва — переход от последнего выполненного к первому невыполненному —
 * рисуется пунктиром в цвете тревоги. Это единственная вещь, которую карточка
 * обязана сообщить, и теперь она сообщается формой, а не только цветом слов.
 */
export interface ChainLink {
  readonly label: string;
  readonly done: boolean;
}

export function LinkChain({ links }: { readonly links: readonly ChainLink[] }) {
  return (
    <ol className="vchain m-0 list-none p-0">
      {links.map((link, index) => {
        const next = links[index + 1];
        const breaksHere = link.done && next !== undefined && !next.done;
        return (
          <li
            className={cn(
              "vchain__row",
              link.done ? "vchain__row--done" : "vchain__row--pending",
              breaksHere ? "vchain__row--broken" : undefined,
            )}
            key={link.label}
          >
            <span aria-hidden="true" className="vchain__mark" />
            <span className="vchain__label">
              {link.label}
              {link.done ? null : <span className="sr-only"> — не выполнено</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------------- */

/**
 * Решение с исполнителем и сроком.
 *
 * В макете директора рядом с решением стоит колонка «Если не сделать» — цена
 * невыполнения. Это правильно и обязательно: задача без цены пропуска
 * откладывается, потому что непонятно, чем рискуешь. Поэтому `consequence` —
 * обязательное поле, а не необязательное.
 */
export interface Decision {
  readonly text: string;
  readonly consequence: string;
  readonly owner: string;
  readonly due: string;
  readonly urgent?: boolean;
}

export function DecisionList({ decisions }: { readonly decisions: readonly Decision[] }) {
  return (
    <ol className="m-0 list-none p-0">
      {decisions.map((decision, index) => (
        <li
          className="grid grid-cols-[auto_1fr_auto] gap-x-3.5 border-b border-[var(--line-2)] px-4 py-3 last:border-b-0"
          key={decision.text}
        >
          <span className="num pt-px text-[var(--t-micro)] font-bold text-[var(--text-4)]">{index + 1}</span>
          <div className="min-w-0">
            <p className="m-0 text-[var(--t-body)] font-semibold leading-snug">{decision.text}</p>
            <p className="meta m-0 mt-1">{`если не сделать: ${decision.consequence}`}</p>
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            {decision.urgent === true ? (
              <Pill label="немедленно" loud tone="danger" />
            ) : (
              <span className="num text-[var(--t-meta)] font-semibold text-[var(--text-2)]">{decision.due}</span>
            )}
            <span className="text-[var(--t-micro)] text-[var(--text-4)]">{decision.owner}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------------- */

/**
 * Надёжность данных.
 *
 * Сильнейший ход макета: достоверность вынесена на первый экран, а не спрятана
 * в сноску. У нас под этим уже есть машинерия — снапшот входов, объявленные
 * деградации, порог свежести 90 дней, — поэтому квадрант наполняется настоящим
 * состоянием прогона, а не оценкой автора.
 */
export interface Reliability {
  readonly what: string;
  readonly value: string;
  readonly verdict: "ok" | "check" | "absent";
  readonly action?: string;
}

const VERDICT: Record<
  Reliability["verdict"],
  { readonly tone: PillTone; readonly label: string; readonly loud: boolean; readonly Icon: typeof Check }
> = {
  ok: { tone: "ok", label: "сверено", loud: false, Icon: Check },
  check: { tone: "warn", label: "сверить", loud: true, Icon: TriangleAlert },
  absent: { tone: "danger", label: "нет", loud: true, Icon: CircleAlert },
};

export function ReliabilityList({ items }: { readonly items: readonly Reliability[] }) {
  return (
    <ul className="m-0 list-none p-0">
      {items.map((item) => {
        const { tone, label, loud, Icon } = VERDICT[item.verdict];
        return (
          <li
            className="flex items-baseline gap-3 border-b border-[var(--line-2)] px-4 py-2.5 last:border-b-0"
            key={item.what}
          >
            <Icon aria-hidden="true" className={cn("shrink-0 translate-y-0.5", toneOf(tone))} size={13} strokeWidth={2.5} />
            <span className="min-w-0 flex-1 text-[var(--t-meta)] leading-snug">{item.what}</span>
            <span className="num text-[var(--t-meta)] font-semibold text-[var(--text-2)]">{item.value}</span>
            <Pill
              className="shrink-0"
              label={label}
              tone={tone}
              {...(loud ? { loud: true } : { dot: true })}
              {...(item.action === undefined ? {} : { title: item.action })}
            />
          </li>
        );
      })}
    </ul>
  );
}

function toneOf(tone: PillTone): string {
  switch (tone) {
    case "ok":
      return "text-[var(--ok)]";
    case "warn":
      return "text-[var(--warn)]";
    case "danger":
      return "text-[var(--danger)]";
    case "info":
      return "text-[var(--info)]";
    case "brand":
      return "text-[var(--brand)]";
    case "plain":
      return "text-[var(--text-3)]";
  }
}

/* ------------------------------------------------------------------------- */

/** Сноска-микрокопия под таблицей: объясняет термин там, где он встречен. */
export function Footnote({ children }: { readonly children: ReactNode }) {
  return (
    <p className="meta m-0 flex items-baseline gap-2.5 border-t border-[var(--line-2)] px-4 py-3">
      <Clock aria-hidden="true" className="shrink-0 translate-y-0.5 text-[var(--text-4)]" size={12} />
      <span className="max-w-[92ch]">{children}</span>
    </p>
  );
}
