/**
 * Сквозные проверки договорных экранов §5.5 — гейт §27.1.
 *
 * ЧТО ЗДЕСЬ НЕ ПРОВЕРЯЕТСЯ
 *
 * «Страница открывается». Двухсотый ответ ничего не доказывает: отказ по праву
 * тоже двухсотый, и пустой список тоже. Проверяются утверждения, ради которых
 * экраны и сделаны:
 *
 *  · гость получает ОТКАЗ с названием недостающего права, а не пустой список;
 *  · пользователь без `audit:read` получает отказ на журнале, а не пустой журнал;
 *  · ссылка ведёт туда, куда обещает, — недостижимый экран равен отсутствующему;
 *  · заблокированный шаг называет последствие нарушения;
 *  · несопоставленное предложение названо поимённо и не попало в разброс;
 *  · ни один статус не выражен одним цветом — у каждого есть слово;
 *  · договорный путь проходится с клавиатуры.
 *
 * ДАННЫЕ
 *
 * Набор рассчитывает на контур, поднятый `pnpm demo:up`. Если его нет, тесты
 * падают с внятным сообщением, а не молча пропускаются: пропуск, о котором не
 * сказано, — это зелёная сборка, ничего не проверившая.
 */
import JSZip from "jszip";

import { expect, test, type Page } from "@playwright/test";

import { ADMIN, signIn, USER } from "./support/auth.js";

const OBJECT = "KRG-1";

/**
 * Довести фокус табуляцией до ссылки, отвечающей условию, и вернуть её адрес.
 *
 * Бюджет шагов задан щедро и НЕ является утверждением о качестве: WCAG числа
 * остановок не ограничивает, а сама остановка у прокручиваемой области —
 * требование 2.1.1, а не лишняя. Ограничение здесь только затем, чтобы набор
 * не крутился вечно, если ссылки нет вовсе.
 */
async function табуляциейДо(
  page: Page,
  подходит: (href: string) => boolean,
  что: string,
): Promise<string> {
  const БЮДЖЕТ = 60;

  for (let шаг = 0; шаг < БЮДЖЕТ; шаг += 1) {
    await page.keyboard.press("Tab");

    // Через локатор `:focus`, а не через `document` в `evaluate`: у проекта в
    // `lib` нет DOM, и типы браузера сюда не завозятся ради одной строки.
    const href = await page.locator(":focus").getAttribute("href").catch(() => null);

    if (href !== null && подходит(href)) return href;
  }

  throw new Error(`${что}: ссылка недостижима табуляцией за ${БЮДЖЕТ} шагов`);
}

/**
 * Выбрать объект в шапке.
 *
 * Пустая строка снимает выбор. Помощник нужен потому, что объектные разделы
 * рельса без выбранного объекта ссылками не являются вовсе, и набор, не
 * выбравший объект, проверял бы совсем другое состояние.
 */
async function chooseObject(page: Page, code: string): Promise<void> {
  const select = page.locator(".topbar__object-select");
  if ((await select.count()) === 0) return;

  await select.selectOption(code);
  await page.getByRole("button", { name: "Выбрать объект" }).click();

  /**
   * ЧИТАЕМ ТО, ЧТО ОТДАЛ СЕРВЕР, А НЕ ТО, ЧТО ПОСТАВИЛ БРАУЗЕР.
   *
   * Стояло `expect(select).toHaveValue(code)` сразу после нажатия — и это
   * проверка браузера самому себе: `selectOption` уже записал значение в DOM,
   * утверждение проходило мгновенно, ещё до того, как серверное действие
   * поставило куку. Набор шёл дальше и работал на экране, где выбора нет.
   *
   * Перезагрузка стоит доли секунды на собранном приложении и делает
   * утверждение честным: значение приходит из разметки сервера.
   */
  await page.waitForLoadState("load");

  /**
   * Перезагрузка с повтором, а не одна.
   *
   * Серверное действие перерисовывает раскладку и перенаправляет; одиночная
   * перезагрузка иногда обгоняла его и читала страницу без куки — набор падал
   * через раз, и падал не на дефекте. Повтор ждёт, пока сервер ответит с
   * выбором, и это по-прежнему утверждение о СЕРВЕРЕ, а не о поле формы.
   */
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.locator(".topbar__object-select").inputValue();
      },
      { timeout: 15_000, message: "серверное действие не сохранило выбор объекта" },
    )
    .toBe(code);
}

/**
 * Открывает доску по прогону, У КОТОРОГО ЕСТЬ АРТЕФАКТ.
 *
 * ПОЧЕМУ НЕ ПРОСТО `/agents`. Умолчание доски — идущий прогон, и это верно:
 * пока проверка идёт, спрашивают про неё. Но предмет проверок ниже — не выбор
 * прогона, а содержание доски: сходится ли сумма по плиткам с артефактом,
 * отличён ли «не работал» от «замечаний не нашёл».
 *
 * Набор сам ставит живые прогоны проверками загрузки, и обе проверки падали
 * не на своём предмете, а на том, что доска показала идущий прогон. Гейт,
 * зелёный или красный в зависимости от порядка проверок, ничего не гейтит
 * (грабля №5: гейт на данные вместо гейта на механизм).
 *
 * Прогон с артефактом берётся оттуда же, откуда его берёт заказчик, — из
 * вкладки «Пакет»: она перенаправляет именно на такой прогон.
 */
async function доскаСАртефактом(page: Page): Promise<void> {
  await page.goto(`/objects/${OBJECT}/package`);
  await page.waitForURL(/\/checks\/[^/]+\/package$/);

  const прогон = /\/checks\/([^/]+)\//.exec(page.url())?.[1] ?? "";
  expect(прогон, "у объекта нет прогона с артефактом — доску проверять не на чем").not.toBe("");

  await page.goto(`/objects/${OBJECT}/agents?прогон=${прогон}`);
}

/**
 * Развернуть рельс разделов, если он свёрнут.
 *
 * На узком экране рельс — закрытое `<details>`, и его пункты остаются в
 * разметке, но невидимы. Два набора это уже поймали: они читали текст у скрытых
 * узлов и получали пустые строки, то есть жаловались на отсутствие слова там,
 * где слово есть.
 *
 * Разворот, а не пропуск проверки на мобильном: пользователь телефона обязан
 * получить те же поводы, что и пользователь монитора, — значит проверять надо
 * на обоих, приведя рельс в то состояние, в котором его видят.
 */
async function openRail(page: Page): Promise<void> {
  const summary = page.locator(".rail__drawer-summary");

  if (await summary.isVisible()) {
    await summary.click();
    await expect(page.locator(".rail__nav .rail__item-label").first()).toBeVisible();
  }
}

