/**
 * Подтверждение ревизии человеком — §12, ADR-R-019.
 *
 * ХЭШ ПРИХОДИТ ИЗ ФОРМЫ, А НЕ ИЗ БАЗЫ
 *
 * В форме лежит тот хэш, который был показан на экране. Если в базе другой —
 * предмет изменился между показом и нажатием, и подпись прикрыла бы то, чего
 * человек не видел. Взять хэш из базы «чтобы совпало» значило бы выкинуть саму
 * проверку: подтверждение перестало бы что-либо утверждать.
 */
import { NextResponse } from "next/server";

import { ExtractionRepository } from "@platform/db/extraction-repository";
import { createPrismaClient, withTenant } from "@platform/db/prisma";

import { guardMutation } from "@web/lib/mutation.js";
import { publicUrl } from "@web/lib/public-url.js";

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const objectCode = String(form.get("objectCode") ?? "").trim();
  const versionId = String(form.get("versionId") ?? "").trim();
  const revisionId = String(form.get("revisionId") ?? "").trim();
  const contentHash = String(form.get("contentHash") ?? "").trim();
  const ordinal = String(form.get("ordinal") ?? "").trim();

  if (objectCode === "" || versionId === "" || revisionId === "" || contentHash === "") {
    return NextResponse.json({ error: "не указаны объект, версия, ревизия или хэш" }, { status: 400 });
  }

  const guard = await guardMutation(request, "check:start", {
    action: "extraction.confirmed",
    resourceKind: "extraction-revision",
    resourceId: revisionId,
  });

  if (!guard.ok) return guard.response;

  const db = createPrismaClient(process.env["DATABASE_URL"]);

  try {
    const outcome = await withTenant(db, guard.viewer.actor.tenantId, (tx) =>
      new ExtractionRepository().confirm(tx, {
        tenantId: guard.viewer.actor.tenantId,
        revisionId,
        contentHash,
        actor: guard.viewer.displayName,
        now: new Date(),
      }),
    );

    const back = publicUrl(request, `/objects/${encodeURIComponent(objectCode)}/documents/${versionId}`);
    back.searchParams.set("подтверждение", outcome.confirmed ? "да" : "нет");
    if (ordinal !== "") back.searchParams.set("позиция", ordinal);
    if (!outcome.confirmed) back.searchParams.set("причина", outcome.reason);

    return NextResponse.redirect(back, 303);
  } finally {
    await db.$disconnect();
  }
}
