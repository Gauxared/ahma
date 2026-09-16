# Производственный план трёх премиальных презентаций «СтройИнтеллект»

> **Для агентных исполнителей:** обязательно использовать `subagent-driven-development` или `executing-plans` и выполнять задачи последовательно с проверкой после каждого файла. Все шаги отмечаются флажками.

**Цель:** создать три отдельные профессиональные презентации на 44, 36 и 40 слайдов, реальные PDF и полный комплект визуальной и текстовой проверки.

**Архитектура:** работа разделена на общую доказательную и визуальную основу и три независимо проверяемых файла. Каждый PowerPoint создаётся как самостоятельный 16:9 документ с встроенными стилями и без внешних ресурсов; PDF печатается из того же источника через Chrome, затем каждая страница рендерится в PNG и проверяется.

**Технологии:** HTML/CSS PowerPoint-источники Factory, встроенные изображения `data:`, Google Chrome headless, Poppler (`pdfinfo`, `pdftotext`, `pdftoppm`), Python 3 и Pillow для контактных листов.

---

## Структура файлов

### Общие артефакты

- Create: `tmp/stroyintellekt-v5-slide-ledger.md` — 120 строк: файл, слайд, вывод, источник, статус утверждения, визуальный тип, риск.
- Create: `tmp/stroyintellekt-v5-claim-check.txt` — обязательные и запрещённые формулировки для автоматической проверки.
- Create: `tmp/stroyintellekt-v5-asset-index.md` — разрешённые обезличенные фрагменты и назначение каждого изображения.

### Коммерческое предложение

- Create: `tmp/stroyintellekt-commercial-premium-v5.pptx.html`
- Create: `product/presentation/droid-gpt56/export-v5-premium/СтройИнтеллект_Коммерческое_предложение_V5.pdf`
- Create: `tmp/qa-v5-commercial/`
- Detailed plan: `docs/superpowers/plans/2026-08-12-stroyintellekt-commercial-premium-v5.md`

### Кейсбук

- Create: `tmp/stroyintellekt-casebook-premium-v5.pptx.html`
- Create: `product/presentation/droid-gpt56/export-v5-premium/СтройИнтеллект_Кейсбук_V5.pdf`
- Create: `tmp/qa-v5-casebook/`
- Detailed plan: `docs/superpowers/plans/2026-08-12-stroyintellekt-casebook-premium-v5.md`

### Руководство продаж

- Create: `tmp/stroyintellekt-sales-playbook-premium-v5.pptx.html`
- Create: `product/presentation/droid-gpt56/export-v5-premium/СтройИнтеллект_Руководство_продаж_V5.pdf`
- Create: `tmp/qa-v5-sales/`
- Detailed plan: `docs/superpowers/plans/2026-08-12-stroyintellekt-sales-premium-v5.md`

## Task 1: Собрать единый реестр 120 слайдов

**Files:**
- Create: `tmp/stroyintellekt-v5-slide-ledger.md`
- Read: `docs/superpowers/specs/2026-08-12-stroyintellekt-three-deck-premium-design.md`
- Read: `product/droid-gpt56/05-positioning-message-house-and-proof-ledger.md`
- Read: `tmp/v3-source-extract/КП_СтройИнтеллект_АПРИ_v3.md`
- Read: `tmp/v3-source-extract/ТЗ_СтройИнтеллект_АПРИ_v3.md`

- [ ] **Step 1:** Создать таблицу с колонками `Deck`, `Slide`, `Title`, `Decision`, `Source`, `Claim status`, `Visual`, `Risk`, `QA`.
- [ ] **Step 2:** Перенести все 44, 36 и 40 слайдов из спецификации без изменения нумерации.
- [ ] **Step 3:** Для каждого слайда указать минимум один точный источник или статус `иллюстративная управленческая схема`.
- [ ] **Step 4:** Для каждой цифры указать статус: договорный факт, целевой критерий приёмки, продуктовый выбор, наблюдаемый артефакт или запрещено.
- [ ] **Step 5:** Проверить количество строк:

