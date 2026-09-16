#!/usr/bin/env bash
#
# СТЕНД ПОЛУЧАЕТ КОПИЮ БОЕВЫХ ДАННЫХ.
#
# Вызов на сервере: bash deploy/sync-stage-from-prod.sh
#
# ЗАЧЕМ. Стенд, на котором лежат три придуманные сметы, проверяет обращение с
# придуманными сметами. Ошибки разбора, RLS и производительности живут в
# настоящих данных заказчика — их и надо встречать до прода, а не после.
#
# НАПРАВЛЕНИЕ ОДНО: ПРОД → СТЕНД. Обратного скрипта здесь нет и не будет.
# Копирование стенда в прод затирало бы работу настоящих пользователей.
#
# ЧТО ЭТО ЗНАЧИТ ПО СУЩЕСТВУ — сказано вслух: после запуска настоящие данные
# пользователей лежат ВО ВТОРОЙ установке и попадают в её резервные копии.
# Владелец выбрал это осознанно (полная копия важнее обезличивания на стенде);
# обезличивание — отдельная задача, и она не сделана.
#
# ЧЕМ ЭТО ЗАЩИЩЕНО ОТ ЗАПИСИ В БОЕВУЮ БАЗУ. Не порядком параметров в команде, а
# МЕТКОЙ, прочитанной из самой базы: `current_setting('stroyintellect.contour')`.
# Строка подключения говорит, куда собирались подключиться; метка — куда
# подключились. Цель без метки `stage` останавливает скрипт до первой записи.
set -euo pipefail

. "$(dirname "$(readlink -f "$0")")/contours.sh"

contour_load prod
SOURCE_PGPORT=$PGPORT
SOURCE_PGDATABASE=$PGDATABASE
SOURCE_OBJECTS=$OBJECTS

contour_load stage

DUMP=/var/lib/postgresql/prod-to-stage.sql

echo "== копия: $SOURCE_PGDATABASE:$SOURCE_PGPORT -> $PGDATABASE:$PGPORT"

contour_mark() {
  sudo -u postgres psql -p "$1" -d "$2" -At \
    -c "select coalesce(current_setting('stroyintellect.contour', true), '')" 2>/dev/null || echo ''
}

# ЧИТАЕМ МЕТКИ ОБЕИХ БАЗ ДО ЛЮБОЙ ЗАПИСИ.
SOURCE_MARK=$(contour_mark "$SOURCE_PGPORT" "$SOURCE_PGDATABASE")
TARGET_MARK=$(contour_mark "$PGPORT" "$PGDATABASE")

if [ "$SOURCE_MARK" != "prod" ]; then
  echo "ИСТОЧНИК НЕ ПОМЕЧЕН КАК prod (прочитано: «${SOURCE_MARK:-нет метки}»). Копировать нечего." >&2
  exit 1
fi

if [ "$TARGET_MARK" != "stage" ]; then
  echo "ЦЕЛЬ НЕ ПОМЕЧЕНА КАК stage (прочитано: «${TARGET_MARK:-нет метки}»)." >&2
  echo "Скрипт очищает целевую базу целиком и отказывается делать это с непомеченной." >&2
  exit 1
fi

# Выгрузка содержит настоящие данные заказчика. Она не остаётся на диске ни при
# успехе, ни при отказе на середине.
trap 'sudo rm -f "$DUMP"' EXIT

# Службы стенда останавливаются: приложение, читающее таблицы, которые в этот
# момент опустошают, отдаёт ошибки и пишет их в свой журнал как настоящие.
echo "== стенд останавливается"
sudo systemctl stop "$SERVICE_WEB" "$SERVICE_WORKER"

echo "== выгрузка боевых данных (только данные, без схемы)"
# `--disable-triggers` — потому что заливка идёт в базу с внешними ключами и
# RLS. Без него каждая вторая таблица падает с «query would be affected by
# row-level security policy» (замерено 06.09.2026 при первом переносе).
#
# `_prisma_migrations` ИСКЛЮЧЕНА, и это не аккуратность ради аккуратности.
# История миграций — состояние СХЕМЫ контура, а не данные. Приехав из дампа,
# она ложится поверх собственной истории стенда: имена миграций удваиваются, и
# следующий `migrate deploy` разбирается уже не с семнадцатью записями, а с
# сорока шестью.
#
# Это не догадка. В боевой базе на 10.09.2026 — 29 записей на 17 миграций: след
# переноса данных с машины разработчика 06.09, сделанного ровно так, без
# исключения.
sudo -u postgres pg_dump -p "$SOURCE_PGPORT" -d "$SOURCE_PGDATABASE" \
  --data-only --disable-triggers --no-owner --no-privileges \
  --exclude-table-data=public._prisma_migrations -f "$DUMP"
