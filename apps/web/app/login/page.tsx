/**
 * Вход.
 *
 * ПРИЧИНА ОТКАЗА ОДНА НА ВСЕ СЛУЧАИ
 *
 * Так же, как в обработчике: различив «нет пользователя» и «неверный пароль», мы
 * бесплатно отдаём перебор адресов.
 *
 * ПОЧЕМУ ЭКРАН ВЫГЛЯДИТ ИНАЧЕ, ЧЕМ ОСТАЛЬНЫЕ
 *
 * Приём взят из Домовея вместе с числами (`.crm-auth-*`): карточка `min(460px)`
 * на узорном фоне, знак и название продукта внутри карточки, поля с иконкой,
 * кнопка во всю ширину. Причина не в красоте: вход — единственный экран БЕЗ
 * каркаса, и человек, набирающий пароль, должен видеть, куда именно он входит.
 * Прежняя версия была обычной карточкой на пустом фоне и не отвечала на этот
 * вопрос вовсе.
 *
 * Узор фона нарисован повторяющимся градиентом, а не картинкой: у Домовея это
 * замощение их знаком, то есть файл, а внешних запросов и своих бинарных файлов
 * в контуре быть не должно (`Ф-ADR-008`). Приём — из самого Pulse.
 *
 * ЧЕГО ЗДЕСЬ НЕТ, ХОТЯ ЕСТЬ У ДОМОВЕЯ
 *
 *  · **глазка «показать пароль»** — он требует клиентского кода, а `Ф-ADR-010`
 *    разрешает его только там, где серверного рендеринга не хватает. Браузеры и
 *    менеджеры паролей дают своё раскрытие;
 *  · **«не помню пароль»** — восстановления пароля в системе нет: учётные записи
 *    заводит администратор командной строкой. Ссылка на несуществующий поток —
 *    та же ловушка, что кнопка, которая не нажимается (`Ф-ADR-009`);
 *  · **переключателя темы** — тема здесь атрибут поддерева, и на входе
 *    переключать нечего.
 *
 * ОБЪЯСНЕНИЙ НА ЭКРАНЕ НЕТ — РЕШЕНИЕ ВЛАДЕЛЬЦА
 *
 * Здесь стояли два пояснения: почему поле «Организация» обязательно и что
 * учётные записи заводит администратор. Оба верны и оба сняты: вход — экран
 * одного действия, и текст на нём соревнуется с действием, а не помогает ему.
 *
 * Знание не потеряно, оно переехало: про изоляцию арендатора — в комментарий у
 * поля и в `Ф-ADR`, про отсутствие регистрации и восстановления пароля — в
 * `docs/demo-instruction.md` §2, где это читает тот, кто заводит учётные записи.
 * Единственное, что при этом ушло с экрана: запертый пользователь больше не
 * узнаёт из интерфейса, что самостоятельно войти нельзя.
 *
 * ПОДПИСИ ПОЛЕЙ ОСТАЛИСЬ ПОДПИСЯМИ
 *
 * Не `placeholder`: подсказка внутри поля исчезает при первом знаке, и человек,
 * отвлёкшийся на середине формы, теряет вопрос, на который отвечает. Плюс её не
 * видит читалка как имя поля — а имена полей здесь ещё и опора сквозных наборов.
 */
import { ArrowRight, Building2, KeyRound, Mail } from "lucide-react";

import { Callout } from "@web/src/ui/kit/callout.js";

export const dynamic = "force-dynamic";

const REASON: Readonly<Record<string, string>> = {
  denied: "Адрес или пароль не подошли.",
  empty: "Заполните оба поля.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  return (
    <main className="auth">
      <div className="auth__card">
        <div className="auth__brand">
          {/* Знак — файл, а не иконка из набора.
              `alt` пуст намеренно: название продукта стоит рядом ТЕКСТОМ, и
              читалка, прочитав его дважды, сообщила бы о двух разных вещах.
              Размеры заданы обоими числами, чтобы место под знак было занято до
              его загрузки: иначе карточка дёргается на медленной сети. */}
          <span className="auth__mark">
            <img alt="" height={46} src="/logo.png" width={46} />
          </span>
          <span>
            <span className="auth__name">СтройИнтеллект</span>
            <span className="auth__tagline">проверка строительных смет</span>
          </span>
        </div>

        <h1 className="auth__title">Вход в систему</h1>

        {error === undefined ? null : (
          <Callout className="mb-4" title="Войти не удалось" tone="danger">
            {REASON[error] ?? "Войти не удалось."}
          </Callout>
        )}

        <form action="/api/login" className="auth__form" method="post">
          <label className="auth__field">
            <span className="auth__label">Организация</span>
            <span className="auth__input-wrap">
              <Building2 aria-hidden="true" className="shrink-0" size={15} />
              <input autoComplete="organization" className="auth__input" name="tenant" required type="text" />
            </span>
          </label>

          <label className="auth__field">
            <span className="auth__label">Адрес</span>
            <span className="auth__input-wrap">
              <Mail aria-hidden="true" className="shrink-0" size={15} />
              <input autoComplete="username" className="auth__input" name="email" required type="email" />
            </span>
          </label>

          <label className="auth__field">
            <span className="auth__label">Пароль</span>
            <span className="auth__input-wrap">
              <KeyRound aria-hidden="true" className="shrink-0" size={15} />
              <input autoComplete="current-password" className="auth__input" name="password" required type="password" />
            </span>
          </label>

          <button className="auth__submit" type="submit">
            Войти
            <ArrowRight aria-hidden="true" size={15} />
          </button>
        </form>
      </div>
    </main>
  );
}