```bash
python3 - <<'PY'
from pathlib import Path
p = Path("tmp/stroyintellekt-v5-slide-ledger.md")
text = p.read_text(encoding="utf-8")
for deck, expected in [("commercial", 44), ("casebook", 36), ("sales", 40)]:
    actual = sum(1 for line in text.splitlines() if line.startswith(f"| {deck} |"))
    assert actual == expected, (deck, actual, expected)
print("OK: 44/36/40")
PY
```

Expected: `OK: 44/36/40`.

## Task 2: Подготовить реестр утверждений и визуальных активов

**Files:**
- Create: `tmp/stroyintellekt-v5-claim-check.txt`
- Create: `tmp/stroyintellekt-v5-asset-index.md`
- Read: `product/droid-gpt56/05-positioning-message-house-and-proof-ledger.md`
- Read: `tmp/reference-media/`
- Read: `reference-system-new/Выход/АПРИ/0 Кейсы/`

- [ ] **Step 1:** Записать обязательные строки: `от 20 млн ₽`, `с НДС 22%`, `целевой критерий приёмки`, `решение принимает специалист`, `не является юридическим техническим заказчиком`.
- [ ] **Step 2:** Записать запрещённые строки: `250+`, `гарантированная экономия`, `заменяет службу`, `не ошибается`, `полный анализ за часы`, `±3–5%` без статуса критерия.
- [ ] **Step 3:** Проиндексировать только те фрагменты кейсов, которые можно обезличить без потери смысла.
- [ ] **Step 4:** Для каждого актива указать `source`, `crop`, `redaction`, `allowed deck`, `caption`, `proof limit`.
- [ ] **Step 5:** Не копировать клиентские названия, реквизиты, адреса, суммы и другие признаки повторной идентификации.

## Task 3: Собрать коммерческое предложение

**Files:**
- Create: `tmp/stroyintellekt-commercial-premium-v5.pptx.html`
- Follow: `docs/superpowers/plans/2026-08-12-stroyintellekt-commercial-premium-v5.md`

- [ ] **Step 1:** Выполнить подробный план коммерческой презентации.
- [ ] **Step 2:** Проверить ровно 44 секции `.slide`, уникальные `id="s1"`…`id="s44"` и атрибуты `data-source`.
- [ ] **Step 3:** Не начинать кейсбук до прохождения структурной и визуальной проверки коммерческого файла.

## Task 4: Собрать кейсбук

**Files:**
- Create: `tmp/stroyintellekt-casebook-premium-v5.pptx.html`
- Follow: `docs/superpowers/plans/2026-08-12-stroyintellekt-casebook-premium-v5.md`

- [ ] **Step 1:** Выполнить подробный план кейсбука.
- [ ] **Step 2:** Проверить ровно 36 секций `.slide`, уникальные идентификаторы и источник каждого кейса.
- [ ] **Step 3:** Не принимать файл, если хотя бы один кейс не содержит явный блок «что доказывает / чего не доказывает».

## Task 5: Собрать руководство продаж

**Files:**
- Create: `tmp/stroyintellekt-sales-playbook-premium-v5.pptx.html`
- Follow: `docs/superpowers/plans/2026-08-12-stroyintellekt-sales-premium-v5.md`

- [ ] **Step 1:** Выполнить подробный план внутреннего руководства.
- [ ] **Step 2:** Проверить ровно 40 секций `.slide`, уникальные идентификаторы и отсутствие клиентских конфиденциальных данных.
- [ ] **Step 3:** Проверить, что каждый операционный слайд содержит правило, вопрос, критерий перехода или действие.

## Task 6: Экспортировать три PDF

**Files:**
- Create: `product/presentation/droid-gpt56/export-v5-premium/*.pdf`

- [ ] **Step 1:** Создать папку экспорта:

```bash
mkdir -p "product/presentation/droid-gpt56/export-v5-premium"
```

- [ ] **Step 2:** Напечатать коммерческое предложение:

