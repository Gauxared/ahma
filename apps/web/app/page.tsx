/**
 * Пульт — первый экран продукта.
 *
 * СЛОИ ВНИМАНИЯ ВЗЯТЫ ИЗ PULSE, СОДЕРЖАНИЕ — ИЗ МАКЕТОВ ЗАКАЗЧИКА
 *
 * Дашборд Domovey раскладывает обстановку на слои: шапка тоном обстановки →
 * «реагировать сейчас» плитками, подсвеченными только при ненулевом счётчике →
 * «где проблема» списком конкретных предметов и очагов → сводка.
 *
 * Первая версия нашего Пульта эти слои проигнорировала: пять одинаково белых
 * карточек, числа разной важности одним весом. Смотреть было некуда — ровно то,
 * что владелец и назвал слабым.
 *
 * Содержание при этом наше, строительное, и взято из «Пульта» и «Штаба» макетов:
 * не SLA и аварии, а вердикт обхода, договорные гейты, ЗАМЕЧАНИЯ СМЕТЧИКА
 * ПОИМЁННО, такты конвейера с агентами, очаги по документам и надёжность данных.
 *
 * ЦЕНТРАЛЬНЫЙ БЛОК — СПИСОК, А НЕ СЧЁТЧИК
 *
 * У макета в середине «кросс-валидация — риски в рублях»: агент, линза, эффект,
 * действие. Счётчик «96 замечаний» говорит, что работа сделана; список говорит,
 * ЧТО именно найдено, и с него начинают. Поэтому находки показаны по важности с
 * основанием и документом.
 *
 * ЧИСЛА ЗДЕСЬ — СЧЁТЧИКИ, И ЭКРАН ЭТО ГОВОРИТ
 *
 * Ни одно не расчёт: их посчитал обход, происхождение у них одно — артефакт
 * Проверки. Оборачивать их в `Valued` с собранным на месте `SourceRef` значило
 * бы приделать провенанс к счётчику (`Ф-ADR-018`).
 */
