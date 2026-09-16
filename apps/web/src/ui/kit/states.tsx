import { CircleSlash, Inbox, Lock, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../cn.js";

/**
 * Состояния поверхности. Перенесено из Pulse (`CrmScreenEmpty` / `Loading` /
 * `Error`), где это уже выделено в компоненты.
 *
 * ЧЕТЫРЕ РАЗНЫХ ПОЛОЖЕНИЯ ДЕЛ, А НЕ ОДНО
 *
 * «Данных нет», «нет права смотреть», «источник выключен областью знания» и
 * «запрос не удался» требуют от смотрящего разного: дозагрузить, попросить
 * доступ, включить источник, повторить. Свести их к одной пустой странице
 * значит отнять ответ на вопрос «что теперь делать» — и именно так пустой
 * журнал однажды прочитался бы как «событий не было», хотя это утверждение о
 * правах смотрящего, а не о системе.
 */
export function StateEmpty({
  title,
  children,
  className,
}: {
  readonly title: string;
  readonly children?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn("state", className)}>
      <span aria-hidden="true" className="state__icon">
        <Inbox size={19} strokeWidth={1.8} />
      </span>
      <p className="state__title m-0">{title}</p>
      {children === undefined ? null : <p className="state__body m-0">{children}</p>}
    </div>
  );
}

/**
 * Отказ по праву.
 *
 * ПРИЧИНУ ГОВОРИТ РЕШЕНИЕ О ДОСТУПЕ, А НЕ КОМПОНЕНТ.
 *
 * Компонент формулировал причину сам — «Право X не предоставлено ни одной
 * привязкой актора», — а вызывающий передавал рядом `decision.reason`, который
 * говорит РОВНО ТО ЖЕ. На экране это выглядело так:
 *
 *   «Право audit:read не предоставлено ни одной привязкой актора.
 *    Право audit:read не предоставлено ни одной привязкой актора.
 *    По ТЗ §4 журнал доступен администратору.»
 *
 * Пройдено руками; удвоение стояло на ДЕСЯТИ экранах — везде, где отказ
 * показывается вообще. Оно и не могло не появиться: две стороны отвечали на
 * один вопрос, и обе отвечали правильно.
 *
 * Теперь причина одна и приходит от того, кто принял решение. Право названо
 * отдельной строкой — путь Г-16 требует именно этого: «отказ С НАЗВАНИЕМ
 * ПРАВА», — и строка остаётся верной даже там, где причина о другом («вы не
 * вошли»).
 */
export function StateDenied({
  permission,
  reason,
  children,
  className,
}: {
  readonly permission: string;
  /** Почему отказано — словами того, кто отказал. */
  readonly reason: string;
  /** Что к этому добавляет экран: ссылка на вход, ссылка на договор. */
  readonly children?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn("state", className)}>
      <span aria-hidden="true" className="state__icon">
        <Lock size={19} strokeWidth={1.8} />
      </span>
      <p className="state__title m-0">Доступ закрыт</p>
      <p className="state__body m-0">
        {reason}
        {children === undefined ? null : <> {children}</>}
      </p>
      <p className="state__body meta m-0">{`право: ${permission}`}</p>
    </div>
  );
}

/**
 * Объявленная деградация: содержимое отсутствует не по ошибке, а потому что
 * источник или способность выключены. Отдельное состояние, потому что это
 * решение конфигурации, а не сбой — и починка у него другая.
 */
export function StateDegraded({
  reason,
  className,
}: {
  readonly reason: string;
  readonly className?: string;
}) {
  return (
    <div className={cn("state", className)}>
      <span aria-hidden="true" className="state__icon">
        <CircleSlash size={19} strokeWidth={1.8} />
      </span>
      <p className="state__title m-0">Не построено: объявленная деградация</p>
      <p className="state__body m-0">{reason}</p>
    </div>
  );
}

export function StateFailed({
  children,
  traceId,
  className,
}: {
  readonly children: ReactNode;
  readonly traceId?: string;
  readonly className?: string;
}) {
  return (
    <div className={cn("state state--danger", className)}>
      <span aria-hidden="true" className="state__icon">
        <TriangleAlert size={19} strokeWidth={1.8} />
      </span>
      <p className="state__title m-0">Не удалось получить данные</p>
      <p className="state__body m-0">{children}</p>
      {/* Идентификатор трассировки показывается пользователю намеренно: без него
          обращение в поддержку сводится к «у меня не работает». Внутренности
          ошибки при этом не раскрываются. */}
      {traceId === undefined ? null : <p className="meta mono m-0">{traceId}</p>}
    </div>
  );
}

export function StateLoading({ rows = 3, className }: { readonly rows?: number; readonly className?: string }) {
  return (
    <div aria-busy="true" className={cn("flex flex-col gap-2 p-3.5", className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton h-4" key={index} style={{ width: `${100 - index * 12}%` }} />
      ))}
    </div>
  );
}
