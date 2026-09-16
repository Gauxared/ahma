# Один образ на веб и воркер.
#
# ПОЧЕМУ ОДИН, А НЕ ДВА
#
# Это один пакет: веб и воркер делят `platform/` и `modules/` целиком. Два
# образа означали бы две сборки одного кода и две возможности их
# рассинхронизировать — а расхождение проявилось бы как «проверка из веба даёт
# не то, что из воркера», то есть самым дорогим способом.
#
# Различаются они командой запуска, а не содержимым.

# Версия закреплена точно, а не тегом `22-slim`.
#
# Плавающий тег означает, что сборка через месяц берёт другой базовый образ, и
# «у меня работало» перестаёт быть проверяемым утверждением. Для поставки в
# контур заказчика (M7) это тем более обязательно: релизный набор обязан
# собираться одинаково.
FROM node:22.15.1-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ── Зависимости для сборки: всё, включая инструменты ─────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ── Зависимости для запуска: без инструментов сборки ─────────────────────────
#
# 675 МБ против 1,5 ГБ: eslint, vitest, playwright, typescript и прочее в
# работающем контейнере не нужны. `tsx` и `prisma` в рабочих зависимостях
# намеренно — воркер исполняет TypeScript напрямую, а миграции выполняются из
# этого же образа.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

# ── Сборка веба ───────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .

# Заглушка URL нужна на время генерации: `prisma.config.ts` разрешает строку
# подключения при загрузке, а генерации клиента подключение не требуется — ей
# нужна только схема. Пробрасывать сюда настоящий адрес было бы хуже: он попал
# бы в слой образа.
RUN DATABASE_URL="postgresql://build:build@build/build" pnpm prisma generate

# Веб собирается webpack'ом: у Turbopack нет сопоставления расширений .js → .ts,
# а весь репозиторий пишет импорты по правилам ESM (docs/architecture §6).
RUN pnpm exec next build apps/web --webpack

# ── Итоговый образ ────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production

# pnpm кладётся В ОБРАЗ, в кэш, доступный пользователю `node`.
#
# `corepack enable` сам по себе откладывает загрузку pnpm до первого вызова, и
# контейнер в закрытом контуре (M7) молча не стартует: реестра там нет, а ошибка
# выглядит как «команда не найдена», а не как «нет сети».
#
# `COREPACK_HOME` обязателен. Без него кэш ложится в домашний каталог того, кто
# запускал `prepare`, то есть root, — а процесс работает под `node` и этого кэша
# не видит. Прогон в контейнере показал это буквально: «Corepack is about to
# download pnpm» при уже подготовленном pnpm.
ENV COREPACK_HOME=/opt/corepack
RUN corepack prepare pnpm@9.15.0 --activate && chmod -R a+rX /opt/corepack

# Владелец назначается ПРИ КОПИРОВАНИИ, а не `chown -R` следом.
#
# `chown -R` по 675 МБ мелких файлов pnpm переписывает метаданные каждого файла
# в НОВЫЙ слой: образ удваивается, и разделение рабочих и сборочных
# зависимостей теряет смысл. Плюс идёт минутами на каждой сборке.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/web/.next ./apps/web/.next

# Исходники нужны целиком: воркер исполняется через tsx, а конфигурация
# читается с диска. Для демонстрации это дешевле сборки в JS и не меняет
# поведения; для поставки в контур (M7) собирается отдельный набор.
# `tsconfig.json` обязателен, а не только `tsconfig.base.json`: псевдонимы
# `@platform/*`, `@modules/*` и `@contracts/*` tsx читает именно из него.
# Без него образ собирается, запускается и падает на первом же импорте —
# «Cannot find package '@platform/bootstrap.js'», то есть выглядит как
# отсутствующая зависимость, а не как недостающий файл конфигурации.
COPY --chown=node:node package.json pnpm-lock.yaml prisma.config.ts tsconfig.json tsconfig.base.json ./
COPY --chown=node:node packages ./packages
COPY --chown=node:node platform ./platform
COPY --chown=node:node modules ./modules
COPY --chown=node:node apps ./apps
COPY --chown=node:node tooling ./tooling
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node config ./config

# Клиент Prisma генерируется ЗАНОВО поверх рабочих зависимостей.
#
# Скопировать его из сборочной стадии нельзя: pnpm кладёт сгенерированный
# клиент внутрь самого пакета в хранилище, и пути двух деревьев не совпадают.
# Копирование «похожего места» дало бы образ, падающий на первом обращении к
# базе — с ошибкой «клиент не сгенерирован», которая выглядит как забытая
# команда, а не как порядок слоёв.
RUN DATABASE_URL="postgresql://build:build@build/build" pnpm prisma generate

# Папки объектов подключаются томом: документы заказчика в образ не входят.
RUN mkdir -p /data/objects /app/var && chown node:node /data/objects /app/var

# Непривилегированный пользователь: контейнер, работающий под root, при побеге
# из процесса даёт root на хосте по умолчанию.
USER node

EXPOSE 3000
CMD ["pnpm", "exec", "next", "start", "apps/web", "-H", "0.0.0.0", "-p", "3000"]
