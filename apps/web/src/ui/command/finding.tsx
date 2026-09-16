/**
 * Замечание агента — ОДНА разметка на все экраны, где его читают.
 *
 * ЗАЧЕМ ОБЩИЙ КОМПОНЕНТ
 *
 * Замечание показывалось в трёх местах — экран агента, рабочий экран Проверки,
 * доска — и в каждом своей разметкой и своим словарём важности. Разошлись они
 * не в мелочи: на экране агента замечания стояли ПО ВАЖНОСТИ и с полосой тона
 * по краю, а на рабочем экране — в порядке ответа модели и без полосы. Один и
 * тот же список выглядел двумя разными списками, и тяжёлое на втором из них
 * тонуло между «сведениями».
 *
 * Словарь важности здесь ровно один. Три его копии успели разойтись в тоне:
 * `high` был `danger` на одном экране и `warn` на другом — то есть одно и то же
 * замечание красилось в разные цвета в зависимости от того, откуда пришёл
 * читатель.
 *
 * ЧТО КОМПОНЕНТ НЕ РЕШАЕТ ЗА ЭКРАН
 *
 * Ссылку до строки исходного листа: её строит экран агента, у которого есть
 * карта версий документов. Отсутствие ссылки здесь не молчаливое — координата
 * всё равно называется словами, просто не нажимается.
 */
import type { ReactNode } from "react";

import type { ReviewFindingView } from "@web/lib/check-read-model.js";
import { formatAmountsInProse } from "../value/format.js";
import { Pill, type PillTone } from "../kit/pill.js";

/**
 * Порядок важности, её слово и тон — одним списком.
 *
 * Порядок задан явно: по алфавиту `critical` встал бы после `high`, и глаз
 * читал бы не то, что нужно читать первым.
 */
export const SEVERITY_SCALE: readonly (readonly [key: string, word: string, tone: PillTone])[] = [
  ["critical", "критично", "danger"],
  ["high", "высокая", "warn"],
  ["medium", "средняя", "info"],
  ["low", "низкая", "plain"],
  ["info", "сведение", "plain"],
];

/**
 * Место важности в порядке. Неизвестная встаёт в конец: догадываться о её весе
 * значило бы поднять наверх то, о чём мы ничего не знаем.
 */
export function severityPlace(severity: string): number {
  const index = SEVERITY_SCALE.findIndex(([key]) => key === severity);
  return index === -1 ? SEVERITY_SCALE.length : index;
}

/** Слово и тон важности. Ключ артефакта на экран не течёт. */
export function severityWord(severity: string): readonly [string, PillTone] {
  const found = SEVERITY_SCALE.find(([key]) => key === severity);
  return found === undefined ? [severity, "plain"] : [found[1], found[2]];
}

/** Тяжёлое сверху. Порядок ответа модели ничего не значит и читателю не нужен. */
export function byWeight(left: ReviewFindingView, right: ReviewFindingView): number {
  return severityPlace(left.severity) - severityPlace(right.severity);
}

export interface FindingProps {
  readonly finding: ReviewFindingView;
  /**
   * Адрес строки исходного листа — или `null`, если дойти нельзя.
   *
   * Ссылка, ведущая в никуда, хуже её отсутствия: она обещает след и не
   * приводит к нему.
   */
  readonly href?: string | null;
  /**
   * Кто это сказал. Нужен там, где в одном списке замечания разных агентов:
   * без автора «двойной учёт» ГИПа и «двойной учёт» сметчика — одна строка.
   */
  readonly author?: string | undefined;
  /** Порядковый номер в показанном списке. */
  readonly ordinal?: number | undefined;
}

/**
 * ПОЧЕМУ ОСНОВАНИЕ И КООРДИНАТА СТОЯТ РЯДОМ, А НЕ ПО НАВЕДЕНИЮ
 *
 * ТЗ §9: замечание без основания — не вывод. Первое, что спрашивают в
 * переговорах, — «откуда». Прятать ответ в подсказку значит проиграть этот
 * вопрос заранее.
 *
 * Замечание БЕЗ координаты остаётся законным и помечается словом: показать его
 * так же, как замечание со следом, значило бы обесценить след.
 */
export function Finding({ finding, href, author, ordinal }: FindingProps): ReactNode {
  const [word, tone] = severityWord(finding.severity);

  return (
    <li className={`crit crit--${tone}`}>
      <span className="crit__body">
        <span className="crit__statement">{formatAmountsInProse(finding.statement)}</span>
        {finding.basis === "" ? null : (
          <span className="crit__basis">{formatAmountsInProse(finding.basis)}</span>
        )}
        <span className="crit__source">
          {finding.source === null ? (
            <span className="meta">координату в документе агент не назвал: основание текстовое</span>
          ) : (
            <>
              {href === undefined || href === null ? (
                <span className="meta num">{finding.source.where}</span>
              ) : (
                <a className="meta num font-semibold" href={href}>
                  {`${finding.source.where} →`}
                </a>
              )}
              <span className="meta">{`${finding.source.status} · ${finding.source.acquisition}`}</span>
              {/* ФАЙЛ НАЗЫВАЕТСЯ ВСЕГДА, КОГДА ОН ИЗВЕСТЕН.
                  `finding.document` — предмет агента, и у объектного агента он
                  пуст по существу: его предмет — папка объекта. Но позиция свой
                  файл знает (`Ф-152`), и он лежит в источнике. Пока сюда
                  смотрело только поле агента, половина сильных находок стояла с
                  координатой «лист «ЛСР», строка 240» и без ответа на вопрос
                  «в каком файле» — то есть ссылка была, а адреса не было. */}
              {(() => {
                const файл = finding.document === "" ? finding.source.document : finding.document;
                return файл === null || файл === "" ? null : <span className="meta mono">{файл}</span>;
              })()}
              {/* ВЕРСИЯ — графа формы результата, и она отвечает на вопрос
                  «а ту ли смету вы смотрели». Отпечаток длиной шестьдесят
                  четыре знака целиком не нужен: первых двенадцати хватает,
                  чтобы сверить две версии глазами, а полный лежит в подсказке
                  для того, кто будет сверять машинно. */}
              {finding.source.contentHash === null ? null : (
                <span className="meta mono" title={finding.source.contentHash}>
                  {`версия ${finding.source.contentHash.slice(0, 12)}`}
                </span>
              )}
            </>
          )}
        </span>
      </span>
      <span className="crit__author">
        <Pill dot={finding.severity !== "critical"} label={word} loud={finding.severity === "critical"} tone={tone} />
        {/* СУММА ПОЗИЦИИ, А НЕ РИСК. Подпись называет её тем, что она есть:
            оболочка агента кладёт сюда стоимость строки, на которую замечание
            ссылается. Назвать это риском значило бы обещать расчёт, которого
            не было (`Ф-ADR-006`). */}
        {finding.amount === null ? null : (
          <span
            className="crit__amount num"
            title="Сумма позиции, к которой относится замечание. Это не оценка потерь."
          >
            {`${finding.amount.text} ${finding.amount.currency}`}
          </span>
        )}
        {finding.deviation === null ? null : <span className="crit__tact">{finding.deviation}</span>}
        {author === undefined ? null : <span className="crit__tact">{author}</span>}
        {ordinal === undefined ? null : <span className="crit__tact num">{`№ ${ordinal}`}</span>}
      </span>
    </li>
  );
}
