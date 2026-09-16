/**
 * Карта поверхностей как экран.
 *
 * ЧТО ЭТО ЗАМЕНЯЕТ
 *
 * Прежняя главная перечисляла шесть договорных экранов двумя литеральными
 * списками — «Готово» и «Ещё нет». Списки жили в этом файле, и с появлением
 * рельса разделов немедленно начали бы расходиться с ним: рельс обещает то,
 * чего нет в оглавлении, и наоборот.
 *
 * Теперь и рельс, и этот экран — два вида ОДНОГО перечня
 * (`apps/web/src/app-shell/sections.ts`), который сам является проекцией карты
 * поверхностей из `docs/roadmap-frontend.md` §2.
 *
 * ПОЧЕМУ ПРИЧИНА ЖИВЁТ ЗДЕСЬ, А НЕ В РЕЛЬСЕ
 *
 * В рельсе шириной 248 px двадцать причин не поместятся — там остаётся слово
 * состояния и подсказка. Здесь под причину отведена строка, и читается она
 * целиком. Заказчик перечислял двадцать шесть поверхностей; двадцать из них
 * желаемое, и честный ответ на «где это?» — не молчание, а названная нехватка.
 */
import { currentViewer } from "@web/lib/actor";
import { GROUPS, isOpen, NOT_BUILT, SECTIONS, stateLabel, stateTone, type Section } from "@web/src/app-shell/sections.js";
import { shellOf } from "@web/src/app-shell/shell.js";
import { Card, CardBody, CardHead } from "@web/src/ui/kit/card.js";
import { Page, PageHead } from "@web/src/ui/kit/page.js";
import { Pill } from "@web/src/ui/kit/pill.js";

export const dynamic = "force-dynamic";

function Row({ section }: { readonly section: Section }) {
  const ready = section.state.kind === "готов";
  const Icon = section.icon;

  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="cell-title">{section.label}</span>
        <span className="cell-sub">
          {section.state.kind === "готов"
            ? (section.note ?? (section.contract ? "договорный экран" : "открывается ссылкой"))
            : section.state.kind === "объектный"
              // Объектный раздел на оглавлении показывает, ЧТО в нём, а не
              // повод: повода нет — он открывается, как только выбран объект.
              ? (section.note ?? section.state.hint)
              : section.state.reason}
        </span>
      </span>
      <Pill className="shrink-0" dot label={stateLabel(section.state)} tone={stateTone(section.state)} />
      {/* Прочерк, а не пустое место: у образца облика номера поверхности нет, и
          это утверждение, а не пропуск в разметке. */}
      <span className="mono shrink-0 text-[var(--t-micro)] text-[var(--text-4)]">{section.surface ?? "—"}</span>
    </>
  );

  return (
    <li className="border-b border-[var(--line-2)] last:border-b-0">
      {/* Иконка та же, что в рельсе: возвращаясь на оглавление, глаз ищет
          знакомый знак, а не читает список заново. Прежде здесь стрелка
          обозначала «открывается» — но это уже сказано подписью состояния, и
          два сигнала об одном занимали место, нужное иконке раздела. */}
      {ready && section.state.kind === "готов" ? (
        <a
          className="flex items-baseline gap-3.5 px-4 py-3 no-underline hover:bg-[var(--surface-hover)]"
          href={section.state.href}
        >
          <Icon aria-hidden="true" className="shrink-0 translate-y-0.5 text-[var(--text-3)]" size={15} strokeWidth={1.9} />
          {body}
        </a>
      ) : (
        <span className="flex items-baseline gap-3.5 px-4 py-3">
          <Icon aria-hidden="true" className="shrink-0 translate-y-0.5 text-[var(--text-4)]" size={15} strokeWidth={1.9} />
          {body}
        </span>
      )}
    </li>
  );
}

export default async function HomePage() {
  const result = await currentViewer();

  const surfaces = SECTIONS.filter((section) => section.surface !== undefined).length + NOT_BUILT.length;
  const openable = SECTIONS.filter((section) => isOpen(section) && section.surface !== undefined).length;
  const contract = SECTIONS.filter((section) => section.contract).length;

  const content = (
    <Page wide>
      <PageHead
        note={`${surfaces} поверхностей из пяти перечней сведены в один список. Договорных ${contract}, открывается ${openable}; у каждой неоткрывающейся назван повод.`}
        title="Карта поверхностей"
      />

      {GROUPS.map((group) => (
        <Card key={group.title}>
          <CardHead
            aside={`${group.sections.filter((section) => isOpen(section)).length} из ${group.sections.length} открывается`}
            title={group.title}
          />
          <CardBody flush>
            <ul className="m-0 list-none p-0">
              {group.sections.map((section) => (
                <Row key={section.label} section={section} />
              ))}
            </ul>
          </CardBody>
        </Card>
      ))}

      <Card>
        <CardHead aside="в рельсе не предлагаются" title="Решено не строить" />
        <CardBody flush>
          <ul className="m-0 list-none p-0">
            {NOT_BUILT.map((section) => (
              <Row key={section.label} section={section} />
            ))}
          </ul>
        </CardBody>
      </Card>
    </Page>
  );

  if (result.kind === "гость") {
    // Карта показывается и гостю: перечень поверхностей — не данные арендатора,
    // а состав системы. Рельса при этом нет: он несёт подвал с личностью, а
    // личности пока нет.
    return (
      <Page wide>
        <PageHead note="Требуется вход, чтобы открыть разделы." title="Карта поверхностей" />
        <Card>
          <CardBody>
            {result.reason}. <a href="/login">Войти</a>
          </CardBody>
        </Card>
      </Page>
    );
  }

  return shellOf("карта", result.viewer)(content);
}