```bash
/usr/bin/google-chrome --headless --disable-gpu --no-sandbox --no-pdf-header-footer \
  --print-to-pdf="product/presentation/droid-gpt56/export-v5-premium/СтройИнтеллект_Коммерческое_предложение_V5.pdf" \
  "file:///home/govard/projects/7rl/stroyintellekt/tmp/stroyintellekt-commercial-premium-v5.pptx.html"
```

- [ ] **Step 3:** Напечатать кейсбук и руководство продаж:

```bash
/usr/bin/google-chrome --headless --disable-gpu --no-sandbox --no-pdf-header-footer \
  --print-to-pdf="product/presentation/droid-gpt56/export-v5-premium/СтройИнтеллект_Кейсбук_V5.pdf" \
  "file:///home/govard/projects/7rl/stroyintellekt/tmp/stroyintellekt-casebook-premium-v5.pptx.html"

/usr/bin/google-chrome --headless --disable-gpu --no-sandbox --no-pdf-header-footer \
  --print-to-pdf="product/presentation/droid-gpt56/export-v5-premium/СтройИнтеллект_Руководство_продаж_V5.pdf" \
  "file:///home/govard/projects/7rl/stroyintellekt/tmp/stroyintellekt-sales-playbook-premium-v5.pptx.html"
```
- [ ] **Step 4:** Проверить число страниц:

```bash
pdfinfo "product/presentation/droid-gpt56/export-v5-premium/СтройИнтеллект_Коммерческое_предложение_V5.pdf" | grep '^Pages:'
pdfinfo "product/presentation/droid-gpt56/export-v5-premium/СтройИнтеллект_Кейсбук_V5.pdf" | grep '^Pages:'
pdfinfo "product/presentation/droid-gpt56/export-v5-premium/СтройИнтеллект_Руководство_продаж_V5.pdf" | grep '^Pages:'
```

Expected: `44`, `36`, `40`.

## Task 7: Выполнить визуальную проверку

**Files:**
- Create: `tmp/qa-v5-commercial/*.png`
- Create: `tmp/qa-v5-casebook/*.png`
- Create: `tmp/qa-v5-sales/*.png`

- [ ] **Step 1:** Рендерить страницы:

```bash
mkdir -p tmp/qa-v5-commercial tmp/qa-v5-casebook tmp/qa-v5-sales
pdftoppm -png -r 144 "product/presentation/droid-gpt56/export-v5-premium/СтройИнтеллект_Коммерческое_предложение_V5.pdf" "tmp/qa-v5-commercial/slide"
pdftoppm -png -r 144 "product/presentation/droid-gpt56/export-v5-premium/СтройИнтеллект_Кейсбук_V5.pdf" "tmp/qa-v5-casebook/slide"
pdftoppm -png -r 144 "product/presentation/droid-gpt56/export-v5-premium/СтройИнтеллект_Руководство_продаж_V5.pdf" "tmp/qa-v5-sales/slide"
```

- [ ] **Step 2:** Создать контактные листы с Pillow, по 4 колонки, с номером страницы под каждым превью:

```bash
python3 - <<'PY'
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw

for folder in [
    Path("tmp/qa-v5-commercial"),
    Path("tmp/qa-v5-casebook"),
    Path("tmp/qa-v5-sales"),
]:
    files = sorted(folder.glob("slide-*.png"))
    assert files, folder
    columns = 4
    thumb_w, thumb_h, label_h, gap = 320, 180, 26, 16
    rows = (len(files) + columns - 1) // columns
    sheet = Image.new(
        "RGB",
        (columns * thumb_w + (columns + 1) * gap,
         rows * (thumb_h + label_h) + (rows + 1) * gap),
        "white",
    )
    draw = ImageDraw.Draw(sheet)
    for index, file in enumerate(files):
        image = Image.open(file).convert("RGB")
        image = ImageOps.contain(image, (thumb_w, thumb_h))
        col, row = index % columns, index // columns
        x = gap + col * (thumb_w + gap)
        y = gap + row * (thumb_h + label_h + gap)
        sheet.paste(image, (x, y))
        draw.text((x, y + thumb_h + 4), f"{index + 1:02d}", fill="black")
    sheet.save(folder / "contact-sheet.png")
    print(folder / "contact-sheet.png")
PY
```
- [ ] **Step 3:** Просмотреть каждый из 120 PNG, а не только контактные листы.
- [ ] **Step 4:** Зафиксировать дефекты по категориям: обрезание, перенос, плотность, повтор макета, слабый вывод, риск утверждения, нарушение анонимизации.
- [ ] **Step 5:** Исправить все дефекты и повторить экспорт и рендер.

