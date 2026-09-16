/**
 * Правка извлечённого значения — ТЗ §5.5, ADR-R-019.
 *
 * ПРАВКА НЕ ЗАМЕНЯЕТ РАЗБОР, А ДОБАВЛЯЕТ РЕВИЗИЮ
 *
 * Позиция в таблице остаётся такой, какой её прочитал разбор. Поверх ложится
 * ревизия с новым значением, автором и причиной. Спор с подрядчиком идёт как
 * раз об этом: «в смете написано другое» — и ответ «система прочитала так,
 * человек исправил вот на это, вот обе версии» единственный, который защищает
 * обе стороны.
 *
 * ПРИЧИНА ОБЯЗАТЕЛЬНА, И ОТКАЗ ПРИХОДИТ ИЗ ЯДРА
 *
 * Проверять её здесь значило бы держать правило в двух местах. `recordEdit`
 * бросает на пустой причине, и обработчик передаёт отказ пользователю словами.
 */
import { NextResponse } from "next/server";

import { ExtractionRepository, positionSubject } from "@platform/db/extraction-repository";
import { createPrismaClient, withTenant } from "@platform/db/prisma";

import { guardMutation } from "@web/lib/mutation.js";
import { publicUrl } from "@web/lib/public-url.js";

const FIELDS = ["количество", "сумма"] as const;
type Field = (typeof FIELDS)[number];

function isField(value: string): value is Field {
  return (FIELDS as readonly string[]).includes(value);
}

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const objectCode = String(form.get("objectCode") ?? "").trim();
  const versionId = String(form.get("versionId") ?? "").trim();
  const ordinal = String(form.get("ordinal") ?? "").trim();
  const field = String(form.get("field") ?? "").trim();
  const value = String(form.get("value") ?? "").trim();
  const reason = String(form.get("reason") ?? "").trim();
  const parsedValue = String(form.get("parsedValue") ?? "").trim();
  const unit = String(form.get("unit") ?? "").trim();
  const locator = String(form.get("locator") ?? "").trim();
  const document = String(form.get("document") ?? "").trim();

  if (objectCode === "" || versionId === "" || ordinal === "" || !isField(field)) {
    return NextResponse.json({ error: "не указаны объект, версия, позиция или поле" }, { status: 400 });
  }

  const guard = await guardMutation(request, "check:start", {
    action: "extraction.revised",
    resourceKind: "position",
    resourceId: `${versionId}/${ordinal}/${field}`,
  });

  if (!guard.ok) return guard.response;

  const back = publicUrl(request, `/objects/${encodeURIComponent(objectCode)}/documents/${versionId}`);
  const db = createPrismaClient(process.env["DATABASE_URL"]);

  try {
    await withTenant(db, guard.viewer.actor.tenantId, (tx) =>
      new ExtractionRepository().recordEdit(tx, {
        tenantId: guard.viewer.actor.tenantId,
        subject: positionSubject(versionId, ordinal, field),
        sourceDocument: document,
        sourceLocator: locator,
        ...(unit === "" ? {} : { unit }),
        // Количество и сумма критичны для сильного вердикта (§5.3): именно они
        // и правятся руками, поэтому флаг здесь не выбирается, а следует из
        // того, какие поля экран вообще разрешает править.
        critical: true,
        parsedValue,
        newValue: value,
        author: guard.viewer.displayName,
        reason,
      }),
    );

    back.searchParams.set("правка", "да");
    back.searchParams.set("позиция", ordinal);
  } catch (error) {
    // Отказ ядра — пользователю словами. Молчаливый возврат оставил бы человека
    // считать, что правка сохранена.
    back.searchParams.set("правка", "нет");
    back.searchParams.set("причина", (error as Error).message);
  } finally {
    await db.$disconnect();
  }

  return NextResponse.redirect(back, 303);
}
