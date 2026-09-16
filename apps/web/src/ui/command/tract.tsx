/**
 * Шаговик тракта — шесть шагов работы и место, в котором находится читатель.
 *
 * ЗАЧЕМ
 *
 * Порядок в системе жёсткий: объект → загрузка → разбор → прогон → вердикт →
 * пакет. Предусловия конвейера прописаны в `config/workflows`, и агент не
 * стартует, пока не готов вход предыдущего. В интерфейсе этого порядка не было
 * ни одного следа — владелец назвал флоу неочевидным, и это было точным
 * описанием.
 *
 * ШАГ ОТМЕЧЕН ПРОЙДЕННЫМ ТОЛЬКО ПО ДАННЫМ
 *
 * `done` — не «сколько шагов нарисовать зелёными», а сколько из них ЗАКРЫТЫ
 * фактом: партия существует, позиции извлечены, прогон завершён. Экран, который
 * этого не знает, передаёт меньшее число, и шаг остаётся впереди. Нарисовать
 * пройденным то, о чём мы не знаем, значило бы сказать клиенту на встрече, что
 * разбор выполнен, когда он не выполнен.
 *
 * ОДНА ПОДСКАЗКА, А НЕ ШЕСТЬ
 *
 * У Домовея под степпером одна строка на активный шаг. Шесть пояснений под
 * шестью узлами превращают полосу навигации в абзац, и её перестают читать.
 */
import { Info } from "lucide-react";
import type { ReactElement } from "react";

/** Шаги тракта — один перечень, в порядке работы. */
const STEPS: readonly { readonly label: string; readonly href?: (code: string) => string }[] = [
  { label: "Объект", href: (code) => `/objects/${code}` },
  { label: "Загрузка", href: (code) => `/objects/${code}/upload` },
  { label: "Разбор", href: (code) => `/objects/${code}/documents` },
  { label: "Прогон", href: (code) => `/objects/${code}/checks/latest` },
  { label: "Вердикт", href: (code) => `/objects/${code}/agents` },
  { label: "Пакет", href: (code) => `/objects/${code}/package` },
];

export const TRACT_STEPS = STEPS.length;

export function Tract({
  code,
  now,
  done,
  hint,
}: {
  readonly code: string;
  /** Номер текущего шага, считая с единицы. */
  readonly now: number;
  /** Сколько шагов закрыты фактом. Меньше `now` — нормально: шаг идёт. */
  readonly done: number;
  /** Что происходит на текущем шаге — одной строкой. */
  readonly hint: string;
}): ReactElement {
  const safe = encodeURIComponent(code);

  return (
    <div className="card">
      <div className="tract">
        {STEPS.map((step, index) => {
          const place = index + 1;
          /**
           * ТЕКУЩИЙ ШАГ СИЛЬНЕЕ ПРОЙДЕННОГО, И ЭТО НЕ ОЧЕВИДНО.
           *
           * Первая версия проверяла `done` первым, и на объекте с сорока
           * четырьмя партиями шаг «Загрузка» стал пройденным — а текущего не
           * осталось ни одного. Гейт это и поймал.
           *
           * Правильно так: стоя на шаге, ты на нём стоишь, даже если его факт
           * уже закрыт. Иначе шаговик отвечает на «что сделано» и перестаёт
           * отвечать на «где я».
           */
          const state = place === now ? "now" : place <= done ? "done" : "ahead";
          const href = step.href?.(safe);

          const inner = (
            <>
              <span className="tract__mark">{place}</span>
              <span className="tract__label">{step.label}</span>
            </>
          );

          // Шаг впереди — не ссылка: пакет по объекту без прогона откроется
          // перенаправлением на карточку, и нажатие будет выглядеть как
          // нажатие, которое ничего не сделало. То же правило, что у рельса.
          return state === "ahead" || href === undefined ? (
            <span className={`tract__step tract__step--${state}`} key={step.label}>
              {inner}
            </span>
          ) : (
            <a className={`tract__step tract__step--${state}`} href={href} key={step.label}>
              {inner}
            </a>
          );
        })}
      </div>
      <p className="tract__hint m-0">
        <Info aria-hidden="true" size={13} />
        {hint}
      </p>
    </div>
  );
}