test.describe("доступ", () => {
  test("гость получает отказ с названием права, а не пустой список", async ({ page }) => {
    await page.goto("/objects");

    await expect(page.getByText("Доступ закрыт")).toBeVisible();
    // Право названо: без него отказ не подсказывает, что просить у администратора.
    await expect(page.getByText("check:read")).toBeVisible();
    // И это именно отказ, а не пустая таблица.
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("пользователь без права видит отказ на журнале, а не пустой журнал", async ({ page }) => {
    await signIn(page, USER);
    await page.goto("/journal");

    await expect(page.getByText("Доступ закрыт")).toBeVisible();
    // Право названо ОТДЕЛЬНОЙ строкой, а не только внутри причины: причина
    // приходит от решения о доступе и не обязана называть право («вы не
    // вошли»), а человеку нужно знать, что просить у администратора.
    await expect(page.getByText("право: audit:read")).toBeVisible();
    // Пустой журнал читался бы как «событий не было» — утверждение о системе,
    // тогда как это утверждение о правах смотрящего.
    await expect(page.getByText("Записей нет")).toHaveCount(0);
  });

  test("администратор журнал видит", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto("/journal");

    await expect(page.getByRole("heading", { name: "Журнал" })).toBeVisible();
    await expect(page.getByText("Доступ закрыт")).toHaveCount(0);
  });
});

test.describe("сквозной путь", () => {
  test("реестр → карточка объекта → рабочий экран Проверки", async ({ page }) => {
    await signIn(page, USER);
    // Вход ведёт на Пульт, а не в реестр (`Ф-112`). Набор ждал заголовка
    // реестра сразу после входа и падал на исправном интерфейсе: проверка
    // отстала от экрана, а не экран от проверки.
    await page.goto("/objects");

    await expect(page.getByRole("heading", { name: "Реестр объектов" })).toBeVisible();

    /**
     * Объект ищется ПО ШИФРУ, а не по имени.
     *
     * Здесь стояло `getByRole("link", { name: /Зауралье/ })`, и гейт покраснел,
     * как только в контуре завёлся второй объект с «Зауралье» в имени: строгий
     * режим нашёл три ссылки. Имя объекта задаёт человек и может повторяться —
     * шифр уникален, он же стоит в адресе.
     */
    const objectLink = page.locator(`main a[href="/objects/${OBJECT}"]`).first();
    await expect(objectLink, "объект из demo:up не найден — поднимите контур").toBeVisible();
    await objectLink.click();

    await page.waitForURL(`**/objects/${OBJECT}`);
    // Заголовок — имя ЭТОГО объекта, каким его завёл `demo:up`.
    await expect(page.locator("main h1").first()).toBeVisible();

    // История проверок ведёт на рабочий экран: недостижимый экран не отличается
    // от отсутствующего.
    const checkLink = page.getByRole("link", { name: "full-check" }).first();
    await expect(checkLink).toBeVisible();
    await checkLink.click();

    await page.waitForURL(/\/checks\//);
    await expect(page.getByText("такт-0")).toBeVisible();
  });

  test("заблокированный шаг называет последствие нарушения", async ({ page }) => {
    await signIn(page, USER);
    await page.goto(`/objects/${OBJECT}`);
    await page.getByRole("link", { name: "full-check" }).first().click();
    await page.waitForURL(/\/checks\//);

    /**
     * Метка ШАГА, а не слово «заблокирован» где угодно на странице.
     *
     * `getByText("заблокирован")` ловил и текст замечания, в котором агент
     * употребил это слово, — а такие замечания лежат в свёрнутой группе и
     * невидимы. Проверка падала на видимости чужого элемента, сообщая о
     * шаговике то, чего про него не знала: гейт на ДАННЫЕ вместо гейта на
     * механизм, и данные тут пишет модель.
     */
    const метка = page.locator(".pill--loud", { hasText: "заблокирован" }).first();
    await expect(метка, "ни один шаг не помечен заблокированным").toBeVisible();

    // Отказ без цены ошибки человек обходит; отказ с ценой — обдумывает.
    await expect(page.getByText(/последствие нарушения/).first()).toBeVisible();
  });

  test("несопоставленное предложение названо поимённо и не вошло в разброс", async ({ page }) => {
    await signIn(page, USER);

    /**
     * Сравнение открывается со СВОЕГО экрана, а не выкапывается из истории.
     *
     * Первая версия искала ссылку `compare-offers` на карточке объекта. Она
     * перестала работать, как только история прогонов получила разбивку по
     * двенадцать: расчёт сравнения — самый старый прогон по объекту, и он уехал
     * на вторую страницу. Проверка падала на обоих устройствах при полностью
     * исправном расчёте.
     *
     * Это не обход разбивки, а исправление адресата: экран
     * `/objects/<шифр>/offers` заведён ровно затем, чтобы сравнение не надо
     * было искать в истории прогонов.
     */
    await page.goto(`/objects/${OBJECT}/offers`);

    await expect(page.getByText("В расчёт разброса не вошли:").first()).toBeVisible();
    // Поимённо: «в расчёт не вошли двое» не позволяет проверить, кто и почему.
    await expect(page.getByText(/Нейва \(позиция в предложении отсутствует\)/)).toBeVisible();
  });
});

test.describe("запись из веба", () => {
  /**
   * Только на одном устройстве, и это не экономия времени.
   *
   * Сценарий МУТИРУЕТ общий демо-объект, а повтором постановки считается ЖИВАЯ
   * задача: второй прогон получил бы «по этому объекту уже есть живая Проверка»
   * и не нашёл бы живой задачи для отмены. Тест, зависящий от того, кто пробежал
   * первым, — не тест, а лотерея.
   *
   * Формулировка «идемпотентна в пределах суток» стояла здесь и была неверной
   * ровно так же, как сообщение на экране (`Ф-73`): правило суток отброшено
   * давно. Комментарий к тесту — тоже утверждение о поведении, и расходясь с
   * ним, он врёт.
   *
   * Мобильное покрытие здесь ничего не добавляет: маршрут от устройства не
   * зависит, а раскладку проверяют остальные сценарии на обоих.
   */
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "сценарий меняет общее состояние: выполняется один раз");
  });

  test("Проверка ставится, отменяется, а повторная отмена отказывает с причиной", async ({ page }) => {
    await signIn(page, USER);

    // Прогон запускается ПО ПАРТИИ, и кнопка живёт там, где партии видно.
    // Прежде она стояла на карточке объекта рядом с полем «папка объекта», куда
    // руками вписывали путь к каталогу сервера; поля больше нет.
    await page.goto(`/objects/${OBJECT}/upload`);

    const batch = page.locator("main table tbody tr").first();
    await expect(batch, "по объекту нет ни одной партии — запускать прогон не с чего").toBeVisible();
    await batch.getByRole("button", { name: "Проверить" }).click();

    // Ждём СОДЕРЖИМОЕ, а не адрес: параметр кириллический и в URL уезжает
    // percent-кодированным — регулярное выражение по нему проверяло бы кодировку,
    // а не поведение.
    await expect(page.getByText("Постановка в очередь")).toBeVisible();

    // Рассчитано на контур без запущенного воркера (`demo:up` его не поднимает).
    // Если задача успела выполниться, кнопки не будет — тест скажет об этом прямо.
    const cancelForm = page.locator('form[action="/api/checks/cancel"]').first();
    await expect(cancelForm, "нет живой задачи: воркер успел её выполнить — остановите его").toBeVisible();

    const jobId = await cancelForm.locator('input[name="jobId"]').inputValue();
    await cancelForm.getByRole("button", { name: "Отменить" }).click();

    await expect(page.getByText("Задача отменена")).toBeVisible();

    // Повтор той же отмены обязан отказать: отмена сделанного — не отмена, а
    // переписывание истории. Через запрос, а не кнопкой: кнопки у мёртвой
    // задачи уже нет, и это правильно.
    // `Origin` проставляется явно: `page.request` — не браузерная навигация и
    // заголовка не шлёт, а без него рубеж CSRF (справедливо) отвечает 403.
    // Здесь проверяется отмена, а не CSRF: у того свой сценарий ниже.
    const repeat = await page.request.post("/api/checks/cancel", {
      form: { jobId, objectCode: OBJECT },
      headers: { origin: "http://127.0.0.1:3000" },
      maxRedirects: 0,
    });

    expect(repeat.status()).toBe(303);

    // Через `searchParams`, а не поиском подстроки в адресе: в query пробел
    // кодируется плюсом, и `decodeURIComponent` его пробелом не сделает —
    // проверка сравнивала бы кодировку, а не смысл.
    const location = new URL(repeat.headers()["location"] ?? "");
    expect(location.searchParams.get("отмена")).toBe("нет");
    expect(location.searchParams.get("причина")).toContain("отменять нечего");
  });

  test("мутация без заголовка источника отклоняется", async ({ page }) => {
    await signIn(page, USER);

    // CSRF: браузер проставляет `Origin` сам, поэтому подделать его со
    // стороннего сайта нельзя, а запрос вовсе без него пришёл не из браузера.
    const response = await page.request.post("http://127.0.0.1:3000/api/checks/cancel", {
      form: { jobId: "00000000-0000-0000-0000-000000000000", objectCode: OBJECT },
      headers: { origin: "http://example.invalid", referer: "http://example.invalid/" },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(403);
  });
});

test.describe("инварианты интерфейса", () => {
  test("ни один статус не выражен одним цветом", async ({ page }) => {
    await signIn(page, USER);
    await page.goto(`/objects/${OBJECT}`);
    // Рельс тоже несёт статусы — двадцать пять штук, и на узком экране они
    // свёрнуты. Проверять надо всё, что пользователь увидит, включая их.
    await openRail(page);

    const pills = page.locator(".pill");
    const count = await pills.count();
    expect(count, "на карточке объекта нет ни одного статуса — проверять нечего").toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const pill = pills.nth(index);
      const text = (await pill.innerText()).trim();
      expect(text, `статус №${index + 1} не несёт слова: цвет остался единственным сигналом`).not.toBe("");
    }
  });

  test("договорный путь проходится с клавиатуры", async ({ page }) => {
    /**
     * ПУТЬ, А НЕ КОНКРЕТНЫЙ ОБЪЕКТ.
     *
     * Здесь искалась ссылка ровно на `KRG-1`, и держалось это на том, что
     * Пульт показывал САМЫЙ СТАРЫЙ объект контура. Как только Пульт стал вести
     * к объекту показанного прогона (а он и должен), гейт покраснел — при
     * полностью проходимом с клавиатуры пути. То есть проверялись ДАННЫЕ, а не
     * механизм: «грабли №5» из передачи контекста.
     *
     * Путь по существу такой: вошёл → рельс → реестр → карточка объекта.
     * Именно он и проверяется, и какой объект в реестре первый — неважно.
     */
    await signIn(page, USER);

    // Шаг первый: из рельса в реестр. Мышь на договорном пути не обязательна
    // (WCAG 2.1 AA), поэтому и рельс проходится табуляцией.
    await табуляциейДо(page, (href) => href === "/objects", "реестр объектов");
    await page.keyboard.press("Enter");
    await page.waitForURL("**/objects");

    // Шаг второй: из реестра в карточку. Ссылка на САМ объект, а не любая,
    // содержащая его путь: рядом стоят адреса вида `/objects/<шифр>/documents`,
    // и Enter на них уводил бы не туда.
    const шифр = await табуляциейДо(
      page,
      (href) => /^\/objects\/[^/]+$/.test(href),
      "карточка объекта в реестре",
    );

    await page.keyboard.press("Enter");
    await page.waitForURL(`**${шифр}`);
    await expect(page.locator("h1").first(), `карточка ${шифр} открылась без заголовка`).toBeVisible();
  });
});

/**
 * Каркас приложения.
 *
 * ЧТО ИМЕННО ЗДЕСЬ ГЕЙТ
 *
 * Не «сайдбар отрисовался». Правило, которое приложение однажды уже нарушило:
 * ГЛАВНАЯ ПРЕДЛАГАЛА ЭКРАНЫ, КОТОРЫХ НЕ БЫЛО, и обе ссылки давали 404. Теперь
 * разделов двадцать шесть, из них открывается пять — то есть поводов повторить
 * ту ошибку стало в десять раз больше, и проверять её должна машина.
 *
 * Три утверждения:
 *
 *  · всё, что рельс предлагает ссылкой, действительно открывается;
 *  · всё, что не открывается, ссылкой НЕ ПРИТВОРЯЕТСЯ и называет повод;
 *  · рельс и оглавление перечисляют одно и то же — иначе перечни разойдутся.
 */
test.describe("каркас приложения", () => {
  test("каждый раздел, предложенный ссылкой, открывается", async ({ page }) => {
    // Ссылок в рельсе стало семь (добавились Пульт и карта), и каждый первый
    // заход в маршрут сервер разработки компилирует. Тридцати секунд перестало
    // хватать — падение было бы про время, а не про мёртвую ссылку.
    test.setTimeout(90_000);

    await signIn(page, ADMIN);

    await openRail(page);

    const links = page.locator(".rail__nav a.rail__item");
    const count = await links.count();
    expect(count, "в рельсе нет ни одной ссылки — проверять нечего").toBeGreaterThan(3);

    const targets: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const href = await links.nth(index).getAttribute("href");
      if (href !== null && !targets.includes(href)) targets.push(href);
    }

    for (const href of targets) {
      const response = await page.goto(href);
      expect(response?.status(), `раздел ${href} предложен ссылкой и не открылся`).toBeLessThan(400);
      // Не только код ответа: страница обязана иметь заголовок. Пустая
      // двухсотая страница — тот же обман, что 404, только тише.
      await expect(page.locator("h1").first(), `у раздела ${href} нет заголовка`).toBeVisible();
    }
  });

  test("неготовый раздел не является ссылкой и называет повод", async ({ page }) => {
    await signIn(page, ADMIN);

    await openRail(page);

    const off = page.locator(".rail__nav .rail__item--off");
    const count = await off.count();
    expect(count, "неготовых разделов нет — правило проверять нечем").toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const item = off.nth(index);
      const label = (await item.innerText()).trim();

      // Ссылкой не притворяется: ни сам элемент, ни что-либо внутри него.
      expect(await item.evaluate((node) => node.tagName), `раздел «${label}» отрисован ссылкой`).not.toBe("A");
      expect(await item.locator("a").count(), `внутри раздела «${label}» есть ссылка`).toBe(0);

      // И называет повод: без повода «пока нельзя» читается как поломка.
      const reason = (await item.getAttribute("title")) ?? "";
      expect(reason.length, `раздел «${label}» не назвал повод, по которому не открывается`).toBeGreaterThan(10);
    }
  });

  test("рельс и оглавление перечисляют одни и те же разделы", async ({ page }) => {
    await signIn(page, ADMIN);
    // Карта переехала с главной на свой экран: главная стала Пультом, то есть
    // сводкой по объекту, а не перечнем разделов.
    await page.goto("/map");
    await openRail(page);

    const rail = (await page.locator(".rail__nav .rail__item-label").allInnerTexts()).map((text) => text.trim()).sort();
    const index = (await page.locator("main .cell-title").allInnerTexts()).map((text) => text.trim()).sort();

    // Оглавление показывает ещё и решённо не строящееся, поэтому рельс обязан
    // быть его ПОДМНОЖЕСТВОМ, а не совпадать с ним.
    const missing = rail.filter((label) => !index.includes(label));
    expect(missing, "рельс предлагает разделы, которых нет в оглавлении: перечни разошлись").toEqual([]);
    expect(index.length, "в оглавлении разделов меньше, чем в рельсе").toBeGreaterThanOrEqual(rail.length);
  });
});

/**
 * Загрузка и разбор — экран §5.5 (3), поверхность `S-03`.
 *
 * ЧТО ИМЕННО ЗДЕСЬ ГЕЙТ
 *
 * Не «таблица отрисовалась». Этот экран — ЕДИНСТВЕННЫЙ, где инвариант §12.1д
 * выполняется без оговорок: у каждой позиции есть `sourceRow`, строка исходного
 * листа, и раскрытие показывает именно её, а не выведенное происхождение.
 * Поэтому проверяется именно раскрытие, а не наличие строк.
 *
 * Плюс два утверждения, которые легко потерять правкой разметки:
 *
 *  · страница нарезается по 50 строк, а сводка считается по ВСЕЙ версии —
 *    «без шифра 2» это про смету, а не про показанную страницу;
 *  · несопоставленная позиция названа словом, а не пустой ячейкой.
 */