echo "   $(sudo du -h "$DUMP" | cut -f1)"

# Список таблиц берётся ИЗ ЦЕЛЕВОЙ базы, а не из перечисления в скрипте:
# перечисление отстаёт от миграций, и первая же новая таблица приехала бы к
# старым строкам, которых нет в выгрузке.
#
# `_prisma_migrations` не трогается: это состояние схемы стенда, а не данные.
TABLES=$(sudo -u postgres psql -p "$PGPORT" -d "$PGDATABASE" -At -c \
  "select string_agg(quote_ident(tablename), ', ') from pg_tables
    where schemaname = 'public' and tablename <> '_prisma_migrations'")

if [ -z "$TABLES" ]; then
  echo "В целевой базе нет таблиц: сначала миграции (prisma migrate deploy)." >&2
  exit 1
fi

echo "== очистка таблиц стенда"
sudo -u postgres psql -p "$PGPORT" -d "$PGDATABASE" -v ON_ERROR_STOP=1 \
  -c "truncate table $TABLES restart identity cascade"

echo "== заливка"
# Суперпользователем: роль владельца не может ни отключить системные триггеры
# внешних ключей, ни обойти RLS.
sudo -u postgres psql -p "$PGPORT" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -q -f "$DUMP"

# НЕЗАВЕРШЁННЫЕ ЗАДАЧИ ПРОДА НА СТЕНДЕ ОТМЕНЯЮТСЯ.
#
# Очередь живёт в той же базе, и вместе с данными на стенд приезжают задачи в
# состояниях `queued` и `running`. Воркер стенда возьмёт их, как только истечёт
# аренда, — и выполнит ЧУЖУЮ работу второй раз: прогон экипажа идёт до часа и
# стоит миллионы токенов по тому же ключу и тому же бюджету, что боевой.
#
# Делается ДО подъёма служб: после подъёма счёт идёт на секунды до захвата.
CANCELLED=$(sudo -u postgres psql -p "$PGPORT" -d "$PGDATABASE" -At -v ON_ERROR_STOP=1 -c \
  "with отменённые as (
     update job
        set status = 'cancelled',
            \"leaseOwner\" = null,
            \"leaseExpiresAt\" = null,
            \"lastError\" = jsonb_build_object(
              'причина', 'копия боевых данных на стенд: задача не продолжается на другом контуре')
      where status in ('queued', 'running')
      returning 1
   )
   select count(*) from отменённые")

echo "== задач прода отменено на стенде: $CANCELLED"

echo "== документы объектов"
sudo rsync -a --delete "$SOURCE_OBJECTS/" "$OBJECTS/"
sudo chown -R ubuntu:ubuntu "$OBJECTS"
echo "   $(sudo du -sh "$OBJECTS" | cut -f1)"

echo "== стенд поднимается"
sudo systemctl start "$SERVICE_WEB" "$SERVICE_WORKER"

for _ in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)
  [ "$CODE" = "200" ] && break
  sleep 2
done

if [ "${CODE:-000}" != "200" ]; then
  echo "СТЕНД НЕ ОТВЕЧАЕТ ПОСЛЕ КОПИИ (http ${CODE:-000}): journalctl -u $SERVICE_WEB -n 50" >&2
  exit 1
fi

# Сверка руками не отменяется, но самое дешёвое сравнение делает скрипт:
# число строк в ключевых таблицах должно совпасть.
echo "== сверка"
for TABLE in tenant app_user document position job; do
  SOURCE_ROWS=$(sudo -u postgres psql -p "$SOURCE_PGPORT" -d "$SOURCE_PGDATABASE" -At \
    -c "select count(*) from \"$TABLE\"" 2>/dev/null || echo '?')
  TARGET_ROWS=$(sudo -u postgres psql -p "$PGPORT" -d "$PGDATABASE" -At \
    -c "select count(*) from \"$TABLE\"" 2>/dev/null || echo '?')
  if [ "$SOURCE_ROWS" = "$TARGET_ROWS" ]; then
    printf '   %-14s %s\n' "$TABLE" "$TARGET_ROWS"
  else
    printf '   %-14s ПРОД %s != СТЕНД %s\n' "$TABLE" "$SOURCE_ROWS" "$TARGET_ROWS" >&2
  fi
done

echo "== стенд отвечает 200 на порту $PORT с копией боевых данных"
