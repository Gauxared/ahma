/**
 * ДЕМОНСТРАЦИОННАЯ заготовка данных. НЕ для промышленного контура.
 *
 * Заводит арендатора, объект и двух пользователей с ИЗВЕСТНЫМ паролем — этого
 * достаточно, чтобы показать систему, и категорически недостаточно для работы с
 * настоящими данными. Экран управления пользователями §4 появится в M6; до него
 * учётные записи в контуре заказчика заводит администратор, а не скрипт с
 * паролем в исходниках.
 *
 * Запуск:
 *   docker run --rm --network <сеть> -e DATABASE_URL=... \
 *     -v $PWD/tooling/seed-demo.ts:/app/tooling/seed-demo.ts:ro \
 *     stroyintellekt:dev pnpm tsx tooling/seed-demo.ts
 */
import argon2 from "argon2";
import { createPrismaClient, withTenant } from "@platform/db/prisma.js";

const db = createPrismaClient(process.env.DATABASE_URL);
const tenantId = "11111111-1111-1111-1111-111111111111";

await db.tenant.upsert({
  where: { id: tenantId },
  update: {},
  create: { id: tenantId, slug: "apri", displayName: "ПАО «АПРИ»" },
});

const hash = await argon2.hash("демо-2026");

await withTenant(db, tenantId, async (tx) => {
  await tx.projectObject.upsert({
    where: { tenantId_code: { tenantId, code: "KRG-1" } },
    update: {},
    create: { tenantId, code: "KRG-1", name: "ЖДПП Зауралье", region: "Курганская обл." },
  });

  for (const [email, name, role] of [
    ["user@apri.ru", "Пользователь АПРИ", "user"],
    ["admin@apri.ru", "Администратор АПРИ", "admin"],
  ] as const) {
    const u = await tx.user.upsert({
      where: { tenantId_email: { tenantId, email } },
      update: { passwordHash: hash },
      create: { tenantId, email, displayName: name, passwordHash: hash },
    });
    await tx.roleBinding.upsert({
      where: { tenantId_subjectKind_subjectId_roleId: { tenantId, subjectKind: "user", subjectId: u.id, roleId: role } },
      update: {},
      create: { tenantId, subjectKind: "user", subjectId: u.id, roleId: role },
    });
  }
});

console.log("ЗАВЕДЕНО: арендатор apri, объект KRG-1, два пользователя");
await db.$disconnect();