test.describe("загрузка и разбор", () => {
  test("версия открывается из документов, и позиции несут строку исходного листа", async ({ page }) => {
    await signIn(page, USER);
    await page.goto(`/objects/${OBJECT}/documents`);

    /**
     * Ревизия берётся у документа С ПОЗИЦИЯМИ, а не первая попавшаяся.
     *
     * С тех пор как в реестр попадает весь комплект, первой строкой может
     * оказаться подшивка РД: у неё позиций нет по существу, и гейт падал бы на
     * исправном экране. Предмет проверки — происхождение позиции, значит нужна
     * версия, у которой позиции есть.
     */
    const revision = page
      .locator("tbody tr")
      .filter({ hasNotText: "строк нет" })
      .getByRole("link", { name: /№\d+/ })
      .first();
    await expect(revision, "на экране документов нет ни одной ревизии с позициями").toBeVisible();
    await revision.click();
    await page.waitForURL(/\/documents\/[0-9a-f-]{36}/);

    const rows = page.locator("tbody tr");
    const shown = await rows.count();
    expect(shown, "версия открылась без позиций — проверять происхождение нечем").toBeGreaterThan(0);
    expect(shown, "показано больше страницы: нарезка по 50 строк не сработала").toBeLessThanOrEqual(50);

    // РАСКРЫТИЕ ПРОИСХОЖДЕНИЯ. `<details>`, а не подсказка: подсказку нельзя ни
    // выделить, ни прочитать с клавиатуры.
    const disclosure = rows.first().locator("details.disclosure");
    await expect(disclosure, "у позиции нет раскрытия происхождения").toBeVisible();
    await disclosure.locator("summary").click();

    const opened = await disclosure.innerText();
    expect(opened, "раскрытие не назвало строку исходного листа").toContain("Строка листа");
    expect(opened, "раскрытие не назвало раздел").toContain("Раздел");
  });

  test("сводка считается по всей версии, а не по показанной странице", async ({ page }) => {
    await signIn(page, USER);
    await page.goto(`/objects/${OBJECT}/documents`);

    // Берётся версия с наибольшим числом позиций: только на ней страница
    // короче версии, а значит различие сводки и страницы вообще наблюдаемо.
    const counts = await page.locator("tbody tr").evaluateAll((rows) =>
      rows.map((row) => {
        const cells = row.querySelectorAll("td");
        return {
          href: cells[0]?.querySelector("a")?.getAttribute("href") ?? "",
          // «строк нет» вместо числа — у документа, из которого позиций не
          // извлекают (подшивка РД, сводный расчёт). `parseInt` даёт по нему
          // NaN, и такая строка всплывала наверх сортировки, ломая отбор.
          positions: Number.parseInt(cells[1]?.textContent?.trim() ?? "0", 10) || 0,
        };
      }),
    );

    const widest = counts.filter((row) => row.href !== "").sort((a, b) => b.positions - a.positions)[0];
    expect(widest, "среди версий нет ни одной со ссылкой").toBeDefined();
    expect(widest?.positions ?? 0, "ни в одной версии нет позиций").toBeGreaterThan(50);

    await page.goto(widest?.href ?? "");

    const shown = await page.locator("tbody tr").count();
    expect(shown, "страница обязана быть короче версии, иначе сравнивать нечего").toBe(50);

    // Заголовок экрана называет ВСЮ версию, а не страницу.
    await expect(
      page.getByText(`позиций ${widest?.positions ?? 0}`),
      "сводка посчитана по странице, а не по версии",
    ).toBeVisible();

    // И листалка это подтверждает своим текстом.
    await expect(page.getByText(new RegExp(`из ${widest?.positions ?? 0}`))).toBeVisible();
  });

  test("несопоставленная позиция названа словом, а не пустой ячейкой", async ({ page }) => {
    await signIn(page, USER);
    await page.goto(`/objects/${OBJECT}/documents`);

    // Нужна версия, в которой разбор нашёл не все шифры. Если таких нет, набор
    // не молчит: правило проверять не на чем, и это надо знать.
    const hrefs = await page
      .locator("tbody tr td:first-child a")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));

    for (const href of hrefs) {
      await page.goto(href);
      const badge = page.getByText(/без шифра \d+/);

      if (await badge.count() > 0) {
        await expect(badge.first()).toBeVisible();
        // Слово в ячейке, а не пустота: пустая ячейка читается как недосмотр
        // вёрстки, а «не сопоставлена» — как результат разбора.
        await expect(page.getByText("не сопоставлена").first()).toBeVisible();
        return;
      }
    }

    throw new Error("ни в одной версии нет позиций без шифра — правило проверять не на чем");
  });
});

/**
 * Правка извлечённого значения и подпись человека — ADR-R-019, §12.
 *
 * ЧТО ИМЕННО ЗДЕСЬ ГЕЙТ
 *
 * Три утверждения, и каждое из них — то, ради чего механизм ревизий заведён:
 *
 *  · правка НЕ ЗАТИРАЕТ разбор: в таблице остаётся прочитанное значение, а
 *    исправленное живёт ревизией рядом. Спор с подрядчиком идёт именно об этом;
 *  · подпись ставится под ПОКАЗАННЫМ значением: подтверждение по устаревшему
 *    хэшу отклоняется с названным поводом. Ложная подпись хуже отсутствия —
 *    отсутствие заметно, а подтверждённое выглядит проверенным;
 *  · повтор не переписывает первую подпись.
 *
 * НАБОР МЕНЯЕТ ОБЩЕЕ СОСТОЯНИЕ, поэтому идёт только на desktop: два прогона
 * подряд правили бы одну позицию и мешали друг другу.
 */
test.describe("правка и подтверждение", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "набор меняет общее состояние: два устройства правили бы одну позицию",
    );
  });

  test("правка ложится ревизией, а подпись требует того же хэша, что был показан", async ({ page }) => {
    // Минута, а не тридцать секунд по умолчанию, и это не «тест медленный».
    // Сценарий честно проходит весь тракт: вход, документы, версия, правка,
    // перезагрузка, отказ по устаревшему хэшу, подпись, ещё перезагрузка. Под
    // полным набором он в тридцать секунд не укладывался — и падал на таймауте,
    // то есть жаловался на дефект там, где было мало времени.
    test.setTimeout(60_000);

    await signIn(page, ADMIN);
    await page.goto(`/objects/${OBJECT}/documents`);

    // Берётся версия с наибольшим числом позиций: в ней точно есть что править.
    const hrefs = await page
      .locator("tbody tr td:first-child a")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    expect(hrefs.length, "нет ни одной версии — править нечего").toBeGreaterThan(0);

    // Позиция берётся ПОСЛЕДНЯЯ на странице: первые могли быть исправлены
    // предыдущими прогонами, и «ждёт подтверждения» на них уже стоит.
    await page.goto(hrefs[hrefs.length - 1] ?? "");

    const row = page.locator("tbody tr").last();
    const disclosure = row.locator("details.disclosure");
    await disclosure.locator("summary").click();

    const revise = disclosure.locator('form[action="/api/positions/revise"]');
    await expect(revise, "у администратора нет формы правки, хотя право на запись есть").toBeVisible();

    // Значение УНИКАЛЬНО ДЛЯ ПРОГОНА, и это не педантизм: ревизии
    // накапливаются, и постоянное «777777.77» на втором прогоне нашлось бы
    // дважды — набор упал бы на неоднозначности, а не на дефекте.
    const marker = `7${Date.now() % 100000}.77`;
    await revise.locator('input[name="value"]').fill(marker);
    await revise.locator('input[name="reason"]').fill(`проверка тракта правки ${marker}`);
    await revise.locator('button[type="submit"]').click();

    await expect(page.getByText("Правка сохранена ревизией")).toBeVisible();

    // РАЗБОР НЕ ЗАТЁРТ, и это сверяется с самим разбором, а не с тем, что было
    // на экране до правки.
    //
    // Первая версия проверки сравнивала ячейку «до» и «после» — и НЕ ЛОВИЛА
    // подмену: стоило таблице показывать последнюю правку, как оба замера
    // менялись согласованно, и равенство сохранялось. Утверждение «в таблице
    // разобранное значение» проверяется только сличением с ревизией «разбор».
    const after = page.locator("tbody tr").last();
    const cell = (await after.locator("td").nth(4).innerText()).trim();

    const opened = after.locator("details.disclosure");
    await opened.locator("summary").click();

    const parsedRevision = opened.locator("ol li").filter({ hasText: "разбор" }).first();
    const parsedValue = (await parsedRevision.innerText()).trim();

    expect(parsedValue, "в истории нет ревизии «разбор» — сличать не с чем").toContain("разбор");

    /**
     * СЛИЧАЮТСЯ ЧИСЛА, А НЕ НАПИСАНИЯ.
     *
     * В таблице сумма показана человеку — «7 965,04», с разрядкой и запятой; в
     * истории ревизий лежит машинная запись «7965.04». Сравнение строк начало
     * падать ровно тогда, когда таблицу привели к виду, в котором её читает
     * клиент, — то есть гейт держался не за свой предмет.
     *
     * Предмет остаётся прежним: в таблице ЗНАЧЕНИЕ РАЗБОРА, а не правка.
     */
    const машинное = (text: string): string => text.replace(/[\s\u00a0]/g, "").replace(",", ".");

    expect(
      parsedValue.includes(машинное(cell)),
      `в таблице ${cell}, а разбор прочитал другое: правка затёрла разобранное значение`,
    ).toBe(true);
    expect(машинное(cell), "в таблице оказалось исправленное значение, а не разобранное").not.toBe(marker);

    // И правка ждёт подписи — это то, что §12 блокирует.
    //
    // Поиск ограничен `main`: та же формулировка появилась в шапке каркаса как
    // индикатор по всему арендатору, и без ограничения проверка находила два
    // узла — то есть могла быть зелёной от шапки, ничего не сказав об экране.
    await expect(page.locator("main").getByText(/ждут подписи \d+/)).toBeVisible();

    await expect(opened.getByText(marker, { exact: false }).first()).toBeVisible();
    await expect(opened.getByText(`проверка тракта правки ${marker}`)).toBeVisible();

    // ПОДПИСЬ ПО УСТАРЕВШЕМУ ХЭШУ ОТКЛОНЯЕТСЯ.
    //
    // Проверяется через тот же обработчик, что и кнопка, но с подменённым
    // хэшем: скрытое поле формы `fill` не заполняет, а подмена его через
    // `evaluate` не выживала перерисовку — форма пересобиралась до нажатия, и
    // проверка утверждала отказ там, где отказа не было.
    //
    // Так честнее и по смыслу: «предмет изменился между показом и нажатием» —
    // это именно расхождение того, что ушло в запрос, с тем, что в базе.
    const confirm = opened.locator('form[action="/api/positions/confirm"]').last();
    await expect(confirm, "нет формы подтверждения у неподписанной правки").toBeVisible();

    const fields = async (): Promise<Record<string, string>> => {
      const entries = await confirm.locator("input[type=hidden]").evaluateAll((nodes) =>
        nodes.map((node) => [node.getAttribute("name") ?? "", node.getAttribute("value") ?? ""]),
      );
      return Object.fromEntries(entries) as Record<string, string>;
    };

    const honest = await fields();
    const origin = { origin: "http://127.0.0.1:3000", referer: "http://127.0.0.1:3000/" };

    const stale = await page.request.post("http://127.0.0.1:3000/api/positions/confirm", {
      form: { ...honest, contentHash: "0".repeat(64) },
      headers: origin,
      maxRedirects: 0,
    });

    const staleUrl = new URL(stale.headers()["location"] ?? "");
    expect(staleUrl.searchParams.get("подтверждение"), "подпись встала по устаревшему хэшу").toBe("нет");
    expect(staleUrl.searchParams.get("причина") ?? "").toContain("хэш предмета устарел");

    // А с настоящим хэшем подпись встаёт.
    const signedResponse = await page.request.post("http://127.0.0.1:3000/api/positions/confirm", {
      form: honest,
      headers: origin,
      maxRedirects: 0,
    });

    expect(new URL(signedResponse.headers()["location"] ?? "").searchParams.get("подтверждение")).toBe("да");

    // И подпись видна на экране — внутри раскрытия, а не только в базе.
    await page.reload();
    const signed = page.locator("tbody tr").last().locator("details.disclosure");
    await signed.locator("summary").click();
    await expect(signed.getByText(/подтвердил /).last()).toBeVisible();
  });

  /**
   * Правило «нет права — нет формы» проверяется на ГОСТЕ.
   *
   * Проверить его на вошедшем пользователе без `check:start` в этом контуре
   * НЕЛЬЗЯ: оба демо-пользователя это право имеют — `user@apri.ru` тем же
   * правом ставит Проверку в наборе «запись из веба». Первая версия набора
   * этого не учла и падала, утверждая дефект там, где его нет.
   *
   * Поэтому проверяется то, что проверяемо: гость не получает ни таблицы, ни
   * формы. Полное правило держится кодом (`canWrite` в разметке) и вернётся в
   * набор, когда в контуре появится роль только для чтения.
   */
  test("гость не получает ни таблицы позиций, ни формы правки", async ({ page }) => {
    await page.goto(`/objects/${OBJECT}/documents`);

    await expect(page.getByText("Доступ закрыт")).toBeVisible();
    await expect(page.getByRole("table"), "гостю показана таблица документов").toHaveCount(0);
    await expect(
      page.locator('form[action="/api/positions/revise"]'),
      "гостю отрисована форма правки",
    ).toHaveCount(0);
  });
});