import {
  Activity,
  CircleAlert,
  Eye,
  FileSpreadsheet,
  Gauge,
  Layers,
  ListChecks,
  ShieldCheck,
  Signature,
  TriangleAlert,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { currentViewer } from "@web/lib/actor";
import { readDashboard, type Dashboard, type FindingView, type GateView } from "@web/lib/dashboard-read-model";
import { shellOf } from "@web/src/app-shell/shell.js";
import { Callout } from "@web/src/ui/kit/callout.js";
import { ButtonLink } from "@web/src/ui/kit/button.js";
import { Card, CardBody, CardHead } from "@web/src/ui/kit/card.js";
import { Page, PageHead } from "@web/src/ui/kit/page.js";
import { Pill, type PillTone } from "@web/src/ui/kit/pill.js";
import { plural, СЛОВО } from "@web/src/ui/value/format.js";
import { ScrollBox } from "@web/src/ui/kit/scroll-box.js";
import { StateDenied, StateEmpty } from "@web/src/ui/kit/states.js";

export const dynamic = "force-dynamic";

type Tone = "calm" | "warn" | "danger";

const SEVERITY: Readonly<Record<string, { readonly label: string; readonly tone: PillTone; readonly dot: Tone }>> = {
  critical: { label: "критично", tone: "danger", dot: "danger" },
  high: { label: "высокая", tone: "warn", dot: "danger" },
  medium: { label: "средняя", tone: "warn", dot: "warn" },
  low: { label: "низкая", tone: "plain", dot: "warn" },
  info: { label: "к сведению", tone: "plain", dot: "calm" },
};

function date(value: Date): string {
  return value.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

/** Заголовок слоя — компактная капс-метка с иконкой, как в Pulse. */
function Layer({ icon: Icon, title, children }: { readonly icon: LucideIcon; readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="dash-section">
      <header className="dash-section__head">
        <Icon aria-hidden="true" className="text-[var(--text-4)]" size={13} />
        <h2 className="dash-section__title">{title}</h2>
      </header>
      {children}
    </section>
  );
}

/**
 * Плитка «реагировать сейчас».
 *
 * ПОДСВЕЧИВАЕТСЯ ТОЛЬКО ПРИ НЕНУЛЕВОМ СЧЁТЧИКЕ — приём Pulse, и он тут важнее
 * всего: «всё чисто» обязано читаться спокойным, иначе тревожный фон перестаёт
 * что-либо значить.
 */
function Alert({
  value,
  label,
  hint,
  icon: Icon,
  tone,
  href,
}: {
  readonly value: number;
  readonly label: string;
  readonly hint: string;
  readonly icon: LucideIcon;
  readonly tone: Tone;
  readonly href?: string;
}) {
  const body = (
    <>
      <span aria-hidden="true" className="dash-alert__icon">
        <Icon size={17} />
      </span>
      <span className="dash-alert__value">{value}</span>
      <span className="dash-alert__label">{label}</span>
      <span className="dash-alert__hint">{hint}</span>
    </>
  );

  const className = `dash-alert dash-alert--${tone}`;

  return href === undefined ? (
    <div className={className}>{body}</div>
  ) : (
    <a className={className} href={href}>
      {body}
    </a>
  );
}

/**
 * Плитка накопленного.
 *
 * Тона у неё нет ни при каком значении — и это отличие от плиток «реагировать
 * сейчас». Сто одна позиция и двадцать четыре события журнала не требуют
 * реакции: это объём выполненной работы, а не происшествие. Красить его значило
 * бы объявить тревогой сам факт, что система работала.
 */
function Recap({
  value,
  label,
  icon: Icon,
  href,
}: {
  readonly value: number;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly href?: string;
}) {
  const body = (
    <>
      <span aria-hidden="true" className="dash-recap__icon">
        <Icon size={15} />
      </span>
      <span className="dash-recap__value">{value}</span>
      <span className="dash-recap__label">{label}</span>
    </>
  );

  return href === undefined ? (
    <div className="dash-recap__cell">{body}</div>
  ) : (
    <a className="dash-recap__cell" href={href}>
      {body}
    </a>
  );
}

function Finding({ finding }: { readonly finding: FindingView }) {
  const view = SEVERITY[finding.severity] ?? SEVERITY["info"]!;

  return (
    // Тон — у КРАЯ строки, а не у точки внутри неё: край непрерывен и виден на
    // просмотре списка сбоку, точку же надо найти.
    <div className={`dash-attn dash-attn--${view.dot}`}>
      <span className="dash-attn__main">
        {/* Замечание — две строки; полный текст открывается раскрытием ниже
            вместе с основанием. Прежняя версия печатала прозу целиком, и
            двадцать критичных замечаний становились одним абзацем на сто сорок
            строк. */}
        <span className="dash-attn__title" title={finding.statement}>
          {finding.statement}
        </span>
        <span className="dash-attn__doc" title={finding.document}>
          {finding.document}
        </span>

        {/* Основание за раскрытием, но ЦЕЛИКОМ и без обрезки: обрезанное
            основание нельзя проверить, а §9 требует его именно для проверки. */}
        {finding.basis === "" ? null : (
          <details className="dash-attn__why">
            <summary>основание</summary>
            <p className="dash-attn__why-body m-0">{finding.basis}</p>
          </details>
        )}
      </span>
      {/* Пилюля тихая даже у критичного.
          `loud` заливает её и добавляет капс — приём для исключения. Когда
          критичных двадцать подряд, залитая пилюля стоит в каждой строке и
          перестаёт что-либо выделять; слово и цвет остаются, крик уходит. */}
      <Pill className="shrink-0" label={view.label} tone={view.tone} />
    </div>
  );
}

function Gate({ gate }: { readonly gate: GateView }) {
  return (
    <div className={`dash-attn dash-attn--${gate.passed ? "ok" : "danger"}`}>
      <span className="dash-attn__main">
        <span className="dash-attn__title">{gate.name}</span>
        <span className="dash-attn__place" title={gate.detail}>
          {gate.detail}
        </span>
      </span>
      <span className="mono shrink-0 text-[var(--t-micro)] text-[var(--text-4)]">{gate.id}</span>
    </div>
  );
}

/**
 * Обстановка одним словом.
 *
 * Тон берётся по ХУДШЕМУ из состояний, а не по их сумме: непройденный гейт не
 * компенсируется тем, что позиции сопоставлены.
 */
function mood(data: Dashboard): { readonly tone: Tone; readonly state: string } {
  const failed = (data.lastCheck?.gates ?? []).filter((gate) => !gate.passed).length;
  const critical = data.lastCheck?.bySeverity.find((row) => row.severity === "critical")?.count ?? 0;

  if (failed > 0 || critical > 0) return { tone: "danger", state: "Требует решения" };
  if (data.pendingSignatures > 0 || data.unmatched > 0 || (data.lastCheck?.degradations.length ?? 0) > 0) {
    return { tone: "warn", state: "Под наблюдением" };
  }
  return { tone: "calm", state: "Под контролем" };
}

/**
 * ВЫБОР ОБЪЕКТА — ПАРАМЕТРОМ АДРЕСА, ЛАТИНИЦЕЙ.
 *
 * Кириллица в адресе запрещена Т1.4 — на этом уже спотыкались: маршрут
 * `/база` отдавал 404. Поэтому `?object=<шифр>`, а не `?объект=`.
 */
export default async function PultPage({ searchParams }: { searchParams: Promise<{ object?: string }> }) {
  const { object: выбран } = await searchParams;
  const result = await currentViewer();

  if (result.kind === "гость") {
    return (
      <Page wide>
        <PageHead note="Требуется вход: пульт показывает данные арендатора." title="СтройИнтеллект" />
        <Card>
          <CardBody>
            <StateDenied permission="check:read" reason={`${result.reason}.`}>
              <a href="/login">Войти</a>
            </StateDenied>
          </CardBody>
        </Card>
      </Page>
    );
  }

  const shell = shellOf("пульт", result.viewer);
  const decision = result.viewer.can("check:read");

  if (!decision.allowed) {
    return shell(
      <Page wide>
        <PageHead title="Пульт" />
        <Card>
          <CardBody>
            <StateDenied permission="check:read" reason={decision.reason} />
          </CardBody>
        </Card>
      </Page>,
    );
  }

  const data = await readDashboard(result.viewer.actor.tenantId, выбран);
  const check = data.lastCheck;

  if (check === undefined) {
    /**
     * Пустой Пульт ВЕДЁТ К ДЕЙСТВИЮ, а не только сообщает.
     *
     * Вход теперь приводит сюда, и первый экран нового контура — этот. Прежняя
     * версия говорила «запустите Проверку на карточке объекта» и не давала туда
     * попасть: человек читал указание и искал, куда нажать. Причина остаётся
     * названной, но рядом стоит ссылка ровно на тот экран, где прогон и
     * запускается.
     *
     * Куда именно вести — зависит от того, есть ли объекты вообще: в пустом
     * контуре нечего и загружать, и там ссылка ведёт в реестр.
     *
     * Шифр берётся из `objectCode` read-модели — он там уже есть. Свой запрос
     * за первым объектом был бы вторым источником одного и того же.
     */
    const first = data.objectCode ?? undefined;

    return shell(
      <Page wide>
        <PageHead note="Ни одна Проверка ещё не дала результата." title="Пульт" />
        <Card>
          <CardBody>
            <StateEmpty title="Показывать нечего">
              Пульт стоит на артефакте последнего обхода: пока прогон не завершился, показывать нечего — и это
              утверждение о прогонах, а не о системе.
            </StateEmpty>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {first === undefined ? (
                <ButtonLink href="/objects" variant="primary">
                  Открыть реестр объектов
                </ButtonLink>
              ) : (
                <>
                  <ButtonLink href={`/objects/${encodeURIComponent(first)}/upload`} variant="primary">
                    Загрузить документы и запустить
                  </ButtonLink>
                  <ButtonLink href={`/objects/${encodeURIComponent(first)}`}>Карточка объекта</ButtonLink>
                </>
              )}
            </div>
          </CardBody>
        </Card>
      </Page>,
    );
  }

  const object = data.objectCode ?? "";
  const checkHref = `/objects/${encodeURIComponent(object)}/checks/${check.id}`;
  const documentsHref = `/objects/${encodeURIComponent(object)}/documents`;
  const failed = check.gates.filter((gate) => !gate.passed);

  /**
   * Подзаголовок обстановки — одной фразой, а не перечислением.
   *
   * Вердикт и число критичных замечаний не противоречат друг другу: обход
   * принял смету к рассмотрению, а замечания говорят, чего в ней не хватает.
   * Экран обязан сказать это связкой, иначе читатель видит два спорящих
   * утверждения.
   */
  const subtitle = ((): string => {
    const passed = check.gates.length - failed.length;
    const gates = `гейтов пройдено ${passed} из ${check.gates.length}`;
    const verdict = check.verdict ?? "не выдан";
    const critical = check.bySeverity.find((row) => row.severity === "critical")?.count ?? 0;

    if (failed.length > 0) {
      return `вердикт обхода: ${verdict}, но ${plural(failed.length, СЛОВО.гейт)} не пройдено — сильный вердикт не выдаётся · ${gates}`;
    }

    if (critical > 0) {
      return `вердикт обхода: ${verdict}, но ${critical} критичных замечаний требуют решения · ${gates}`;
    }

    return `вердикт обхода: ${verdict} · ${gates}`;
  })();

  const critical = check.bySeverity.find((row) => row.severity === "critical")?.count ?? 0;
  const { tone, state } = mood(data);
  const busiest = Math.max(1, ...data.documents.map((document) => document.positions));

  const tiles = [
    {
      value: failed.length,
      label: "Гейтов не пройдено",
      hint: "сильный вердикт не выдаётся",
      icon: ShieldCheck,
      tone: failed.length > 0 ? ("danger" as Tone) : ("calm" as Tone),
      href: checkHref,
    },
    {
      value: critical,
      label: "Критичных замечаний",
      hint: "основание не принять смету",
      icon: CircleAlert,
      tone: critical > 0 ? ("danger" as Tone) : ("calm" as Tone),
      href: checkHref,
    },
    {
      value: data.pendingSignatures,
      label: "Ждут подписи",
      hint: "§12 блокирует сильный вердикт",
      icon: Signature,
      tone: data.pendingSignatures > 0 ? ("warn" as Tone) : ("calm" as Tone),
      href: documentsHref,
    },
    {
      value: data.unmatched,
      label: "Без шифра нормы",
      hint: "расценка не сверена с нормативом",
      icon: FileSpreadsheet,
      tone: data.unmatched > 0 ? ("warn" as Tone) : ("calm" as Tone),
      href: documentsHref,
    },
    {
      value: check.degradations.length + check.reviewFailures.length,
      label: "Способностей нет",
      hint: "часть обзора не выполнена",
      icon: Activity,
      tone: check.degradations.length + check.reviewFailures.length > 0 ? ("warn" as Tone) : ("calm" as Tone),
      href: checkHref,
    },
  ];

  return shell(
    <Page wide>
      {/* Счётчики ушли из подзаголовка в слой итогов внизу. Здесь они стояли
          шрифтом подписи, вплотную и без различия по весу: прочитать их можно
          было только вглядываясь, а вглядываться в подзаголовок никто не будет.
          Осталось то, ради чего подзаголовок и существует — какой объект. */}
      <PageHead note={data.objectName ?? "объект не заведён"} title="Пульт" />

      {/*
        ПЕРЕКЛЮЧАТЕЛЬ ОБЪЕКТА.

        До 09.09.2026 Пульт показывал объект последнего завершённого прогона, и
        сменить его было нечем: какой объект ни открывай, экран один и тот же.
        Ссылками, а не выпадающим списком: список требует скрипта и обработчика,
        а здесь достаточно адреса — и он же делится, сохраняется в закладке и
        открывается в соседней вкладке.
      */}
      {data.objectList.length > 1 ? (
        <nav aria-label="Объект пульта" className="dash-objects">
          {data.objectList.map((item) => (
            <a
              aria-current={item.code === data.objectCode ? "page" : undefined}
              className={`dash-objects__item${item.code === data.objectCode ? " dash-objects__item--current" : ""}`}
              href={`/?object=${encodeURIComponent(item.code)}`}
              key={item.code}
              title={item.name}
            >
              {item.code}
            </a>
          ))}
        </nav>
      ) : null}

      {/* Слой 0 — обстановка. Тон по худшему из состояний: непройденный гейт не
          компенсируется тем, что позиции сопоставлены. */}
      <div className={`dash-hero dash-hero--${tone}`}>
        <span className="dash-hero__pulse">
          <span aria-hidden="true" className="dash-hero__dot" />
          <span>
            <span className="dash-hero__state">{state}</span>
            {/* ШАПКА ОБЯЗАНА СВЯЗЫВАТЬ СЛОВО С ВЕРДИКТОМ, А НЕ СТАВИТЬ ИХ РЯДОМ.
                Было: «Требует решения» и под ним «вердикт обхода: принято» —
                оба утверждения верны, а вместе читаются противоречием, и
                читатель решает, что экран сломан. Слово берётся по худшему из
                состояний (`mood`), вердикт — из артефакта, и связку между ними
                надо произнести: принято, НО есть критичные. */}
            <p className="dash-hero__sub">{subtitle}</p>
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <span className="meta">{`прогон ${date(check.producedAt)}`}</span>
          <span className="mono text-[var(--t-micro)] text-[var(--text-4)]">
            {`${check.operationId} v${check.operationVersion} · ${check.completeness}`}
          </span>
          {data.liveJobs > 0 ? <Pill dot label={`в очереди ${data.liveJobs}`} tone="info" /> : null}
        </span>
      </div>

      <Layer icon={Zap} title="Реагировать сейчас">
        <div className="dash-alert-row" style={{ "--dash-alert-cols": tiles.length } as never}>
          {tiles.map((tile) => (
            <Alert
              hint={tile.hint}
              href={tile.href}
              icon={tile.icon}
              key={tile.label}
              label={tile.label}
              tone={tile.tone}
              value={tile.value}
            />
          ))}
        </div>
      </Layer>

      <Layer icon={Eye} title="Где проблема">
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <Card>
            <CardHead
              aside={
                check.findings > check.topFindings.length ? (
                  <a className="font-semibold" href={checkHref}>
                    {`все ${check.findings} →`}
                  </a>
                ) : (
                  <a className="font-semibold" href={checkHref}>
                    рабочий экран →
                  </a>
                )
              }
              note="По важности, с основанием. Обрезано двумя строками — основание раскрывается по щелчку."
              title="Замечания сметчика"
            />
            <CardBody flush>
              {check.topFindings.length > 0 ? (
                /* ФИКСИРОВАННАЯ ВЫСОТА СО СВОЕЙ ПРОКРУТКОЙ.
                   Замечаний бывает двадцать, бывает двести, и список тянул
                   карточку на всю их длину: соседний виджет «Очаги по
                   документам» оставался коротким, и два блока в одной строке
                   разъезжались на экран и больше. Высота задана, прокрутка
                   внутри — сетка держится, а список остаётся полным. */
                <ScrollBox label="Замечания сметчика">
                  {check.topFindings.map((finding) => (
                    <Finding finding={finding} key={finding.statement} />
                  ))}
                </ScrollBox>
              ) : check.reviewFailures.length > 0 ? (
                /* «Замечаний нет» и «обзор не выполнен» — разные утверждения, и
                   второе нельзя показывать первым. Первое означает, что смета
                   чиста; второе — что о ней ничего не известно. */
                <div>
                  {check.reviewFailures.map((failure) => (
                    <div className="dash-attn dash-attn--warn" key={failure.reason}>
                      <span className="dash-attn__main">
                        <span className="dash-attn__title">
                          {`Обзор не выполнен — затронуто документов: ${failure.documents.length}`}
                        </span>
                        <span className="dash-attn__place" title={failure.documents.join("; ")}>
                          {failure.reason}
                        </span>
                      </span>
                      <Pill className="shrink-0" label="нет данных" loud tone="warn" />
                    </div>
                  ))}
                </div>
              ) : (
                <StateEmpty title="Замечаний нет">
                  Обзор выполнен и ни одного замечания не дал. Это утверждение о смете, а не о том, что обзор не
                  запускался.
                </StateEmpty>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHead
              aside={
                <a className="font-semibold" href={documentsHref}>
                  разбор →
                </a>
              }
              note="Где сосредоточены позиции и сколько из них без нормативного шифра."
              title="Очаги по документам"
            />
            <CardBody>
              {data.documents.length === 0 ? (
                <StateEmpty title="Документов нет">Разбор появляется вместе с Проверкой по папке объекта.</StateEmpty>
              ) : (
                <ScrollBox label="Очаги по документам">
                  {data.documents.map((document) => (
                    <div className="dash-spot" key={document.versionId}>
                      <span className="dash-spot__head">
                        <span className="dash-spot__name">
                          <FileSpreadsheet aria-hidden="true" className="shrink-0 text-[var(--text-4)]" size={13} />
                          <a className="truncate" href={`${documentsHref}/${document.versionId}`} title={document.fileName}>
                            {document.fileName}
                          </a>
                        </span>
                        <span className="dash-spot__count">{document.positions}</span>
                      </span>
                      {/* Полоса ОТНОСИТЕЛЬНАЯ — к самому нагруженному документу, а
                          не к сумме: сравнивают строки между собой, а не с итогом. */}
                      <span className="dash-spot__bar">
                        <span
                          className={document.unmatched > 0 ? "dash-spot__fill--warn" : undefined}
                          style={{ width: `${Math.round((document.positions / busiest) * 100)}%` }}
                        />
                      </span>
                      <p className="dash-spot__meta">
                        {document.unmatched === 0
                          ? `${document.kind} · все позиции сопоставлены`
                          : `${document.kind} · без шифра ${document.unmatched}`}
                      </p>
                    </div>
                  ))}
                </ScrollBox>
              )}
            </CardBody>
          </Card>
        </div>
      </Layer>

      <Layer icon={ListChecks} title="Что проверено">
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <Card>
            <CardHead note="Каждый гейт — пункт ТЗ либо внутренний инвариант." title="Договорные гейты" />
            <CardBody flush>
              {/* Та же фиксированная высота, что у замечаний: гейтов девять и
                  у каждого своё объяснение, а такты рядом занимают вчетверо
                  меньше. Без ограничения две карточки в строке расходились на
                  692 и 236 пикселей — замерено. */}
              <ScrollBox label="Договорные гейты">
                {check.gates.map((gate) => (
                  <Gate gate={gate} key={gate.id} />
                ))}
              </ScrollBox>
            </CardBody>
          </Card>

          <Card>
            <CardHead note="Кто отработал на каждой ступени конвейера." title="Такты конвейера" />
            <CardBody flush>
              {data.stages.length === 0 ? (
                <StateEmpty title="Такты не записаны">
                  Проверка выполнена операцией напрямую, а не воркфлоу: ступеней у неё нет.
                </StateEmpty>
              ) : (
                <div>
                  {data.stages.map((stage) => (
                    <div className="dash-attn dash-attn--ok" key={stage.stage}>
                      <span className="dash-attn__main">
                        <span className="dash-attn__title">{stage.stage}</span>
                        <span className="dash-attn__place">
                          {stage.agents.map((entry) => `${entry.agent} — ${entry.status}`).join(" · ")}
                        </span>
                      </span>
                      <span className="num shrink-0 text-[var(--t-meta)] text-[var(--text-3)]">
                        {stage.agents.length}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </Layer>

      <Layer icon={Layers} title="Что накопилось">
        <div className="dash-recap">
          <Recap
            href={`/objects/${encodeURIComponent(object)}`}
            icon={ListChecks}
            label="Проверок по контуру"
            value={data.checksTotal}
          />
          <Recap href={documentsHref} icon={FileSpreadsheet} label="Позиций извлечено" value={data.positions} />
          <Recap href={documentsHref} icon={FileSpreadsheet} label="Документов разобрано" value={data.documents.length} />
          {/* Журнал требует права `audit:read`, и ссылка на него стоит у всех:
              отказ назовёт недостающее право словом, а скрытая ссылка оставила
              бы человека в неведении, что раздел существует. */}
          <Recap href="/journal" icon={Signature} label="Событий журнала" value={data.auditEvents} />
        </div>
      </Layer>

      <Layer icon={Gauge} title="Чему здесь верить">
        <Callout title="Числа на экране — счётчики артефакта" tone="info">
          Всё, кроме замечаний, — то, что посчитал обход в артефакте{" "}
          <a href={checkHref}>{`${check.operationId} v${check.operationVersion}`}</a> от {date(check.producedAt)}.
          Это не расчёты: следа формулы у них нет, и экран его не изображает. Числа с происхождением — в сравнении
          предложений и на позициях, где раскрытие показывает строку исходного листа.
          {check.degradations.length === 0 ? null : (
            <>
              {" "}Объявленные деградации прогона:{" "}
              {check.degradations.map((degradation) => `${degradation.capability} — ${degradation.reason}`).join("; ")}.
            </>
          )}
        </Callout>
      </Layer>

      <p className="meta m-0 flex items-center gap-2">
        <TriangleAlert aria-hidden="true" size={12} />
        <a href="/map">Карта поверхностей</a> — что в системе есть, чего нет и по какому поводу.
      </p>
    </Page>,
  );
}
