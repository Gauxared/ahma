-- Сессии пользователей (M6, ТЗ §4).
--
-- ТОКЕН ХРАНИТСЯ ХЭШЕМ. Дамп базы — обычное дело: резервная копия, выгрузка для
-- отладки, доступ администратора БД. Токен в открытом виде превратил бы любую
-- такую копию в связку ключей от всех живых сессий, причём воспользоваться ими
-- можно было бы, не оставив следа входа.

CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ip" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- Поиск идёт по хэшу: идентификатор сессии клиенту не известен.
CREATE UNIQUE INDEX "session_tokenHash_key" ON "session"("tokenHash");
CREATE INDEX "session_tenantId_idx" ON "session"("tenantId");
CREATE INDEX "session_userId_idx" ON "session"("userId");

ALTER TABLE "session" ADD CONSTRAINT "session_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Изоляция арендатора (ADR-R-015). Новая таблица без политики — дыра, которую
-- не видно: запросы продолжают работать, а второй рубеж на ней отсутствует.
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "session" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "session"
  USING ("tenantId" = stroyintellect_current_tenant())
  WITH CHECK ("tenantId" = stroyintellect_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON "session" TO stroyintellect_app;
