/**
 * Пакет заказчику по объекту — адрес, а не экран.
 *
 * Тот же приём, что у `checks/latest`, и та же причина: пакет собирается из
 * КОНКРЕТНОГО прогона, статического адреса у него нет. Без этого маршрута
 * вкладка «Пакет» на карточке объекта не могла бы существовать — а именно
 * вкладками виды одного объекта и должны переключаться.
 *
 * Дублирования с `checks/latest` здесь нет: поиск свежего прогона лежит в
 * `lib/latest-check.ts`, оба маршрута спрашивают его.
 */
import { NextResponse } from "next/server";

import { currentViewer } from "@web/lib/actor";
import { latestCheckId, latestCheckWithArtifact } from "@web/lib/latest-check";
import { publicUrl } from "@web/lib/public-url";

export async function GET(request: Request, context: { params: Promise<{ code: string }> }): Promise<Response> {
  const { code } = await context.params;
  const result = await currentViewer();

  if (result.kind === "гость") {
    return NextResponse.redirect(publicUrl(request, "/login"), 303);
  }

  const card = publicUrl(request, `/objects/${encodeURIComponent(code)}`);

  if (!result.viewer.can("check:read").allowed) {
    return NextResponse.redirect(card, 303);
  }

  /**
   * ПАКЕТ СОБИРАЕТСЯ ИЗ АРТЕФАКТА, ЗНАЧИТ И ПРОГОН НУЖЕН С АРТЕФАКТОМ.
   *
   * Вкладка вела на САМЫЙ СВЕЖИЙ прогон — включая идущий. У идущего артефакта
   * нет по определению: он появляется в конце. Заказчик, запустивший новую
   * проверку и нажавший «Пакет», получал десять строк «не собран» вместо
   * пакета, который был у него пять минут назад.
   *
   * Ошибка того же вида, что уже исправляли на доске агентов: экран выглядит
   * полным и отвечает не на тот вопрос. Разница в том, что доске идущий прогон
   * НУЖЕН — про него и спрашивают, пока он идёт, — а пакету он бесполезен:
   * скачивать из него нечего.
   *
   * Запасной путь оставлен: если прогона с артефактом нет вовсе, идём в самый
   * свежий, и страница пакета сама скажет «собирать пока нечего». Это честнее,
   * чем «прогонов нет» о проверке, которая идёт.
   */
  const checkId =
    (await latestCheckWithArtifact(result.viewer.actor.tenantId, code)) ??
    (await latestCheckId(result.viewer.actor.tenantId, code));

  if (checkId === undefined) {
    // Повод тот же, что у рабочего экрана: собирать пакет не из чего. Слово
    // «прогонов нет» карточка объекта уже умеет объяснить.
    card.searchParams.set("прогонов", "нет");
    return NextResponse.redirect(card, 303);
  }

  return NextResponse.redirect(
    publicUrl(request, `/objects/${encodeURIComponent(code)}/checks/${checkId}/package`),
    303,
  );
}
