/**
 * Вход — единственный пишущий обработчик в контуре просмотра.
 *
 * ПРОВЕРКА ИСТОЧНИКА, А НЕ ТОКЕН В ФОРМЕ
 *
 * CSRF-токен в скрытом поле требует хранить его до отправки — то есть завести
 * сессию для того, кто ещё не вошёл. Для формы входа это лишний оборот.
 * Проверка `Origin`/`Referer` решает ту же задачу: браузер проставляет их сам,
 * подделать их со стороннего сайта нельзя, и отсутствие обоих — уже повод для
 * отказа.
 *
 * ПРИЧИНА ОТКАЗА НЕ РАЗЛИЧАЕТСЯ
 *
 * «Нет такого пользователя» и «неверный пароль» — один ответ. Различив их, мы
 * бесплатно отдаём перебор адресов: узнав, что адрес существует, атакующий уже
 * получил половину.
 *
 * ЗАДЕРЖКА ПРИ НЕИЗВЕСТНОМ ПОЛЬЗОВАТЕЛЕ
 *
 * Проверка argon2 занимает сотни миллисекунд, а ответ «пользователь не найден»
 * — единицы. Разница видна секундомером, и она восстанавливает ровно то
 * различие, которое мы только что убрали. Поэтому хэш проверяется всегда, в
 * том числе против заведомо неподходящего значения.
 *
 * АРЕНДАТОР УСТАНАВЛИВАЕТСЯ ИЗ ЗАПРОСА, А НЕ ОТЫСКИВАЕТСЯ ПО ПОЧТЕ
 *
 * Первая версия искала пользователя по адресу across всех арендаторов — и не
 * нашла никого. RLS сработал как задумано: запрос без контекста не возвращает
 * ничего (ADR-R-015). Это не помеха, которую надо обойти, а верный ответ на
 * неверный вопрос.
 *
 * Обойти его можно было бы через `asPlatform`, но тот заведён «только для
 * миграций, обслуживания и создания самого арендатора». Вход в этот список не
 * входит, и дописать его туда значит завести в системе один запрос, который
 * видит всех пользователей всех клиентов, — ровно то, что RLS и предотвращает.
 *
 * Поэтому арендатор приходит С ФОРМОЙ. В рабочем контуре его даст поддомен;
 * здесь — поле, и это честнее, чем скрытый глобальный поиск. Таблица `tenant`
 * политикой не закрыта намеренно: она корневая, и по ней контекст как раз и
 * устанавливается.
 */
import { NextResponse } from "next/server";

import argon2 from "argon2";

import { createPrismaClient, withTenant } from "@platform/db/prisma";
import { recordAudit } from "@platform/security/audit";
import { issueSession, SESSION_TTL_HOURS } from "@platform/security/session";

import { packCookie, SESSION_COOKIE } from "@web/lib/actor";
import { publicUrl } from "@web/lib/public-url";

/**
 * Хэш заведомо неподходящего пароля.
 *
 * Считается один раз при загрузке модуля и служит «грушей» для проверки, когда
 * пользователя нет: время ответа остаётся тем же.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$c3Ryb3lpbnRlbGxla3Q$0Vh8YQ7Xz0iC0K8n2xJ5mVQ1p1u1z8mWl2n3o4p5q6c";

function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const host = request.headers.get("host");

  if (host === null) return false;

  const source = origin ?? referer;
  if (source === null) {
    // Ни того, ни другого браузер не прислал: это не обычный запрос формы.
    return false;
  }

  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!originAllowed(request)) {
    return NextResponse.json(
      { error: "Запрос отклонён: источник не совпадает с адресом системы" },
      { status: 403 },
    );
  }

  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const tenantSlug = String(form.get("tenant") ?? "").trim().toLowerCase();

  if (email === "" || password === "" || tenantSlug === "") {
    return NextResponse.redirect(publicUrl(request, "/login?error=empty"), 303);
  }

  const db = createPrismaClient(process.env["DATABASE_URL"]);

  try {
    // Корневая таблица: по ней и устанавливается контекст, поэтому политикой
    // она не закрыта.
    const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });

    const user =
      tenant === null
        ? null
        : await withTenant(db, tenant.id, (tx) =>
            tx.user.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email } } }),
          );

    // Хэш проверяется ВСЕГДА: иначе время ответа выдаёт существование адреса.
    // Неизвестный арендатор обязан стоить столько же, сколько известный.
    const hash = user?.passwordHash ?? DUMMY_HASH;
    let ok = false;
    try {
      ok = await argon2.verify(hash, password);
    } catch {
      ok = false;
    }

    if (!ok || user === null || user.disabledAt !== null) {
      // Отказ журналируется: попытки подбора видны только по ним. Причина при
      // этом пишется В ЖУРНАЛ, хотя пользователю не показывается: журнал читает
      // администратор, и ему различие нужно.
      if (tenant !== null) {
        await withTenant(db, tenant.id, (tx) =>
          recordAudit(tx, tenant.id, {
            action: "session.denied",
            resourceKind: "user",
            resourceId: email,
            reason:
              user === null
                ? "пользователь не найден"
                : user.disabledAt !== null
                  ? "учётная запись отключена"
                  : "неверный пароль",
          }),
        );
      }

      // Одна причина на все случаи: «нет арендатора», «нет пользователя»,
      // «неверный пароль» и «учётная запись отключена» снаружи неразличимы.
      return NextResponse.redirect(publicUrl(request, "/login?error=denied"), 303);
    }

    const issued = await withTenant(db, user.tenantId, (tx) =>
      issueSession(tx, {
        tenantId: user.tenantId,
        userId: user.id,
        now: new Date(),
        ...(request.headers.get("user-agent") === null
          ? {}
          : { userAgent: request.headers.get("user-agent")! }),
      }),
    );

    const logged = await withTenant(db, user.tenantId, (tx) =>
      recordAudit(tx, user.tenantId, {
        action: "session.started",
        resourceKind: "session",
        resourceId: issued.id,
        actorId: user.id,
      }),
    );

    if (!logged.written) {
      // Вход состоялся, а запись не легла. Ронять успешный вход нельзя, молчать
      // — тоже: в заголовке остаётся след, по которому это видно в логах.
      console.error(`Журнал: запись о входе не сохранена — ${logged.error}`);
    }

    /**
     * После входа — на ПУЛЬТ, а не в реестр объектов.
     *
     * Реестр отвечает на вопрос «какие у меня объекты», а вошедший спрашивает
     * другое: «что требует моего внимания сейчас». Пульт для этого и сделан —
     * вердикт последнего прогона, критичные замечания, что ждёт подписи. Реестр
     * остаётся первым пунктом рельса, и до него один щелчок.
     */
    const response = NextResponse.redirect(publicUrl(request, "/"), 303);

    response.cookies.set(SESSION_COOKIE, packCookie(user.tenantId, issued.token), {
      httpOnly: true,
      sameSite: "lax",
      // `secure` под HTTPS. В локальной разработке по http такой cookie
      // браузер бы не сохранил, и вход перестал бы работать без объяснения.
      secure: new URL(request.url).protocol === "https:",
      path: "/",
      maxAge: SESSION_TTL_HOURS * 3600,
    });

    return response;
  } finally {
    await db.$disconnect();
  }
}