## Task 8: Выполнить текстовую и доказательную проверку

- [ ] **Step 1:** Извлечь текст:

```bash
pdftotext "product/presentation/droid-gpt56/export-v5-premium/СтройИнтеллект_Коммерческое_предложение_V5.pdf" /tmp/v5-commercial.txt
pdftotext "product/presentation/droid-gpt56/export-v5-premium/СтройИнтеллект_Кейсбук_V5.pdf" /tmp/v5-casebook.txt
pdftotext "product/presentation/droid-gpt56/export-v5-premium/СтройИнтеллект_Руководство_продаж_V5.pdf" /tmp/v5-sales.txt
```

- [ ] **Step 2:** Проверить обязательные и запрещённые формулировки:

```bash
python3 - <<'PY'
from pathlib import Path

texts = {
    "commercial": Path("/tmp/v5-commercial.txt").read_text(encoding="utf-8"),
    "casebook": Path("/tmp/v5-casebook.txt").read_text(encoding="utf-8"),
    "sales": Path("/tmp/v5-sales.txt").read_text(encoding="utf-8"),
}
commercial_required = ["от 20 млн", "НДС 22%", "целевой критерий", "решение"]
for phrase in commercial_required:
    assert phrase.lower() in texts["commercial"].lower(), phrase

forbidden = [
    "250+",
    "гарантированная экономия",
    "заменяет службу технического заказчика",
    "не ошибается",
    "полный анализ за часы",
]
for name, text in texts.items():
    for phrase in forbidden:
        assert phrase.lower() not in text.lower(), (name, phrase)

for name in ["commercial", "casebook"]:
    for phrase in ["АПРИ", "StorHaus"]:
        assert phrase.lower() not in texts[name].lower(), (name, phrase)
print("OK: claim checks")
PY
```
- [ ] **Step 3:** Проверить отсутствие `АПРИ`, `StorHaus`, названий закрытых объектов и компаний в клиентских PDF.
- [ ] **Step 4:** Проверить, что `250+` отсутствует во всех трёх файлах.
- [ ] **Step 5:** Проверить, что цена `от 20 млн ₽` сопровождается `НДС 22%` и коммерческими границами.

## Task 9: Финальная приёмка

- [ ] **Step 1:** Повторно проверить 44/36/40 страниц и формат 16:9.
- [ ] **Step 2:** Убедиться, что V3 и V4 не изменены.
- [ ] **Step 3:** Рассчитать SHA-256:

```bash
sha256sum \
  "tmp/stroyintellekt-commercial-premium-v5.pptx.html" \
  "tmp/stroyintellekt-casebook-premium-v5.pptx.html" \
  "tmp/stroyintellekt-sales-playbook-premium-v5.pptx.html" \
  product/presentation/droid-gpt56/export-v5-premium/*.pdf
```

- [ ] **Step 4:** Выполнить `git diff --check`.
- [ ] **Step 5:** Не делать commit или push.

## Критерий завершения

- Три источника PowerPoint существуют и открываются в Factory.
- Три PDF имеют 44, 36 и 40 страниц.
- Каждый из 120 слайдов просмотрен отдельно.
- Нет запрещённых утверждений и раскрытия закрытых данных.
- Коммерческая презентация объясняет решение и инвестицию.
- Кейсбук доказывает метод, не обещая результат.
- Руководство продаж позволяет воспроизводимо вести корпоративную сделку.