/**
 * Пульт — первый экран.
 *
 * ЧТО ИМЕННО ЗДЕСЬ ГЕЙТ
 *
 * Экран собран из счётчиков артефакта и ведёт оттуда дальше — значит опасность
 * у него та же, что была у прежней главной: ПРЕДЛОЖИТЬ ТО, ЧЕГО НЕТ. Тогда две
 * ссылки давали 404; здесь ссылок больше, и каждая из них — обещание, что по
 * ней можно разобраться с названной проблемой.
 *
 * Второе утверждение — про честность чисел: экран обязан называть их
 * счётчиками артефакта, а не выдавать за расчёты. Это единственное, что мешает
 * прочитать «96 замечаний» как посчитанную сумму влияния.
 */
test.describe("пульт", () => {
  /**
   * ВЫСОТА ОБЛАСТИ ДАННЫХ БЕРЁТСЯ ОТ ЭКРАНА.
   *
   * Здесь стояло `max-height: 22rem` — 352 пикселя из головы. Набор сторожит не
   * конкретное число, а то, что число ВЫВОДИТСЯ: на низком экране область
   * обязана стать меньше. Проверять «ровно 42 %» значило бы переписать формулу
   * второй раз и получить два расходящихся определения одной величины.
   */
  test("высота списка следует за высотой экрана, а не за выдуманным числом", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, ADMIN);

    // Измеряется рамкой Playwright, а не `getBoundingClientRect`: в наборах нет
    // библиотеки DOM, и обращение к `window` здесь не типизируется. Заодно это
    // честнее — размер берётся у того же слоя, который его рисует.
    const listHeight = async (): Promise<number> => {
      await page.goto("/");
      const area = page.locator(".dash-scroll").first();
      await expect(area).toBeVisible();
      const box = await area.boundingBox();

      return Math.round(box?.height ?? 0);
    };

    await page.setViewportSize({ width: 1280, height: 900 });
    const tall = await listHeight();

    await page.setViewportSize({ width: 1280, height: 620 });
    const short = await listHeight();

    expect(tall, "области данных на пульте нет").toBeGreaterThan(0);
    expect(
      short,
      `на экране 620px область осталась ${short}px, как на 900px (${tall}px): высота не выведена из экрана`,
    ).toBeLessThan(tall);

    // И не выродилась: пол `clamp` обязан оставить видимыми несколько строк.
    expect(short, "на низком экране область сжалась до нечитаемого").toBeGreaterThan(180);

    /**
     * ПОТОЛОК ОБЩИЙ — И ЭТО НЕ ТО ЖЕ, ЧТО «ОДИНАКОВАЯ ВЫСОТА».
     *
     * Первая версия набора требовала равных высот и упала на 260 против 237.
     * Неверным было утверждение, а не код: `max-height` ОГРАНИЧИВАЕТ, но не
     * растягивает, и список из девяти гейтов законно ниже потолка. Растянуть
     * его до потолка значило бы добавить пустоты ради симметрии.
     *
     * Проверяется то, из-за чего виджеты и разъезжались: ни одна область не
     * выше потолка, а все переполненные упираются в ОДИН потолок.
     */
    const areas = (await page.evaluate(
      "[...document.querySelectorAll('.dash-scroll')].map((element) => ({ height: Math.round(element.getBoundingClientRect().height), overflows: element.scrollHeight > element.clientHeight + 1 }))",
    )) as readonly { readonly height: number; readonly overflows: boolean }[];

    const capped = areas.filter((area) => area.overflows).map((area) => area.height);

    expect(capped.length, "ни одна область не переполнена — потолок проверять нечем").toBeGreaterThan(0);
    expect(new Set(capped).size, `переполненные области упираются в разные потолки: ${capped.join(", ")}`).toBe(1);

    const ceiling = capped[0] ?? 0;

    for (const area of areas) {
      expect(area.height, `область ${area.height}px выше потолка ${ceiling}px`).toBeLessThanOrEqual(ceiling);
    }
  });

  test("важность помечена краем строки, а не точкой внутри неё", async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page, ADMIN);
    await page.goto("/");

    // Точка размером со знак препинания: её надо найти. Полоса по краю видна на
    // просмотре списка сбоку, без чтения.
    expect(await page.locator(".dash-attn__dot").count(), "важность снова помечена точкой").toBe(0);

    // Строка и `page.evaluate`, а не `locator.evaluateAll`: в наборах нет
    // библиотеки DOM, и `getComputedStyle` как выражение не типизируется, а
    // строковую форму `evaluateAll` не принимает — первая попытка получила
    // `undefined` вместо массива. Тот же приём уже применён в наборе
    // доступности для замера горизонтальной прокрутки.
    const edges = (await page.evaluate(
      "[...document.querySelectorAll('.dash-attn')].map((row) => { const style = getComputedStyle(row); return { color: style.borderLeftColor, width: Math.round(Number.parseFloat(style.borderLeftWidth)) }; })",
    )) as readonly { readonly color: string; readonly width: number }[];

    expect(edges.length, "строк с важностью на пульте нет").toBeGreaterThan(3);

    for (const edge of edges) {
      expect(edge.width, "у строки нет полосы по краю").toBeGreaterThan(0);
      expect(edge.color, "полоса прозрачна: тон не показан вовсе").not.toContain("rgba(0, 0, 0, 0)");
    }

    // Разные состояния обязаны различаться цветом края, иначе полоса —
    // украшение: пройденный гейт и непройденный выглядели бы одинаково.
    expect(
      new Set(edges.map((edge) => edge.color)).size,
      "все полосы одного цвета: край не различает состояния",
    ).toBeGreaterThan(1);
  });

  test("накопленное — плитками, а не строкой подзаголовка", async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page, ADMIN);
    await page.goto("/");

    await expect(page.locator(".dash-recap__cell")).toHaveCount(4);

    // У каждой плитки число и подпись: плитка без числа — рамка.
    for (const value of await page.locator(".dash-recap__value").allInnerTexts()) {
      expect(value.trim(), "плитка итогов без числа").toMatch(/^\d+$/);
    }

    await expect(page.getByText("Что накопилось")).toBeVisible();

    // Счётчики стояли шрифтом подписи вплотную друг к другу под заголовком —
    // прочитать их можно было только вглядываясь.
    const note = await page.locator("main header p").first().innerText();
    expect(note, `счётчики вернулись в подзаголовок: «${note}»`).not.toMatch(/позиций \d+/);
  });

  test("каждое решение ведёт на существующий экран", async ({ page }) => {
    // Обход всех ссылок пульта — это десяток переходов по серверу разработки,
    // где первый заход в маршрут компилируется. Тридцати секунд не хватает, и
    // падение было бы про время, а не про мёртвую ссылку.
    test.setTimeout(90_000);

    await signIn(page, ADMIN);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Пульт" })).toBeVisible();

    // Ссылки берутся из области содержания, а не со всей страницы: рельс уже
    // проверен своим набором, и мешать их значило бы проверять дважды одно.
    const targets = await page
      .locator("main a[href^='/']")
      .evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute("href") ?? ""))]);

    expect(targets.length, "на пульте нет ни одной ссылки — вести дальше нечем").toBeGreaterThan(2);

    for (const href of targets) {
      const response = await page.goto(href);
      expect(response?.status(), `пульт предлагает ${href}, и экран не открылся`).toBeLessThan(400);
      await expect(page.locator("h1").first(), `у экрана ${href} нет заголовка`).toBeVisible();
    }
  });

  test("числа названы счётчиками артефакта, а не расчётами", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto("/");

    // Без этой оговорки «96 замечаний» читается как посчитанная величина, у
    // которой можно спросить след формулы. Спросить его не у чего.
    await expect(page.getByText(/счётчики артефакта/)).toBeVisible();
    await expect(page.getByText(/следа формулы у них нет/)).toBeVisible();

    // Порядок «вердикт до чисел» гейтом НЕ проверяется, и это осознанно.
    // Первая версия сравнивала координаты двух элементов и падала, потому что
    // подстрочный поиск текста находил не тот узел. Порядок блоков виден в
    // разметке страницы и меняется только вместе с ней; проверка же на
    // координатах ломается от любой правки вёрстки и учит не тому — обходить
    // набор, а не держать порядок.
  });
});

/**
 * Отбор, свёрнутость и поиск — три органа управления каркаса.
 *
 * ЧТО ИМЕННО ЗДЕСЬ ГЕЙТ
 *
 * У всех трёх есть свойство, которое ломается тихо: они работают на СЕРВЕРЕ, а
 * ощущаются как клиентские. Свёрнутость уже дважды ломалась именно так —
 * состояние считалось верно, а показывалось прежнее, — и оба раза это заметил
 * глаз, а не набор. Поэтому проверяется не наличие кнопки, а РЕЗУЛЬТАТ:
 *
 *  · отбор УМЕНЬШАЕТ список и не молчит о том, сколько осталось;
 *  · неизвестное значение отбора даёт утверждение об отборе, а не о системе;
 *  · нажатие на свёртку меняет состояние с одного раза и переживает переход;
 *  · поиск находит объект по шифру, то есть ищет, а не изображает поиск.
 */
