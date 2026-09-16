#!/usr/bin/env bash
#
# ПЕРЕВОД РАБОТЫ СО СТЕНДА НА ПРОД — РАЗ В НЕДЕЛЮ, ОДНОЙ КОМАНДОЙ.
#
# Вызов с машины разработчика: bash deploy/promote.sh
#
# ЧТО ДЕЛАЕТ: сверяет, что `main` — это в точности предыстория `stage`,
# показывает список того, что поедет, ждёт подтверждения словом, гоняет быстрые
# тесты, переводит `main` на `stage` без слияния (fast-forward), отправляет в
# origin и запускает выпуск прода из ветки `main`.
#
# ПОЧЕМУ FAST-FORWARD, А НЕ MERGE. Прод обязан работать на коде, который
# НЕДЕЛЮ ПРОРАБОТАЛ НА СТЕНДЕ. Слияние создаёт коммит, которого на стенде не
# было: собранное на проде отличается от проверенного, и отличие тем больше,
# чем чаще правят прод напрямую. Если fast-forward невозможен — значит на
# `main` есть коммиты, которых нет на `stage` (обычно горячая правка), и
# сначала их надо влить в стенд:
#
#   git checkout stage && git merge main && git push origin stage
#
# ЧЕГО ЗДЕСЬ НЕТ. Проверки того, что на стенде действительно работали. Это
# ответственность человека: скрипт может убедиться, что код тот же, но не в
# том, что его смотрели.
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")/.."

SSH_HOST=${SSH_HOST:-strintel}
PROD_URL=${PROD_URL:-https://app.strintel.ru/}

if [ -n "$(git status --porcelain)" ]; then
  echo "РАБОЧЕЕ ДЕРЕВО НЕ ЧИСТО. Выпуск идёт из ветки, а не из правок на диске." >&2
  git status --short >&2
  exit 1
fi

echo "== ветки из origin"
git fetch --prune origin

# Ветка `main` обязана быть предысторией `stage`.
if ! git merge-base --is-ancestor origin/main origin/stage; then
  echo "НА main ЕСТЬ КОММИТЫ, КОТОРЫХ НЕТ НА stage:" >&2
  git --no-pager log --oneline origin/stage..origin/main >&2
  echo "Сначала влить их в стенд, отработать неделю там, потом переводить прод." >&2
  exit 1
fi

COUNT=$(git rev-list --count origin/main..origin/stage)

if [ "$COUNT" -eq 0 ]; then
  echo "Прод и стенд на одном коммите: переводить нечего."
  exit 0
fi

echo
echo "== на прод поедет $COUNT коммит(ов):"
git --no-pager log --oneline --no-decorate origin/main..origin/stage
echo
echo "== затронуто файлов:"
git --no-pager diff --stat origin/main origin/stage | tail -1
echo
# МИГРАЦИИ НАЗЫВАЮТСЯ ОТДЕЛЬНО. Выпуск применит их к боевой базе, и обратной
# команды у них нет: человек обязан увидеть их до, а не в журнале после.
MIGRATIONS=$(git diff --name-only --diff-filter=A origin/main origin/stage -- 'prisma/migrations/*/migration.sql' || true)
if [ -n "$MIGRATIONS" ]; then
  echo "== НОВЫЕ МИГРАЦИИ БОЕВОЙ БАЗЫ (применятся при выпуске, откат — только руками):"
  echo "$MIGRATIONS" | sed 's|^|   |'
  echo
fi

printf 'Перевести прод на stage? Введите «да»: '
read -r ANSWER
[ "$ANSWER" = "да" ] || { echo "Отменено."; exit 1; }

if [ "${SKIP_TESTS:-}" != "1" ]; then
  # БАЗА РАЗРАБОТЧИКА ПРОВЕРЯЕТСЯ ДО ТЕСТОВ, А НЕ ИМИ.
  #
  # Часть быстрого набора работает с настоящей базой на 127.0.0.1:5432. Без неё
  # набор падает не «тестом», а `ECONNREFUSED` в четырёх файлах — и человек,
  # переводящий прод, читает это как «мои правки что-то сломали». Замерено на
  # себе 10.09.2026: два файла, четыре отказа, ни одного слова про причину.
  if ! (exec 3<>/dev/tcp/127.0.0.1/5432) 2>/dev/null; then
    echo "БАЗА РАЗРАБОТЧИКА НЕ ОТВЕЧАЕТ на 127.0.0.1:5432." >&2
    echo "Часть быстрого набора работает с настоящей базой. Поднять и повторить:" >&2
    echo "  docker compose up -d postgres" >&2
    echo "Прогнать перевод без тестов (осознанно): SKIP_TESTS=1 bash deploy/promote.sh" >&2
    exit 1
  fi

  echo "== быстрые тесты"
  pnpm test
fi

echo "== main -> stage (fast-forward)"
git checkout --quiet main
git merge --ff-only "origin/stage"
git push origin main

echo "== выпуск прода из ветки main"
ssh "$SSH_HOST" "bash /opt/stroyintellekt/src/deploy/release.sh prod"

echo "== проверка снаружи"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$PROD_URL" || true)
echo "   $PROD_URL -> $CODE"
[ "$CODE" = "200" ] || { echo "ПРОД НЕ ОТВЕЧАЕТ 200. Откат — переключением ссылки, см. deploy/README.md" >&2; exit 1; }

git checkout --quiet stage
echo "== прод на $(git rev-parse --short origin/stage), работа продолжается на stage"
