import { Check, LogOut, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { cookies } from "next/headers";
import type { ReactElement, ReactNode } from "react";

import type { Viewer } from "@web/lib/actor";
import { readCurrentObject } from "@web/lib/current-object";
import { readRailCounts, type RailCounts } from "@web/lib/rail-counts";

import { OBJECT_COOKIE } from "./object-cookie.js";
import { chooseObject } from "./object-preference.js";
import { RAIL_COOKIE, RAIL_NARROW } from "./rail-cookie.js";
import { toggleRail } from "./rail-preference.js";
import { RailToggleForm } from "./rail-toggle.js";
import { AutoSubmitSelect } from "./object-select.js";

import { RAIL_GROUPS, groupOf, hrefOf, keyOf, parentHrefOf, sectionOf, type Section } from "./sections.js";

/**
 * Каркас приложения: рельс разделов, шапка, рабочая область.
 *
 * ГЕОМЕТРИЯ ВЗЯТА ИЗ PULSE, А НЕ ПРИДУМАНА
 *
 * Оболочка перенесена с `domovey/apps/web-crm/src/app-shell/pulse/**` вместе с
 * числами: рельс 240 px, брэнд-блок и шапка по 56 px, пункт `7px/16px` с
 * двухпиксельной полосой активности слева, название через `flex: 1` с
 * многоточием, счётчик справа моношрифтом. Это `Ф-ADR-001` в действии — систему
 * переносим, а не изобретаем заново.
 *
 * Первая версия каркаса эти числа угадывала, и промахнулась в трёх местах
 * разом: названия ломались на две строки, полоса прокрутки рельса торчала серым
 * жёлобом, а личность жила в шапке, оставляя её полупустой.
 *
 * ЧЕТЫРЕ ВЕЩИ, КОТОРЫЕ PULSE РЕШАЕТ, А МЫ НЕ РЕШАЛИ
 *
 *  1. У КАЖДОГО ПУНКТА ИКОНКА. Рельс без иконок читается как список ссылок, а
 *     не как навигация продукта; глазу не за что зацепиться при возврате.
 *  2. `white-space: nowrap` + многоточие на названии. Ломающееся название — это
 *     не «длинный текст», это рваная панель.
 *  3. Прокрутка рельса скрыта (`::-webkit-scrollbar { width: 0 }`). Жёлоб внутри
 *     тёмной панели выглядит как дефект сборки.
 *  4. Личность — в подвале рельса, а не в шапке. Шапка освобождается под то,
 *     что меняется от экрана к экрану: путь и заголовок.
 *
 * ПОЧЕМУ КОМПОНЕНТ, А НЕ LAYOUT
 *
 * Активный раздел — функция того, где пользователь находится, и знать это
 * должен сервер. Next не передаёт адрес в layout, а `usePathname` сделал бы
 * рельс клиентским компонентом ради одной подсветки. Поэтому каркас — обычный
 * компонент, и страница ОБЪЯВЛЯЕТ, где она в системе, передавая `S-NN`.
 *
 * Побочная польза: новый экран нельзя добавить, не решив, в каком он разделе.
 *
 * РЕЛЬС НЕ ПОЛЬЗУЕТСЯ ТЁМНОЙ ТЕМОЙ, У НЕГО СВОИ ТОКЕНЫ
 *
 * Прежде рельс включал `data-theme="dark"` на себе. Приём работал, но означал,
 * что любой компонент внутри рельса перекрашивается в тёмную тему целиком — и
 * статус-токен рельса начинал жить по правилам штабного экрана. Как в Pulse,
 * у рельса теперь своя палитра `--rail-*`: она не зависит от темы страницы, и
 * проверка контраста видит её отдельными парами.
 */

/**
 * Пункт рельса.
 *
 * НЕГОТОВЫЙ ПУНКТ — НЕ ССЫЛКА ВОВСЕ
 *
 * Не отключённая ссылка и не серая: и то и другое приглашает нажать. Здесь у
 * неготового раздела нет элемента `<a>` в разметке, и это следует из типа —
 * адрес есть только у состояния `готов`.
 *
 * Причина неготовности едет в `title` вместе с полным названием: в рельсе
 * рядом с названием остаётся только класс нехватки, а причина целиком читается
 * на оглавлении, где под неё отведена строка.
 */
function NavItem({
  section,
  active,
  counts,
  objectCode,
}: {
  readonly section: Section;
  readonly active: boolean;
  readonly counts: RailCounts;
  /** Шифр выбранного объекта: от него зависят адреса объектных разделов. */
  readonly objectCode: string | undefined;
}) {
  const Icon = section.icon;
  const full = section.note === undefined ? section.label : `${section.label} · ${section.note}`;
  const count = section.counter === undefined ? 0 : counts[section.counter];

  const inner = (
    <>
      <Icon aria-hidden="true" className="rail__item-icon" size={15} strokeWidth={1.9} />
      <span className="rail__item-label">{section.label}</span>
      {/* Ноль не показывается — правило Pulse: он создаёт шум и ничего не
          сообщает. Метки «вне договора» здесь больше нет вовсе: неготовое
          собрано в свою группу и набрано серым, а повод живёт в подсказке и на
          карте поверхностей, где под него отведена строка. */}
      {count > 0 ? <span className="rail__item-count">{count}</span> : null}
    </>
  );

  const href = hrefOf(section, objectCode);

  if (href !== undefined) {
    return (
      <li>
        <a
          aria-current={active ? "page" : undefined}
          className={active ? "rail__item rail__item--active" : "rail__item"}
          href={href}
          title={
            section.state.kind === "объектный" && objectCode !== undefined
              ? `${full} · ${section.state.hint} — объект ${objectCode}`
              : full
          }
        >
          {inner}
        </a>
      </li>
    );
  }

  /**
   * Повод, по которому раздел не ссылка.
   *
   * У объектного раздела он ОДИН и не про недоделку: объект не выбран. Сказать
   * вместо этого «вне договора» значило бы соврать про готовность, а промолчать
   * — оставить «пока нельзя», которое читается как поломка.
   */
  const reason =
    section.state.kind === "объектный"
      ? "объект не выбран: выберите его в шапке"
      : section.state.kind === "готов"
        // Сюда попасть нельзя: у готового раздела адрес есть всегда, и
        // `hrefOf` его вернул бы. Ветка существует для компилятора, и лучше
        // сказать это словом, чем поставить пустую строку и оставить читателя
        // гадать, бывает ли такое состояние.
        ? "адрес раздела не вычислился — это ошибка сборки рельса"
        : section.state.reason;

  return (
    <li>
      <span className="rail__item rail__item--off" title={`${full} — ${reason}`}>
        {inner}
      </span>
    </li>
  );
}

/** Название продукта — одно на каркас, чтобы сравнение с ним не разошлось. */
const PRODUCT = "СтройИнтеллект";

export interface ShellViewer {
  readonly displayName: string;
  /** Как организация называется для человека — «ПАО «АПРИ»», а не `apri`. */
  readonly tenant: string;
  /** Чем она опознаётся — для запроса счётчиков рельса под нужным арендатором. */
  readonly tenantId: string;
  readonly roleIds: readonly string[];
}

/**
 * Кто смотрит — в том виде, в котором это нужно подвалу рельса.
 *
 * Каркас берёт три поля, а не весь `Viewer` с точкой политики: иначе оболочка
 * получила бы возможность решать о правах, а решают о них экраны.
 */
export function shellViewer(viewer: Viewer): ShellViewer {
  return {
    displayName: viewer.displayName,
    tenant: viewer.tenantName,
    tenantId: viewer.actor.tenantId,
    roleIds: viewer.roleIds,
  };
}

export interface Crumb {
  readonly label: string;
  readonly href?: string;
}

/** Первая буква для аватара; пусто заменяется вопросом, а не пропадает. */
function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed === "" ? "?" : trimmed.charAt(0).toUpperCase();
}