test.describe("органы управления каркаса", () => {
  test("отбор журнала уменьшает список и называет остаток", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto("/journal");

    const all = page.locator(".filters__chip").first();
    await expect(all, "на журнале нет пилюль отбора").toBeVisible();

    // Берём НЕ самую частую пилюлю: отбор по самому частому действию почти не
    // уменьшил бы список, и проверка прошла бы, ничего не проверив.
    const chips = page.locator(".filters__group").first().locator(".filters__chip");
    const total = await chips.count();
    expect(total, "значений отбора меньше двух — отбирать нечем").toBeGreaterThan(2);

    const rows = () => page.locator("main table tbody tr");
    const before = await rows().count();

    const chosen = chips.nth(total - 1);
    const label = (await chosen.innerText()).trim();
    await chosen.click();

    // Отмеченной остаётся ОДНА пилюля в своей группе, а не одна на экране:
    // вторая группа продолжает стоять на «все», и это правильно — отбор по
    // действию не отменяет отбор по предмету.
    await expect(page.locator(".filters__group").first().locator(".filters__chip--on")).toHaveCount(1);
    await expect(chosen).toHaveClass(/filters__chip--on/);
    const after = await rows().count();
    expect(after, `отбор «${label}» не уменьшил список: ${before} → ${after}`).toBeLessThan(before);
    expect(after, `отбор «${label}» оставил пустой список — выбрано значение без событий`).toBeGreaterThan(0);

    // Остаток назван числом, а не оставлен на догадку.
    // Число идёт с разрядкой («4 440 записей»), и `\\d+` её не покрывает:
    // разделитель — неразрывный пробел.
    await expect(page.getByText(/из [\d\s\u00a0]+ (?:записей|записи|запись)|показаны последние/)).toBeVisible();

    // И снимается ссылкой, а не кнопкой «назад».
    await page.getByRole("link", { name: "снять отбор" }).click();
    await expect(page.locator(".filters__chip--on")).toHaveCount(2);
    expect(await rows().count()).toBe(before);
  });

  test("неизвестное значение отбора — утверждение об отборе, а не о системе", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto(`/journal?${new URLSearchParams({ действие: "такого-действия-нет" }).toString()}`);

    // Пустая таблица без слов читалась бы как «событий не было» — утверждение о
    // системе. Здесь обязано стоять утверждение об отборе.
    await expect(page.getByText("Под отбор ничего не подошло")).toBeVisible();
    await expect(page.getByText(/всего записей/)).toBeVisible();
    // Ссылка ищется ВНУТРИ пустого состояния, а не по всей странице: у пилюль
    // отбора есть своя «снять отбор», и поиск по имени находил обе — то есть
    // проверка прошла бы и в случае, когда пустое состояние выхода не даёт.
    await expect(page.locator(".state").getByRole("link", { name: "Снять отбор" })).toBeVisible();
  });

  test("свёртка рельса срабатывает с одного нажатия и переживает переход", async ({ page }) => {
    // Настройка серверная (cookie), поэтому проверяется именно то, что дважды
    // ломалось: состояние после ОДНОГО нажатия и после перехода на другой экран.
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, ADMIN);

    const shell = page.locator(".shell");
    await expect(shell).not.toHaveClass(/shell--narrow/);

    await page.getByRole("button", { name: "Свернуть рельс" }).click();
    await expect(shell, "рельс не свернулся с первого нажатия").toHaveClass(/shell--narrow/);

    await page.goto("/journal");
    await expect(shell, "свёрнутость не дожила до другого экрана").toHaveClass(/shell--narrow/);

    // Названия скрыты, но иконки на месте: свёрнутый рельс остаётся навигацией.
    await expect(page.locator(".rail__nav a").first()).toBeVisible();

    await page.getByRole("button", { name: "Развернуть рельс" }).click();
    await expect(shell).not.toHaveClass(/shell--narrow/);
  });

  test("разделы рельса прокручиваются, а не уезжают под подвал", async ({ page }) => {
    // Замерено на живом экране: список набирал 1180 px при рельсе 901 px, и
    // «В разработке» лежал ПОД именем пользователя. Причина была не в
    // `overflow`, а в том, что колонке нечего было сжимать.
    await page.setViewportSize({ width: 1440, height: 760 });
    await signIn(page, ADMIN);
    await openRail(page);

    const nav = page.locator(".rail__nav");
    const footer = page.locator(".rail__footer");
    const navBox = await nav.boundingBox();
    const footerBox = await footer.boundingBox();

    expect(navBox, "в рельсе нет списка разделов").not.toBeNull();
    expect(footerBox, "в рельсе нет подвала с пользователем").not.toBeNull();

    const navBottom = Math.round((navBox?.y ?? 0) + (navBox?.height ?? 0));
    const footerTop = Math.round(footerBox?.y ?? 0);
    expect(navBottom, "список разделов заходит под подвал с пользователем").toBeLessThanOrEqual(footerTop);

    const scrolls = await nav.evaluate((node) => node.scrollHeight > node.clientHeight);
    expect(scrolls, "список разделов уместился целиком — прокрутку проверять нечем").toBe(true);
  });

  test("поиск в шапке находит объект по шифру", async ({ page }) => {
    await signIn(page, USER);

    await page.locator(".topbar__search input").fill(OBJECT);
    await page.keyboard.press("Enter");

    // Тридцать секунд, а не пять по умолчанию, и причина названа: `/search` —
    // отдельный маршрут, и в режиме разработки его первая сборка укладывается
    // в секунды только на спокойной машине. В полном прогоне на двух
    // устройствах переход не успевал, и набор сообщал `Received: ""` —
    // навигацию, которая ещё идёт. Это порог ожидания, а не дефект экрана.
    await page.waitForURL(/\/search\?/, { timeout: 30_000 });

    // Проверяется НАХОДКА, а не эхо запроса.
    //
    // Первая версия искала на экране текст `KRG-1` — и он там есть всегда,
    // потому что экран печатает сам запрос в заголовке «Поиск: KRG-1». Гейт был
    // зелёным при полностью сломанном отборе по шифру: проверено намеренной
    // поломкой, набор её не заметил. Теперь проверяется ссылка на экран объекта
    // — то есть результат, попасть в который эхо не может.
    await expect(page.locator(`main a[href="/objects/${OBJECT}"]`)).toBeVisible();
  });
});

/**
 * Загрузка документов — шаг 2 тракта, которого не было вовсе.
 *
 * ЧТО ИМЕННО ЗДЕСЬ ГЕЙТ
 *
 * До этой вехи файлы в систему попадали так: в поле на карточке объекта руками
 * вписывали путь к папке на сервере, и ядро читало эту папку. То есть браузер
 * выбирал, какой каталог файловой системы прочитать серверу, а демо было
 * невозможно — файлы нечем дать.
 *
 * Поэтому проверяется не «форма отправилась», а четыре утверждения:
 *
 *  · принятый файл действительно попадает в партию и виден в перечне;
 *  · файл, который система читать не умеет, отклонён и НАЗВАН поимённо —
 *    молча потерянный файл человек считает загруженным;
 *  · прогон идёт по партии, а не по пути: выдуманное имя партии даёт отказ;
 *  · произвольный путь через то же поле не проходит.
 */
test.describe("загрузка документов", () => {
  test("партия принимается, попадает в перечень и запускает прогон", async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page, ADMIN);
    await page.goto(`/objects/${OBJECT}/upload`);

    await page.locator("input[type=file]").setInputFiles([
      { name: "смета-набора.xlsx", mimeType: "application/vnd.ms-excel", buffer: Buffer.from("данные сметы") },
      { name: "чертёж-набора.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 набор") },
    ]);
    await page.getByRole("button", { name: "Загрузить" }).click();

    await expect(page.getByText(/Партия принята: 2 файла/)).toBeVisible();

    /**
     * Проверяется ПРИСУТСТВИЕ партии, а не прирост числа строк.
     *
     * Первая версия сравнивала `count()` до и после и ждала `before + 1`. Она
     * падала на обоих устройствах, как только партий стало больше двенадцати:
     * перечень разбит на страницы по двенадцать, и число строк перестало
     * расти — при полностью исправной загрузке. Мою же разбивку мой же тест и
     * не учёл.
     *
     * Имя партии берётся из адреса: обработчик кладёт его туда, чтобы экран
     * назвал её человеку, — и по нему же её можно найти в перечне.
     */
    const batch = new URL(page.url()).searchParams.get("партия") ?? "";
    expect(batch, "обработчик не назвал партию в адресе").not.toBe("");
    await expect(
      page.locator("main table tbody tr").filter({ hasText: batch }),
      "принятая партия не появилась в перечне",
    ).toHaveCount(1);

    // И по ЭТОЙ партии запускается прогон — то есть партия и есть предмет
    // действия, а не украшение перечня. Строка ищется по имени партии, а не
    // берётся первой: первой она стоит лишь пока перечень отсортирован так, а
    // тест, зависящий от порядка, проверяет порядок, а не прогон.
    await page
      .locator("main table tbody tr")
      .filter({ hasText: batch })
      .getByRole("button", { name: "Проверить" })
      .click();
    await expect(page).toHaveURL(new RegExp(`/objects/${OBJECT}`));
  });

  test("нечитаемый файл отклонён и назван поимённо", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto(`/objects/${OBJECT}/upload`);

    // Здесь стоял `архив.zip` с содержимым «PK» — как формат, который система
    // не принимает. С распаковкой архивов `.zip` стал принимаемым форматом, и
    // проверка перестала бы проверять то, ради чего написана. Взят чертёж:
    // `.dwg` не принимается и не будет — САПР вне объёма.
    await page.locator("input[type=file]").setInputFiles([
      { name: "смета-годная.xlsx", mimeType: "application/vnd.ms-excel", buffer: Buffer.from("данные") },
      { name: "чертёж.dwg", mimeType: "application/acad", buffer: Buffer.from("AC1024") },
    ]);
    await page.getByRole("button", { name: "Загрузить" }).click();

    // Один негодный файл не отменяет партию: шесть смет из семи терять
    // бессмысленно. Но и молчать о нём нельзя.
    await expect(page.getByText(/Партия принята: 1 файл(?!ов)/)).toBeVisible();
    await expect(page.getByText(/чертёж\.dwg/)).toBeVisible();
    await expect(page.getByText(/Не принято/)).toBeVisible();
  });

  /**
   * АРХИВ — ТИПОВОЙ ВХОД КЛИЕНТА, И ОН ПРОВЕРЯЕТСЯ ЦЕЛИКОМ ДО РАЗБОРА.
   *
   * По условию задачи клиент передаёт один ZIP с десятками смет и папками.
   * Набор проверяет всю цепочку: приём архива → распаковка → СОХРАНЕНИЕ
   * СТРУКТУРЫ → отказ по вложенному архиву с причиной. Без структуры теряется
   * ответ на «какой файл откуда появился», а он в задаче назван обязательным.
   */
  test("архив распаковывается, структура папок сохраняется", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, ADMIN);
    await page.goto(`/objects/${OBJECT}/upload`);

    const inner = new JSZip();
    inner.file("вложенная.xlsx", "данные");

    const zip = new JSZip();
    zip.file("Смета/Раздел 3/ЛСР-05.xlsx", "первая смета");
    zip.file("Смета/ССРСС.xlsx", "сводный расчёт");
    zip.file("РД/подшивка.pdf", "%PDF-1.4 подшивка");
    zip.file("резерв.zip", await inner.generateAsync({ type: "uint8array" }));

    await page.locator("input[type=file]").setInputFiles([
      {
        name: "комплект.zip",
        mimeType: "application/zip",
        buffer: Buffer.from(await zip.generateAsync({ type: "uint8array" })),
      },
    ]);
    await page.getByRole("button", { name: "Загрузить" }).click();

    // Три файла из архива приняты, четвёртый — вложенный архив — нет.
    await expect(page.getByText(/Партия принята: 3 файла/)).toBeVisible();
    await expect(page.getByText(/вложенный архив не распаковывается/)).toBeVisible();

    const batch = new URL(page.url()).searchParams.get("партия") ?? "";
    expect(batch, "обработчик не назвал партию в адресе").not.toBe("");

    const row = page.locator("main table tbody tr").filter({ hasText: batch });
    await expect(row, "партия из архива не появилась в перечне").toHaveCount(1);
    // Три файла — значит папки не посчитались файлами, а файлы в них не
    // потерялись. Плоская распаковка дала бы то же число, поэтому ниже
    // проверяется и путь.
    await expect(row).toContainText("3");

    /**
     * ПУТЬ ВНУТРИ АРХИВА ДОХОДИТ ДО ЭКРАНА.
     *
     * Первая версия этой строки была `.click().catch(() => undefined)` — то
     * есть не проверяла ничего и делала вид, что проверяет. Она же и обнажила
     * пробел: пути на экране не было вовсе, показать его было нечем, и я
     * замаскировал это вместо того, чтобы назвать.
     *
     * Состав партии показывается по ссылке из её строки, и путь в нём — тот же,
     * что был в архиве.
     */
    await row.getByRole("link", { name: "состав" }).click();
    await expect(page.getByText(/Состав партии/)).toBeVisible();
    await expect(page.getByText("Смета/Раздел 3/ЛСР-05.xlsx")).toBeVisible();
    await expect(page.getByText("РД/подшивка.pdf")).toBeVisible();
  });

  test("прогон не принимает путь вместо партии", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto("/objects");

    // Запрос делается из страницы, чтобы у него были честные заголовки
    // источника: проверяется отказ по партии, а не отказ по CSRF.
    const outcome = await page.evaluate(async (code) => {
      const attempt = async (body: Record<string, string>): Promise<number> => {
        const response = await fetch("/api/checks", {
          method: "POST",
          body: new URLSearchParams(body),
          redirect: "manual",
        });
        return response.status;
      };

      return {
        // Старое поле больше не действует.
        путь: await attempt({ objectCode: code, objectPath: "reference-system/input-1" }),
        // ОТНОСИТЕЛЬНЫЙ путь от корня контура, а не «../../..».
        //
        // Первая версия пробовала `../../../../reference-system/input-1` — и
        // проверка была бы зелёной при СНЯТОЙ защите: такого пути от рабочего
        // каталога сервера не существует, отказ приходил по причине «нет
        // каталога», а не «имя партии не путь». Проверено снятием защиты:
        // `../../..` по-прежнему давал 404, а вот это имя — 303.
        // Тот же класс ошибки, что `Ф-60`: гейт зелен не по той причине.
        обход: await attempt({ objectCode: code, партия: "reference-system/input-1" }),
        // И вложенный выход наверх — на случай другого рабочего каталога.
        выход: await attempt({ objectCode: code, партия: "../../../../etc" }),
        // Выдуманная партия.
        выдумка: await attempt({ objectCode: code, партия: "2000-01-01T00-00-00-000Z" }),
      };
    }, OBJECT);

    expect(outcome.путь, "поле «путь к папке» всё ещё принимается").toBe(400);
    expect(outcome.обход, "имя партии сработало как путь — каталог за пределами арендатора читается").toBe(404);
    expect(outcome.выход, "имя партии вывело за корень хранения").toBe(404);
    expect(outcome.выдумка, "прогон принял партию, которой нет").toBe(404);
  });
});

