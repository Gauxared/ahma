/**
 * Отмена Проверки из веба — §5.6: «очередь с состоянием, уведомлением, отменой
 * и восстановлением».
 *
 * ОТМЕНЯЕТСЯ ЗАДАЧА, А НЕ РЕЗУЛЬТАТ
 *
 * Очередь отказывается отменять завершённое: отмена сделанного — не отмена, а
 * переписывание истории. Отказ возвращается пользователю причиной, а не молча:
 * «уже выполнена» и «отменена» — разные положения дел, и второй раз жать кнопку
 * человеку незачем.
 */
import { NextResponse } from "next/server";

import { createPrismaClient, withTenant } from "@platform/db/prisma";
import { JobQueue } from "@platform/queue/job-queue";

import { guardMutation } from "@web/lib/mutation.js";
import { publicUrl } from "@web/lib/public-url.js";

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const jobId = String(form.get("jobId") ?? "").trim();
  const objectCode = String(form.get("objectCode") ?? "").trim();

  if (jobId === "" || objectCode === "") {
    return NextResponse.json({ error: "не указана задача или объект" }, { status: 400 });
  }

  const guard = await guardMutation(request, "check:start", {
    action: "check.cancelled",
    resourceKind: "job",
    resourceId: jobId,
  });

  if (!guard.ok) return guard.response;

  const db = createPrismaClient(process.env["DATABASE_URL"]);

  try {
    const outcome = await withTenant(db, guard.viewer.actor.tenantId, async (tx) => {
      const now = new Date();
      const result = await new JobQueue().cancel(tx, jobId, {
        now,
        reason: "отменено пользователем из веба",
      });

      /**
       * СОСТОЯНИЕ ПРОВЕРКИ ИДЁТ ЗА ОТМЕНОЙ ЗАДАЧИ, И ДО ЭТОГО НЕ ШЛО.
       *
       * Отменялась задача, а Проверка оставалась `queued` — навсегда. Замерено
       * на клиентском контуре: тринадцать записей «в очереди», у которых задача
       * отменена месяц назад; История проверок показывала двенадцать таких
       * строк на первой странице, и настоящий прогон с вердиктом уезжал на
       * вторую.
       *
       * Это то же семейство, что закрывала Д2 у падения: состояние Проверки
       * ставилось только на успехе. Отмена — такой же исход, как отказ, и
       * записывать его надо в той же транзакции: окно между отменой задачи и
       * отменой Проверки — это окно, в котором экран врёт.
       */
      if (result.cancelled) {
        await tx.check.updateMany({
          where: { jobs: { some: { id: jobId } }, status: { in: ["queued", "running"] } },
          data: { status: "cancelled", finishedAt: now, phase: null },
        });
      }

      return result;
    });

    const url = publicUrl(request, `/objects/${encodeURIComponent(objectCode)}`);
    // Итог отмены — в адресе, чтобы страница объяснила его словами. Молчаливый
    // возврат оставил бы человека гадать, сработала кнопка или нет.
    url.searchParams.set("отмена", outcome.cancelled ? "да" : "нет");
    if (!outcome.cancelled) url.searchParams.set("причина", outcome.reason ?? "причина не названа");

    return NextResponse.redirect(url, 303);
  } finally {
    await db.$disconnect();
  }
}
