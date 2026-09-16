-- Исполненные шаги прогона Проверки (M2, §5.6: воркер переживает рестарт).
--
-- Отдельная таблица, а не запись в журнале аудита: журнал — неизменяемый след
-- действий, а это СОСТОЯНИЕ прогона, по которому воркер решает, что делать
-- дальше. Смешать их — значит лишиться права чистить журнал.

CREATE TABLE "CheckStep" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "checkId" UUID NOT NULL,
    "stage" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'исполнен',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "doneAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckStep_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CheckStep_tenantId_idx" ON "CheckStep"("tenantId");

-- Шаг уникален в прогоне: повтор — это обновление, а не вторая запись.
CREATE UNIQUE INDEX "CheckStep_checkId_stage_agent_key" ON "CheckStep"("checkId", "stage", "agent");

ALTER TABLE "CheckStep" ADD CONSTRAINT "CheckStep_checkId_fkey"
  FOREIGN KEY ("checkId") REFERENCES "check"("id") ON DELETE CASCADE ON UPDATE CASCADE;