/**
 * Пакет заказчику — шаг 6 тракта и второй его разрыв.
 *
 * ЧТО ИМЕННО ЗДЕСЬ ГЕЙТ
 *
 * Ядро умело собирать книги, но забрать результат из браузера было нельзя ни
 * одним способом: маршрута скачивания не существовало, и демо обрывалось на
 * «прогон завершён».
 *
 * Проверяется не «страница отрисовалась», а четыре утверждения:
 *
 *  · строк ровно десять — состав пакета есть ОБЕЩАНИЕ по `output-1`, и молча
 *    уменьшиться на неудачном прогоне он не имеет права;
 *  · у каждой строки либо файл, либо НАЗВАННАЯ причина;
 *  · скачивание отдаёт настоящую книгу: тип, имя файла и непустое тело;
 *  · документ без агента отказывает с причиной, а не отдаёт пустой файл —
 *    пустая книга читается как результат.
 */
test.describe("пакет заказчику", () => {
  /**
   * Прогон С ОБЗОРОМ, а не первый в истории.
   *
   * Первая версия брала `full-check` первой ссылкой — то есть САМЫЙ СВЕЖИЙ
   * прогон. Свежий прогон в наборе ставят предыдущие проверки загрузки, и он
   * ещё идёт: агенты не высказались, пакет отдаёт 409, и гейт падал на обоих
   * устройствах, жалуясь на скачивание вместо того, чтобы жаловаться на выбор
   * прогона. Здесь берётся первый прогон, у которого ЕСТЬ вердикт: вердикт
   * означает артефакт, а артефакт — то, из чего собирается пакет.
   */
  /**
   * Открывает пакет ВКЛАДКОЙ, а не поиском вердикта в первой странице истории.
   *
   * ПОЧЕМУ ПЕРЕПИСАНО. Набор сканировал строки «Истории проверок» и искал
   * «принято». Это гейт на ДАННЫЕ, а не на механизм (грабля №5 передачи
   * контекста), и он свалился на настоящем контуре ровно так, как такие гейты
   * и валятся: у клиента накопилось тридцать восемь прогонов, первые двенадцать
   * строк — отменённые и стоящие в очереди, а прогон с вердиктом уехал на
   * вторую страницу. Набор сообщил «пакет собирать не из чего» — про объект, у
   * которого двадцать три прогона с артефактом.
   *
   * Вкладка «Пакет» — это и есть механизм выбора: она ведёт на пакет свежего
   * прогона, у которого есть что собирать. Проверять надо её.
   */
  async function openPackage(page: Page): Promise<string> {
    await page.goto(`/objects/${OBJECT}`);

    // Достижимость проверяется кликом: пакет, до которого нельзя дойти, для
    // показа не существует.
    await page.getByRole("link", { name: "Пакет", exact: true }).first().click();
    await page.waitForURL(/\/package$/);

    // Адрес обязан вести в КОНКРЕТНЫЙ прогон, а не в «пакет объекта вообще»:
    // пакет собирается по прогону, и ссылка без прогона умалчивала бы, по
    // какому именно.
    expect(page.url(), "вкладка «Пакет» не привела к пакету конкретного прогона").toMatch(/\/checks\/[^/]+\/package$/);

    return page.url();
  }

  test("строк ровно десять, и у каждой файл либо названная причина", async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page, ADMIN);
    await openPackage(page);

    const rows = page.locator("main table tbody tr");
    // Десять — число из `reference-system/output-1`. Заказчик считает по нему.
    await expect(rows).toHaveCount(10);

    const count = await rows.count();

    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index);
      const label = (await row.locator(".cell-title").innerText()).trim();

      const hasFile = (await row.locator("button[type=submit]").count()) > 0;
      const refusal = row.locator(".pill");
      const hasRefusal = (await refusal.count()) > 0;

      expect(hasFile || hasRefusal, `у строки «${label}» нет ни файла, ни причины`).toBe(true);

      if (!hasFile) {
        // Причина названа словом и полностью — в подсказке. «Не собран» без
        // причины читается как поломка системы, а не как её граница.
        const reason = (await refusal.first().getAttribute("title")) ?? "";
        expect(reason.length, `строка «${label}» не назвала причину, по которой не собрана`).toBeGreaterThan(10);
      }
    }
  });

  test("скачивание отдаёт настоящую книгу, а не страницу", async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page, ADMIN);
    const url = await openPackage(page);
    const checkId = /\/checks\/([^/]+)\//.exec(url)?.[1] ?? "";
    expect(checkId, "идентификатор прогона не вынимается из адреса").not.toBe("");

    // Документ берётся СОБРАННЫЙ, а не названный литералом. Литерал
    // «инженерное заключение» — гейт на данные (грабля №5): в свежем пакете
    // этот документ может быть не собран, и набор сообщал бы о поломке
    // скачивания там, где скачивать нечего по существу.
    const action = await page
      .locator("main table tbody tr form[action*='/package/']")
      .first()
      .getAttribute("action");

    const slug = action?.split("/package/").pop() ?? "";
    expect(slug, "в пакете нет ни одного собранного документа — скачивать нечего").not.toBe("");

    const outcome = await page.evaluate(async ([id, документ]) => {
      const response = await fetch(`/api/checks/${id}/package/${документ}`, { method: "POST" });
      const bytes = new Uint8Array(await response.arrayBuffer());

      return {
        status: response.status,
        type: response.headers.get("content-type") ?? "",
        disposition: response.headers.get("content-disposition") ?? "",
        length: bytes.byteLength,
        // Книга xlsx — это zip, и он начинается с «PK». Проверять надо тело, а
        // не заголовок: заголовок ставим мы сами, и он подтвердит что угодно.
        zip: bytes[0] === 0x50 && bytes[1] === 0x4b,
      };
    }, [checkId, slug] as const);

    expect(outcome.status).toBe(200);
    /**
     * Проверяется, что отдан НАСТОЯЩИЙ документ Office, а не страница.
     *
     * Стояло `spreadsheetml` — то есть набор требовал именно книгу. Но пакет
     * состоит из десяти документов, и первый собранный — записка руководителя
     * в docx. Литерал «книга» превращал вопрос «отдаёт ли система документ» в
     * вопрос «какой документ оказался первым», а это разные вопросы.
     */
    expect(outcome.type).toContain("officedocument");
    expect(outcome.disposition, "книга открылась бы в браузере вместо скачивания").toContain("attachment");
    expect(outcome.length, "тело книги пусто").toBeGreaterThan(4000);
    expect(outcome.zip, "отдан не документ Office: тело не начинается с подписи zip").toBe(true);
  });

  test("файл пакета назван по-русски и именем объекта, а не транслитерацией", async ({ page }) => {
    /**
     * Было `01_itogovaya-zapiska_KRG-1.docx`. В эталонном пакете
     * `reference-system/output-1` — `01_Итоговая_записка_Зауралье.docx`, и это
     * первое, что клиент видит, сохранив документы в папку: шифр объекта ему
     * ничего не говорит, имя объекта говорит всё.
     *
     * Имя отдаётся дважды: `filename=` понимают все, но по RFC 6266 в нём
     * только ASCII; кириллицу несёт `filename*=UTF-8''…`.
     */
    await signIn(page, ADMIN);
    const url = await openPackage(page);
    const checkId = /\/checks\/([^/]+)\//.exec(url)?.[1] ?? "";

    const disposition = await page.evaluate(async (id) => {
      const response = await fetch(`/api/checks/${id}/package/itogovaya-zapiska`, { method: "POST" });
      return response.headers.get("content-disposition") ?? "";
    }, checkId);

    expect(disposition, "имя файла не отдано в расширенной форме").toContain("filename*=UTF-8''");

    const имя = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1] ?? "");

    expect(имя, "имя файла не по-русски").toContain("Итоговая_записка");
    expect(имя, "имя файла не начинается с номера документа пакета").toMatch(/^01_/);
    expect(имя).toMatch(/\.docx$/);
    // Обычная форма остаётся: клиент, не читающий расширенную, получает файл
    // с ASCII-именем, а не без имени вовсе.
    expect(disposition).toContain('filename="');
  });

  test("десятый документ — график работ — собирается, а не отказывает", async ({ page }) => {
    /**
     * ЗДЕСЬ БЫЛО ОБРАТНОЕ, И ЭТО БЫЛО ВЕРНО ДО 06.09.2026.
     *
     * Гейт требовал 409 «нет агента»: десятая строка пакета — график
     * производства работ — агента не имела, и отказ с причиной был честнее
     * пустой книги. Теперь агент есть (планировщик Тимофей, такт 4), и
     * требовать отказа значило бы сторожить отсутствие как достижение.
     *
     * Предмет проверки остался прежним: десятая строка не отдаёт пустышку.
     * Изменилось то, чем она её не отдаёт — раньше отказом, теперь документом.
     */
    await signIn(page, ADMIN);
    const url = await openPackage(page);
    const checkId = /\/checks\/([^/]+)\//.exec(url)?.[1] ?? "";

    const outcome = await page.evaluate(async (id) => {
      const response = await fetch(`/api/checks/${id}/package/grafik-rabot`, { method: "POST" });
      const buffer = await response.arrayBuffer();
      const head = new Uint8Array(buffer).subarray(0, 2);

      return {
        status: response.status,
        length: buffer.byteLength,
        zip: head[0] === 0x50 && head[1] === 0x4b,
        body: response.ok ? "" : new TextDecoder().decode(buffer),
      };
    }, checkId);

    // Прогон демонстрационного объекта мог идти без планировщика, если он
    // старше правки. Тогда отказ по-прежнему верен — и обязан назвать причину.
    if (outcome.status !== 200) {
      expect(outcome.body, "отказ не назвал причину").not.toBe("");
      return;
    }

    expect(outcome.zip, "отдан не документ Office: тело не начинается с подписи zip").toBe(true);
    expect(outcome.length, "тело книги пусто").toBeGreaterThan(4000);
  });
});