export async function AppShell({
  active,
  viewer,
  trail,
  objectCode,
  children,
}: {
  /** Поверхность карты: страница объявляет, где она в системе. */
  readonly active: string;
  readonly viewer: ShellViewer;
  /** Путь внутри раздела. Без него шапка показывает сам раздел. */
  readonly trail?: readonly Crumb[];
  /**
   * Объект, экран которого открыт. Объявляет его САМА страница: она это знает,
   * а оболочка адреса не видит. Пусто у необъектных экранов.
   */
  readonly objectCode?: string;
  readonly children: ReactNode;
}) {
  const group = groupOf(active);
  const section = sectionOf(active);
  const counts = await readRailCounts(viewer.tenantId);

  // Свёрнутость — сохранённая настройка посетителя, а не состояние вида:
  // она переживает перезагрузку и одинакова на всех экранах (`Ф-ADR-010`).
  const jar = await cookies();
  const collapsed = jar.get(RAIL_COOKIE)?.value === RAIL_NARROW;

  /**
   * Выбранный объект — от него зависят адреса объектных разделов.
   *
   * Значение cookie не принимается на слово: объект мог быть удалён или
   * принадлежать другому арендатору, и тогда рельс предлагал бы ссылки в
   * никуда. Проверку делает `readCurrentObject` — по базе, под арендатором.
   *
   * Открытый экран объявляет свой объект и перекрывает cookie: человек,
   * стоящий на объекте, не должен выбирать в шапке то, что уже открыто.
   */
  const current = await readCurrentObject(viewer.tenantId, jar.get(OBJECT_COOKIE)?.value, objectCode);

  return (
    <div className={collapsed ? "shell shell--narrow" : "shell"}>
      <aside aria-label="Разделы системы" className="rail">
        <div className="rail__brand">
          <a className="rail__brand-link" href="/" title="СтройИнтеллект">
            {/* Знак файлом. На свёрнутом рельсе он остаётся единственным, что
                опознаёт продукт, — название скрыто, и подменять его иконкой из
                набора значило бы прятать знак ровно там, где он нужнее всего.
                `alt` пуст: название стоит рядом текстом, а на свёрнутом рельсе
                его несёт `title` у ссылки. */}
            <span className="rail__brand-mark">
              <img alt="" height={22} src="/logo.png" width={22} />
            </span>
            <span className="rail__brand-meta">
              <span className="rail__brand-name">{PRODUCT}</span>
              {/* Организация подписывается ТОЛЬКО если она не сам продукт.
                  У демо-арендатора организация называется «СтройИнтеллект» —
                  универсально, без имени клиента, — и вторая такая же строка
                  под знаком читалась бы как ошибка вёрстки, а не как сведение.
                  Молчание здесь честно: сказать нечего, потому что организация
                  и есть продукт. */}
              {viewer.tenant === PRODUCT ? null : (
                <span className="rail__brand-tenant">{viewer.tenant}</span>
              )}
            </span>
          </a>
        </div>

        {/* Рельс на узком экране — раскрытие, а не выезжающая панель:
            `<details>` работает без единой строки клиентского кода, а панель
            потребовала бы обработчика и состояния. */}
        <details className="rail__drawer">
          <summary className="rail__drawer-summary">Разделы</summary>
          <nav className="rail__nav">
            {RAIL_GROUPS.map((navGroup) => (
              <div
                className={
                  navGroup.title === "В разработке" ? "rail__group rail__group--pending" : "rail__group"
                }
                key={navGroup.title}
              >
                <p className="rail__group-label">{navGroup.title}</p>
                <ul className="m-0 list-none p-0">
                  {navGroup.sections.map((item) => (
                    <NavItem
                      active={keyOf(item) !== undefined && keyOf(item) === active}
                      counts={counts}
                      key={item.label}
                      objectCode={current.chosen?.code}
                      section={item}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </details>

        {/* Подвал: кто вошёл и как выйти. Выход существовал маршрутом и не имел
            ни одной кнопки в интерфейсе — выйти можно было только удалив cookie
            руками. */}
        <div className="rail__footer">
          <span aria-hidden="true" className="rail__avatar">
            {initialOf(viewer.displayName)}
          </span>
          <span className="rail__user">
            <span className="rail__user-name" title={viewer.displayName}>
              {viewer.displayName}
            </span>
            <span className="rail__user-role">
              {viewer.roleIds.length === 0 ? "ролей нет" : viewer.roleIds.join(", ")}
            </span>
          </span>
          <form action="/api/logout" method="post">
            <button aria-label="Выйти" className="rail__logout" title="Выйти" type="submit">
              <LogOut aria-hidden="true" size={14} />
            </button>
          </form>
        </div>
      </aside>

      <div className="pane">
        <header className="topbar">
          {/* Сворачивание рельса — форма с серверным действием, а не кнопка с
              обработчиком: настройка переживает перезагрузку и одинакова на всех
              экранах, значит живёт на сервере (`Ф-ADR-010`). Адрес возврата не
              передаётся и не нужен — действие объявляет раскладку устаревшей, и
              текущий экран перерисовывается на месте. */}
          <RailToggleForm collapsed={collapsed} />

          <nav aria-label="Путь" className="topbar__crumbs">
            {group === undefined ? null : (
              <>
                <span className="topbar__group">{group.title}</span>
                <span aria-hidden="true" className="topbar__sep">
                  /
                </span>
              </>
            )}
            {/* Раздел показывается, только если он есть в рельсе. Прежде здесь
                стояло «Оглавление» как запасное слово, и экран поиска
                подписывался оглавлением — то есть шапка называла не то место,
                в котором пользователь находится. Лучше не назвать, чем назвать
                неверно: путь ниже скажет сам. */}
            {/* ДЕТАЛЬ ПОДПИСЫВАЕТСЯ СВОИМ РАЗДЕЛОМ, И РАЗДЕЛ — ССЫЛКА.
                Виды объекта уехали из рельса во вкладки карточки, и путь
                остался единственным местом, где видно, откуда пользователь
                пришёл. У Домовея крошки карточки заявки — «Работа / Заявки /
                Карточка заявки», где «Заявки» ведёт в список. Без обратной
                ссылки выход из карточки объекта был только через рельс, то
                есть мимо реестра. */}
            {section === undefined ? null : (() => {
              const back = parentHrefOf(section);

              // Раздел без адреса ссылкой не становится: ссылка, ведущая не
              // туда, куда обещает, хуже отсутствия ссылки — то же правило,
              // что и у неготового пункта рельса.
              if (section.detailOf === undefined || back === undefined) {
                return <span className="topbar__now">{section.label}</span>;
              }

              return (
                <a className="topbar__crumb" href={back}>
                  {section.detailOf}
                </a>
              );
            })()}
            {(trail ?? []).map((crumb, index) => (
              <span className="flex items-center gap-2" key={crumb.label}>
                {section === undefined && index === 0 ? null : (
                  <span aria-hidden="true" className="topbar__sep">
                    /
                  </span>
                )}
                {crumb.href === undefined ? (
                  <span className="topbar__crumb" aria-current="page">
                    {crumb.label}
                  </span>
                ) : (
                  <a className="topbar__crumb" href={crumb.href}>
                    {crumb.label}
                  </a>
                )}
              </span>
            ))}
          </nav>

          {/* ПЕРЕКЛЮЧАТЕЛЬ ОБЪЕКТА.
              Приём из прототипа «Десктоп», где сверху рельса стоит выбор
              стройки, а разделы относятся к выбранной. Он здесь не для удобства:
              без него у карточки объекта, загрузки, сравнения КП и рабочего
              экрана нет адреса, и все четыре вели на реестр — пять пунктов
              рельса из девяти указывали на один экран.

              `<select>` с отправкой по изменению требовал бы клиентского кода;
              вместо него кнопка рядом. Форма отправляется на серверное действие,
              как свёртка рельса, и выбор переживает переходы (`Ф-ADR-010`). */}
          {current.all.length === 0 ? null : (
            <form action={chooseObject} className="topbar__object">
              <label className="sr-only" htmlFor="топбар-объект">
                Объект
              </label>
              {/* `key` НЕ УКРАШЕНИЕ.
                  `defaultValue` задаёт значение только при первой отрисовке. На
                  повторной React сверяет дерево и НЕ переписывает значение поля
                  — переключатель после выбора продолжал показывать «объект не
                  выбран», хотя выбор уже применился и адреса в рельсе сменились.
                  Я сам на этом обманулся: решил, что действие не сработало.
                  Ключ, зависящий от выбора, заставляет поле пересоздаться. */}
              <AutoSubmitSelect
                className="topbar__object-select"
                defaultValue={current.chosen?.code ?? ""}
                name="объект"
              >
                {current.chosen === null ? <option value="">объект не выбран</option> : null}
                {current.all.map((object) => (
                  <option key={object.code} value={object.code}>
                    {`${object.code} · ${object.name}`}
                  </option>
                ))}
              </AutoSubmitSelect>
              <button className="hidden" title="Выбрать объект" type="submit">
                <Check aria-hidden="true" size={14} />
              </button>
            </form>
          )}

          {/* ПОИСК ИЩЕТ. Строка поиска, которая ничего не делает, — та же
              ловушка, что кнопка без обработчика (`Ф-ADR-009`), поэтому она
              появилась только вместе с экраном результатов: объекты по шифру и
              названию, документы по имени файла. */}
          <form action="/search" className="topbar__search" method="get">
            <label className="topbar__search-field">
              <Search aria-hidden="true" className="shrink-0 text-[var(--text-4)]" size={14} />
              <input
                aria-label="Поиск по объектам и документам"
                className="topbar__search-input"
                name="q"
                placeholder="Объект, шифр, имя файла…"
                type="search"
              />
            </label>
          </form>

          {/* Индикатор состояния очереди — то же назначение, что у «живых
              событий» в Pulse: сказать, идёт ли сейчас работа. Показывается
              только когда идёт: спокойное состояние не требует пометки. */}
          {counts.pending > 0 ? (
            <span className="topbar__badge" title="Правки извлечения без подписи человека">
              <span aria-hidden="true" className="topbar__badge-dot" />
              {`ждут подписи ${counts.pending}`}
            </span>
          ) : null}
        </header>

        {children}
      </div>
    </div>
  );
}

/**
 * Каркас как обёртка одного значения.
 *
 * У экранов по четыре-пять выходов: гость, отказ по праву, сбой чтения, не
 * найдено, результат. Обернуть каждый в `<AppShell>` значит добавить по два
 * уровня вложенности в пять мест и переотбить всю разметку — а переотбитая
 * разметка в коммите скрывает содержательную правку под шумом отступов.
 *
 * Поэтому страница один раз объявляет, где она в системе, и дальше каждый выход
 * оборачивается вызовом. Отказ при этом остаётся ВНУТРИ каркаса: рельс на месте,
 * и пользователь видит, что раздел существует, а не что система пуста.
 */
export function shellOf(
  active: string,
  viewer: Viewer,
  trail?: readonly Crumb[],
  /** Объект этого экрана. Объектная страница обязана его назвать — см. AppShell. */
  objectCode?: string,
): (body: ReactNode) => ReactElement {
  const packed = shellViewer(viewer);

  // Необязательные свойства передаются только когда они есть: при
  // `exactOptionalPropertyTypes` «нет пути» и «путь равен undefined» — разные
  // утверждения, и второе типом запрещено. Так и правильнее: необязательное
  // свойство либо есть, либо его нет.
  const extra = {
    ...(trail === undefined ? {} : { trail }),
    ...(objectCode === undefined ? {} : { objectCode }),
  };

  return (body) => (
    <AppShell active={active} viewer={packed} {...extra}>
      {body}
    </AppShell>
  );
}
