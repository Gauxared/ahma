/**
 * Доступ — экран, которым заканчивается встреча.
 *
 * ЗАЧЕМ ОН ЗАВЕДЁН
 *
 * Сценарий встречи кончается фразой «вот ссылка, вот вам ограниченный доступ».
 * До этого экрана она означала работу в консоли сервера: пользователи и
 * организации заводились скриптом наполнения. То есть последний шаг главного
 * коммерческого сценария в продукте отсутствовал.
 *
 * ДВА ДЕЙСТВИЯ, И ОНИ РАЗНОЙ ВЛАСТИ
 *
 * «Завести человека в своей организации» (`user:manage`) и «завести чужую
 * организацию» (`tenant:manage`) — разные права, и второе есть только у роли
 * оператора. Показывать их одной карточкой значило бы предложить
 * администратору клиента действие, которого он не может, и получить отказ
 * после заполнения формы.
 *
 * ЧЕГО ЗДЕСЬ НЕТ НАМЕРЕННО
 *
 * Перечня организаций и перечня людей. Первый — чтение поперёк изоляции
 * арендаторов, и сценарию он не нужен: оператор заводит клиента, которого
 * только что видел. Второй — управление людьми, а это уже личный кабинет,
 * который бриф прямо исключает.
 */
import { KeyRound, UserPlus } from "lucide-react";

import { loadRoles } from "@platform/config/roles";

import { currentViewer } from "@web/lib/actor";
import { PASSWORD_MIN } from "@web/lib/access";
import { shellOf } from "@web/src/app-shell/shell.js";
import { Button } from "@web/src/ui/kit/button.js";
import { Callout } from "@web/src/ui/kit/callout.js";
import { Card, CardBody, CardHead } from "@web/src/ui/kit/card.js";
import { Field, Input } from "@web/src/ui/kit/field.js";
import { Page, PageHead } from "@web/src/ui/kit/page.js";
import { StateDenied } from "@web/src/ui/kit/states.js";

export const dynamic = "force-dynamic";

export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ отказ?: string; заведён?: string; организация?: string }>;
}) {
  const result = await currentViewer();

  if (result.kind === "гость") {
    return (
      <Page>
        <PageHead title="Доступ" />
        <Card>
          <CardBody>
            <StateDenied permission="user:manage" reason={`${result.reason}.`}>
              <a href="/login">Войти</a>
            </StateDenied>
          </CardBody>
        </Card>
      </Page>
    );
  }

  const shell = shellOf("доступ", result.viewer, [{ label: "Доступ" }]);
  const canUsers = result.viewer.can("user:manage");
  const canTenants = result.viewer.can("tenant:manage");
  const { отказ, заведён, организация } = await searchParams;

  if (!canUsers.allowed && !canTenants.allowed) {
    return shell(
      <Page>
        <PageHead title="Доступ" />
        <Card>
          <CardBody>
            <StateDenied permission="user:manage" reason={canUsers.reason} />
          </CardBody>
        </Card>
      </Page>,
    );
  }

  // Роли предлагаются ИЗ КОНФИГУРАЦИИ: список в коде разошёлся бы с реестром
  // ролей, и форма предлагала бы роль, которой нет, — вход, который входит и
  // ничего не может.
  // ДОГОВОРНЫЕ роли клиента, без служебных: предлагать администратору клиента
  // роль оператора системы значило бы предлагать раздать право, которого у
  // него нет самого.
  const roles = loadRoles().bundle.roles;

  return shell(
    <Page>
      <PageHead
        note="Заведение входов для клиентов. Перечня людей и организаций здесь нет: чтение поперёк изоляции арендаторов сценарию не нужно."
        title="Доступ"
      />

      {отказ === undefined ? null : (
        <Callout title="Вход не заведён" tone="danger">
          {отказ}
        </Callout>
      )}

      {заведён === undefined ? null : (
        <Callout title="Вход заведён" tone="info">
          {`Организация «${организация ?? "—"}», адрес «${заведён}». Пароль система не показывает и не хранит в открытом виде — продиктуйте тот, который ввели.`}
        </Callout>
      )}

      {canUsers.allowed ? (
        <Card>
          <CardHead
            aside={`организация ${result.viewer.tenantSlug}`}
            note="Человек попадает в вашу организацию и видит только её объекты. Изоляция держится двумя рубежами: решением о доступе и правилами уровня строк в базе."
            title="Новый вход в свою организацию"
          />
          <CardBody>
            <form action="/api/users" className="form-grid" method="post">
              <Field label="Адрес">
                <Input autoComplete="off" name="адрес" placeholder="ivanov@example.ru" required type="email" />
              </Field>
              <Field label="Имя">
                <Input autoComplete="off" name="имя" placeholder="Иванов Иван" required type="text" />
              </Field>
              <Field
                hint={`Не короче ${PASSWORD_MIN} знаков. Система его не покажет — продиктуйте сами.`}
                label="Пароль"
              >
                <Input autoComplete="new-password" minLength={PASSWORD_MIN} name="пароль" required type="password" />
              </Field>
              <Field hint="Права роли заданы конфигурацией клиента, а не кодом." label="Роль">
                <select className="input" defaultValue="user" name="роль" required>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {`${role.title} (${role.id})`}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="form-grid__actions">
                <Button type="submit" variant="primary">
                  <UserPlus aria-hidden="true" size={13} />
                  Завести вход
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      {canTenants.allowed ? (
        <Card>
          <CardHead
            aside="право оператора"
            note="Организация заводится сразу с её администратором: организация без единого входа недостижима — в неё нельзя войти, чтобы завести в неё людей."
            title="Новая организация-клиент"
          />
          <CardBody>
            <form action="/api/tenants" className="form-grid" method="post">
              <Field
                hint="Его набирают руками в форме входа: строчная латиница, цифры и дефис."
                label="Адрес организации"
              >
                <Input autoComplete="off" name="организация" pattern="[a-z0-9][a-z0-9-]{1,31}" required type="text" />
              </Field>
              <Field label="Название">
                <Input autoComplete="off" name="название" placeholder="ООО «Подрядчик»" required type="text" />
              </Field>
              <Field label="Адрес администратора">
                <Input autoComplete="off" name="адрес" required type="email" />
              </Field>
              <Field label="Имя администратора">
                <Input autoComplete="off" name="имя" required type="text" />
              </Field>
              <Field hint={`Не короче ${PASSWORD_MIN} знаков.`} label="Пароль">
                <Input autoComplete="new-password" minLength={PASSWORD_MIN} name="пароль" required type="password" />
              </Field>
              <div className="form-grid__actions">
                <Button type="submit" variant="primary">
                  <KeyRound aria-hidden="true" size={13} />
                  Завести организацию
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : null}
    </Page>,
  );
}