/**
 * Адреса рельса — гейт, которого не было, и потому дефект жил.
 *
 * ЧТО ИМЕННО ЗДЕСЬ ПРОВЕРЯЕТСЯ
 *
 * Не «раздел открывается» — это уже проверено выше и было ЗЕЛЁНЫМ, пока пять
 * пунктов из девяти вели на один и тот же `/objects`. Каждая ссылка отвечала
 * 200, каждый экран имел заголовок, набор молчал. Проверялось наличие адреса, а
 * не его СМЫСЛ: рельс обещал пять мест и приводил в одно.
 *
 * Здесь проверяется различие. Плюс то, ради чего заведён переключатель объекта:
 * без выбранного объекта объектные разделы не ссылки и называют повод, а с
 * выбранным — ведут каждый на своё.
 */
test.describe("адреса рельса", () => {
  test("ни два пункта не ведут на один адрес", async ({ page }) => {
    test.setTimeout(60_000);
    await signIn(page, ADMIN);
    await chooseObject(page, OBJECT);
    await openRail(page);

    const hrefs = await page
      .locator(".rail__nav a.rail__item")
      .evaluateAll((items) =>
        items.map((item) => ({
          href: item.getAttribute("href") ?? "",
          label: (item.textContent ?? "").trim(),
        })),
      );

    expect(hrefs.length, "в рельсе нет ссылок — проверять нечего").toBeGreaterThan(4);

    const seen = new Map<string, string>();

    for (const { href, label } of hrefs) {
      const twin = seen.get(href);
      expect(
        twin,
        `«${label}» и «${twin}» ведут на один адрес ${href}: рельс обещает два места и приводит в одно`,
      ).toBeUndefined();
      seen.set(href, label);
    }
  });

  /**
   * ГЕЙТ ЗАМЕНЁН ВМЕСТЕ С ЗАМЫСЛОМ, А НЕ ПОДОГНАН.
   *
   * Здесь стоял набор «без выбранного объекта объектный раздел не ссылка и
   * называет повод»: он сторожил шесть пунктов рельса, которые вели на виды
   * ОДНОГО объекта. Владелец назвал ровно это неинтуитивным, и он прав: пункт
   * рельса — раздел системы, а там стояли листья одной стройки. Виды переехали
   * во вкладки карточки, и сторожить в рельсе стало нечего.
   *
   * Гейт не удалён, а перевёрнут: теперь он требует, чтобы вида объекта в
   * рельсе НЕ БЫЛО, а на карточке он был вкладкой со своим адресом. Иначе
   * возврат прежней раскладки прошёл бы молча.
   */
  test("видов объекта в рельсе нет — они вкладки карточки", async ({ page }) => {
    // Шесть вкладок — шесть маршрутов, и в разработке каждый компилируется при
    // первом обращении. Замерено: один холодный экран доходит до тридцати
    // секунд (`Ф-64`), то есть шесть не укладываются в минуту ни при какой
    // скорости машины. Это цена набора, который проверяет ДОСТИЖИМОСТЬ, а не
    // разметку, и она оправдана: именно недостижимость и была пороком.
    test.setTimeout(240_000);
    await signIn(page, ADMIN);
    await chooseObject(page, OBJECT);
    await openRail(page);

    const rail = (await page.locator(".rail__nav .rail__item-label").allInnerTexts()).map((text) => text.trim());

    for (const view of ["Карточка объекта", "Сравнение КП", "Агенты", "Рабочий экран", "Пакет заказчику"]) {
      expect(rail, `«${view}» снова стоит пунктом рельса: это вид объекта, а не раздел системы`).not.toContain(view);
    }

    await page.goto(`/objects/${OBJECT}`);

    const tabs = await page
      .locator(".tabs__link")
      .evaluateAll((items) =>
        items.map((item) => ({ href: item.getAttribute("href") ?? "", label: (item.textContent ?? "").trim() })),
      );

    expect(tabs.length, "вкладок на карточке объекта нет — виды объекта стали недостижимы").toBe(6);

    // Тот же порок, что был в рельсе, возможен и здесь: шесть вкладок, ведущих
    // в одно место. Проверяется тем же способом.
    const seen = new Map<string, string>();

    for (const { href, label } of tabs) {
      const twin = seen.get(href);
      expect(twin, `вкладки «${label}» и «${twin}» ведут на один адрес ${href}`).toBeUndefined();
      seen.set(href, label);
      // Ссылка обязана открываться: вкладка, отвечающая ошибкой, хуже её отсутствия.
      const response = await page.request.get(href);
      expect(response.status(), `вкладка «${label}» ответила ${response.status()} на ${href}`).toBeLessThan(400);
    }
  });

  test("заголовок экрана объекта — имя объекта, а не название вида", async ({ page }) => {
    test.setTimeout(60_000);
    await signIn(page, ADMIN);
    await chooseObject(page, OBJECT);

    // Шапка каркаса писала «Проверка / АГЕНТЫ», а страница ставила ещё раз
    // крупное «Агенты» — одно слово дважды в двадцати пикселях друг от друга.
    // Заголовок обязан отвечать на вопрос «где я», а он один: на объекте.
    for (const path of ["", "/documents", "/offers", "/agents"]) {
      await page.goto(`/objects/${OBJECT}${path}`);

      const headings = await page.locator("main h1").allInnerTexts();

      expect(headings.length, `на ${path || "/"} заголовков не один`).toBe(1);
      expect(
        headings[0]?.trim(),
        `на ${path || "/"} заголовок называет вид, а не объект`,
      ).not.toMatch(/^(Агенты|Сравнение предложений|Загрузка и разбор|Пакет заказчику)$/);
    }
  });

  test("выбор объекта переживает переход на другой экран", async ({ page }) => {
    await signIn(page, ADMIN);
    await chooseObject(page, OBJECT);

    await page.goto("/journal");

    /**
     * Проверяется ПЕРЕКЛЮЧАТЕЛЬ ШАПКИ, а не пункт рельса.
     *
     * Здесь стояла ссылка `.rail__nav a[href="/objects/KRG-1"]` — и она не
     * появится никогда: видов объекта в рельсе нет по решению, они вкладки
     * карточки, и соседний тест это же и утверждает. Два гейта противоречили
     * друг другу, и падал тот, который отстал от решения.
     *
     * Настоящий инвариант тот же: настройка серверная, значит выбор обязан
     * дожить до ЛЮБОГО экрана, включая общий журнал.
     */
    await expect(
      page.locator(".topbar__object-select"),
      "выбор объекта не дожил до другого экрана",
    ).toHaveValue(OBJECT);
  });

  test("несуществующий адрес отвечает по-русски и выводит в реестр", async ({ page }) => {
    /**
     * Пройдено руками по пути Г-15: чужой объект по прямому адресу отдавал
     * стандартную страницу Next — «404 This page could not be found», чёрным по
     * белому, без оболочки и без языка продукта.
     *
     * Экран показывается ровно тогда, когда человек попал не туда, — когда ему
     * нужнее всего понять, что случилось. Английская заглушка отвечает
     * «сломалось», хотя система как раз сработала правильно.
     */
    await signIn(page, ADMIN);

    const ответ = await page.goto("/objects/НЕТ-ТАКОГО-ШИФРА");

    expect(ответ?.status(), "несуществующий объект обязан отвечать 404").toBe(404);
    await expect(page.getByRole("heading", { name: "Страница не найдена" })).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
      "показана стандартная английская заглушка Next вместо экрана продукта",
    ).toHaveCount(0);
    // Выход есть: тупик без ссылки заставляет человека править адрес руками.
    await expect(page.getByRole("link", { name: "Реестр объектов" })).toBeVisible();
  });

  test("экран объекта САМ выбирает свой объект — выбирать в шапке не нужно", async ({ page }) => {
    /**
     * Пройдено руками, и это было первое, что бросилось в глаза: клиент
     * открывает объект из реестра, попадает на его загрузку — а рельс слева
     * мёртв, и шапка говорит «объект не выбран». Человек СТОИТ на объекте, а
     * система утверждает, что объекта нет; чтобы рельс ожил, надо отдельно
     * выбрать в шапке то, что уже открыто на экране.
     *
     * Проверяется на объекте, ОТЛИЧНОМ от сохранённого в шапке: иначе гейт
     * прошёл бы и на старом поведении — cookie указывала бы туда же.
     */
    await signIn(page, ADMIN);
    await chooseObject(page, OBJECT);

    const другой = await page
      .goto("/objects")
      .then(() =>
        page
          .locator(`main a[href^="/objects/"]:not([href*="/objects/${OBJECT}"])`)
          .first()
          .getAttribute("href"),
      );

    test.skip(другой === null, "в контуре один объект — проверять переключение не на чем");

    const шифр = decodeURIComponent((другой ?? "").split("/")[2] ?? "");

    await page.goto(`/objects/${encodeURIComponent(шифр)}/upload`);

    await expect(
      page.locator(".topbar__object-select"),
      `открыт объект ${шифр}, а шапка называет другой: рельс поведёт не туда`,
    ).toHaveValue(шифр);

    /**
     * И вкладки карточки ведут в ТОТ ЖЕ объект, а не в сохранённый в шапке.
     *
     * Проверяется именно это, а не «рельс ожил»: видов объекта в рельсе нет по
     * решению — они вкладки карточки, и соседний гейт это утверждает. Гейт,
     * ждущий их в рельсе, противоречил бы ему и падал бы вечно.
     */
    const вкладки = await page
      .locator(`main a[href^="/objects/"]`)
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));

    expect(вкладки.length, "у карточки объекта нет ни одной вкладки").toBeGreaterThan(2);
    expect(
      вкладки.filter((href) => !href.startsWith(`/objects/${encodeURIComponent(шифр)}`)),
      `на экране объекта ${шифр} есть ссылки в другой объект`,
    ).toEqual([]);
  });
});

/**
 * Доска агентов — то, чего интерфейс не показывал, имея данные.
 *
 * ЧТО ИМЕННО ЗДЕСЬ ГЕЙТ
 *
 * Не «доска отрисовалась». Read-модель роняла `capability`, то есть личность
 * автора, и девять агентов схлопывались в одну строку таблицы. Поэтому
 * проверяются пять утверждений, каждое из которых ломается тихо:
 *
 *  · сумма замечаний по агентам равна числу в артефакте — иначе часть авторов
 *    потеряна, а экран выглядит полным;
 *  · ни одно замечание не показано без основания (ТЗ §9);
 *  · агент, который НЕ работал, отличён словом от агента без замечаний, и
 *    ссылкой не притворяется: открывать в нём нечего;
 *  · предусловие такта названо словами и с автором предмета — без этого девять
 *    агентов выглядят девятью независимыми проверками, а они цепочка;
 *  · у критичного замечания есть автор: «критично» без автора не адресуемо.
 */
