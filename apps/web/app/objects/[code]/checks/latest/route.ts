/**
 * Последняя Проверка объекта — адрес, а не экран.
 *
 * ЗАЧЕМ ОН ЕСТЬ
 *
 * У рабочего экрана Проверки нет статического адреса: он всегда о КОНКРЕТНОМ
 * прогоне. Из-за этого пункт рельса «Рабочий экран» вёл на реестр объектов и
 * делал вид, что ведёт куда-то ещё — одна из пяти ссылок, которые указывали на
 * один и тот же экран.
 *
 * «Открыть последний прогон» — то, чего человек хочет в девяти случаях из десяти,
 * и это выражается адресом. Обработчик перенаправляет на свежую Проверку, а если
 * их нет — на карточку объекта с названной причиной, а не на пустой экран.
 *
 * ПОЧЕМУ НЕ СТРАНИЦА С РЕДИРЕКТОМ
 *
 * Страница отрисовала бы разметку, которую никто не увидит, и на секунду
 * показала бы пустой каркас. Перенаправление — это ответ сервера, и оно
 * происходит до первой отрисовки.
 */
import { NextResponse } from "next/server";

import { currentViewer } from "@web/lib/actor";
import { latestCheckId } from "@web/lib/latest-check";
import { publicUrl } from "@web/lib/public-url";

export async function GET(request: Request, context: { params: Promise<{ code: string }> }): Promise<Response> {
  const { code } = await context.params;
  const result = await currentViewer();

  if (result.kind === "гость") {
    return NextResponse.redirect(publicUrl(request, "/login"), 303);
  }

  const card = publicUrl(request, `/objects/${encodeURIComponent(code)}`);

  if (!result.viewer.can("check:read").allowed) {
    // Отказ показывает сам экран объекта: он умеет назвать недостающее право,
    // а перенаправление умеет только увести.
    return NextResponse.redirect(card, 303);
  }

  // Поиск свежего прогона вынесен в `lib/latest-check.ts`: про него спрашивает
  // ещё и доска агентов, а два запроса одного и того же разошлись бы — например,
  // считали бы свежесть по разным полям, и «последний прогон» на двух экранах
  // оказался бы разным.
  const checkId = await latestCheckId(result.viewer.actor.tenantId, code);

  if (checkId === undefined) {
    card.searchParams.set("прогонов", "нет");
    return NextResponse.redirect(card, 303);
  }

  return NextResponse.redirect(publicUrl(request, `/objects/${encodeURIComponent(code)}/checks/${checkId}`), 303);
}