test.describe("приёмы компоновки", () => {
  test("экран агента — два столбца: список и панель контекста", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, ADMIN);
    await chooseObject(page, OBJECT);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/objects/${OBJECT}/agents/estimate_review`);

    const list = page.locator(".split > .card").first();
    const aside = page.locator(".split__aside");

    await expect(aside).toBeVisible();

    const listBox = await list.boundingBox();
    const asideBox = await aside.boundingBox();

    // Столбцы РЯДОМ, а не друг под другом: вердикт, уехавший под сорок шестое
    // замечание, читатель уже не помнит — а замечания на него и опираются.
    expect(asideBox?.x ?? 0, "панель контекста стоит не справа от списка").toBeGreaterThan(
      (listBox?.x ?? 0) + (listBox?.width ?? 0) - 4,
    );

    // Узкая колонка задана в пикселях: панель не расползается на пол-экрана и
    // не сжимается до нечитаемого.
    expect(asideBox?.width ?? 0, "панель контекста шире, чем задано").toBeLessThanOrEqual(400);
    expect(asideBox?.width ?? 0, "панель контекста сжалась").toBeGreaterThanOrEqual(300);

    // На узком экране столбцы обязаны стать одним: две колонки по 700 px — это
    // не две колонки.
    await page.setViewportSize({ width: 900, height: 900 });
    await page.reload();

    const narrowList = await page.locator(".split > .card").first().boundingBox();
    const narrowAside = await page.locator(".split__aside").boundingBox();

    expect(narrowAside?.y ?? 0, "на 900 px столбцы остались рядом").toBeGreaterThan(narrowList?.y ?? 0);
  });

  test("шаговик тракта называет пройденное, текущее и то, что впереди", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, ADMIN);
    await chooseObject(page, OBJECT);
    await page.goto(`/objects/${OBJECT}/upload`);

    await expect(page.locator(".tract__step")).toHaveCount(6);
    // Ровно один текущий: два «сейчас» означают, что состояние не выведено.
    await expect(page.locator(".tract__step--now")).toHaveCount(1);
    await expect(page.locator(".tract__step--now")).toContainText("Загрузка");

    // Шаг впереди — НЕ ссылка: пакет по объекту без прогона откроется
    // перенаправлением на карточку, и нажатие будет выглядеть как нажатие,
    // которое ничего не сделало.
    const ahead = page.locator(".tract__step--ahead");
    expect(await ahead.count(), "впереди не осталось ни одного шага").toBeGreaterThan(0);
    expect(
      await ahead.locator("xpath=self::a").count(),
      "шаг впереди сделан ссылкой: она ведёт не туда, куда обещает",
    ).toBe(0);

    // Одна подсказка на активный шаг, а не текст под каждым узлом.
    await expect(page.locator(".tract__hint")).toHaveCount(1);
  });

  test("отбор по важности — строкой над данными и в адресе", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, ADMIN);
    await chooseObject(page, OBJECT);
    /**
     * АГЕНТ ВЫБИРАЕТСЯ ПО ДОСКЕ, А НЕ НАЗЫВАЕТСЯ ЛИТЕРАЛОМ.
     *
     * Первая версия шла прямо на `estimate_review` — и упала: в свежем прогоне
     * контура у сметчика замечаний не оказалось, отбирать было нечего, и строки
     * отбора справедливо не было. Падение было про ДАННЫЕ, а не про механизм.
     *
     * Теперь агент ищется тот, у которого важностей больше одной: отбор из
     * одного значения — не отбор, и такой экран его намеренно не показывает.
     */
    await доскаСАртефактом(page);

    /**
     * ВАЖНОСТИ СЧИТАЮТСЯ ПО ДОСКЕ, А НЕ ОБХОДОМ ВСЕХ ДЕВЯТИ ЭКРАНОВ.
     *
     * Вторая версия набора открывала экран каждого агента по очереди и упиралась
     * в таймаут: девять маршрутов, каждый компилируется при первом заходе. Доска
     * уже показывает разбивку по важностям у каждой плитки — надо читать её, а
     * не ходить.
     */
    const candidate = await page.evaluate(
      "[...document.querySelectorAll('main a.agent')].map((tile) => ({ href: tile.getAttribute('href') || '', severities: tile.querySelectorAll('.agent__severity-item').length })).sort((left, right) => right.severities - left.severities)[0] || null",
    ) as { readonly href: string; readonly severities: number } | null;

    expect(candidate, "на доске нет ни одного высказавшегося агента").not.toBeNull();
    expect(
      candidate?.severities ?? 0,
      "ни у одного агента прогона нет замечаний более чем одной важности — отбор проверять нечем",
    ).toBeGreaterThan(1);

    await page.goto(candidate?.href ?? `/objects/${OBJECT}/agents`);

    const toolbar = page.locator(".toolbar").first();
    await expect(toolbar).toBeVisible();

    // Строка, а не карточка: отбор — орган управления, а не блок данных.
    const box = await toolbar.boundingBox();
    expect(box?.height ?? 0, "под отбор снова отведён блок высотой в карточку").toBeLessThan(90);

    const before = await page.locator(".crit").count();
    expect(before, "у агента нет замечаний — отбирать нечего").toBeGreaterThan(3);

    // Отбор живёт В АДРЕСЕ: отобранный список обязан открываться по ссылке,
    // иначе его нельзя ни прислать, ни вернуть кнопкой «назад».
    // Первый чип — «все замечания»; берётся второй, то есть первое ЗНАЧЕНИЕ.
    // Называть «критично» литералом значило бы снова опереться на данные.
    const chip = page.locator(".filters__chip").nth(1);
    const word = (await chip.innerText()).replace(/\s*\d+\s*$/, "").trim();

    await chip.click();
    // Ожидание по РАСКОДИРОВАННОМУ адресу: параметр называется по-русски, и в
    // адресной строке он приезжает как `%D0%B2%D0%B0...`. Регулярное выражение
    // по русским буквам не совпало с ним ни разу и ждало до таймаута.
    await page.waitForURL((url) => decodeURIComponent(url.search).includes("важность="));

    const after = await page.locator(".crit").count();
    expect(after, "отбор ничего не отобрал").toBeLessThan(before);
    expect(after, "отбор отобрал пусто").toBeGreaterThan(0);

    // И называет отбор словом человека, а не ключом артефакта: в артефакте
    // важность зовётся `critical`, а на экране обязана — «критично».
    await expect(page.locator("main").first()).toContainText(`отбор: ${word}`);
  });
});

test.describe("доска агентов", () => {
  test("сумма замечаний по агентам равна числу в артефакте", async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page, ADMIN);
    await доскаСАртефактом(page);

    const badge = (await page.locator(".pill").first().innerText()).trim();
    const spoke = /высказалось (\d+) из (\d+)/.exec(badge);
    expect(spoke, `плитка состояния не назвала, сколько агентов высказалось: «${badge}»`).not.toBeNull();

    // Девять — число агентов конвейера. Меньше девяти в знаменателе означало бы,
    // что такт потерян вместе со своими шагами.
    expect(Number(spoke?.[2]), "агентов на доске меньше девяти: потерян такт или шаг").toBeGreaterThanOrEqual(9);
    expect(Number(spoke?.[1]), "ни один агент не высказался — сверять нечего").toBeGreaterThan(0);

    // Сумма по плиткам сверяется с рабочим экраном того же прогона: он несёт
    // общее число замечаний артефакта, и разойтись они не имеют права.
    const perAgent = await page.locator(".agent").evaluateAll((tiles) =>
      tiles.map((tile) =>
        [...tile.querySelectorAll(".agent__severity-item .num")].reduce(
          (sum, node) => sum + Number((node.textContent ?? "0").trim()),
          0,
        ),
      ),
    );

    const total = perAgent.reduce((sum, count) => sum + count, 0);
    expect(total, "по плиткам не набралось ни одного замечания").toBeGreaterThan(0);

    await page.getByRole("link", { name: "Рабочий экран" }).click();
    await page.waitForURL(/\/checks\/[0-9a-f-]{36}$/);

    const summary = await page.locator("main").innerText();
    const declared = /агентов (\d+), замечаний (\d+)/.exec(summary);
    expect(declared, "рабочий экран не назвал число замечаний артефакта").not.toBeNull();

    expect(
      total,
      `по агентам ${total} замечаний, в артефакте ${declared?.[2]}: часть авторов потеряна по дороге`,
    ).toBe(Number(declared?.[2]));
  });

  test("ни одно замечание не показано без основания", async ({ page }) => {
    test.setTimeout(60_000);
    await signIn(page, ADMIN);
    await доскаСАртефактом(page);

    // Сначала на доске — критичное от всех агентов.
    const bases = await page.locator(".crit__basis").allInnerTexts();
    expect(bases.length, "на доске нет ни одного замечания — проверять нечем").toBeGreaterThan(0);

    for (const basis of bases) {
      expect(basis.trim().length, "замечание показано без основания: §9 требует основания у вывода").toBeGreaterThan(10);
    }

    // Затем на экране одного агента — там замечания все, а не только критичные.
    await page.locator("a.agent--open").first().click();
    // Прогон едет в адресе: доска перестала терять его при переходе к агенту.
    await page.waitForURL(/\/agents\/[a-z_]+(\?|$)/);

    const own = await page.locator(".crit__basis").allInnerTexts();
    expect(own.length, "у агента не показано ни одного замечания").toBeGreaterThan(0);

    for (const basis of own) {
      expect(basis.trim().length, "замечание агента показано без основания").toBeGreaterThan(10);
    }
  });

  test("«не работал» отличён от «замечаний не нашёл» и ссылкой не притворяется", async ({ page }) => {
    await signIn(page, ADMIN);
    await доскаСАртефактом(page);

    const idle = page.locator(".agent:not(.agent--open)");
    const count = await idle.count();
    expect(count, "все агенты высказались — правило различия проверять нечем").toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const tile = idle.nth(index);
      const text = (await tile.innerText()).trim();

      // Ссылкой не притворяется ни сам элемент, ни что-либо внутри него.
      expect(await tile.evaluate((node) => node.tagName), `плитка «${text.slice(0, 20)}» отрисована ссылкой`).not.toBe("A");
      expect(await tile.locator("a").count(), "внутри неработавшего агента есть ссылка").toBe(0);

      // И различие сказано СЛОВОМ: «замечаний нет» без причины читается как
      // утверждение об объекте, а это утверждение о прогоне.
      expect(text, `плитка «${text.slice(0, 20)}» не сказала, почему замечаний нет`).toContain("не работал");
    }
  });

  test("предусловие такта названо словами и с автором предмета", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto(`/objects/${OBJECT}/agents`);

    const waits = await page.locator(".agent__wait").allInnerTexts();
    expect(
      waits.length,
      "ни один агент не показал, чего ждёт: конвейер выглядит списком независимых проверок",
    ).toBeGreaterThan(0);

    // Хотя бы одно предусловие обязано называть автора предмета: `вор:approved`
    // человеку не говорит ничего, а «производит Денчик» говорит.
    const named = waits.filter((wait) => /производит \S+/.test(wait));
    expect(named.length, "предусловия показаны без автора предмета").toBeGreaterThan(0);
  });

  test("у критичного замечания есть автор и такт", async ({ page }) => {
    await signIn(page, ADMIN);
    await доскаСАртефактом(page);

    const rows = page.locator(".crit");
    const count = await rows.count();
    expect(count, "критичных замечаний нет — проверять адресность нечем").toBeGreaterThan(0);

    for (let index = 0; index < Math.min(count, 5); index += 1) {
      const author = rows.nth(index).locator(".crit__author");
      // Автор — ссылка на его же экран: «критично» без адресата не поручить.
      expect(await author.locator("a").count(), "у критичного замечания нет ссылки на автора").toBe(1);
      expect((await author.locator(".crit__tact").innerText()).trim().length, "у замечания не назван такт").toBeGreaterThan(
        2,
      );
    }
  });
});
