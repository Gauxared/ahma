/**
 * Приём файлов объекта: партии загрузки в каталоге контура.
 *
 * ПОЧЕМУ КАТАЛОГ, А НЕ БАЗА И НЕ S3
 *
 * Ядро читает вход через `readdir` (`platform/execution/check-ports.ts:285`) —
 * ему нужен КАТАЛОГ. Положить файл в базу значило бы выгружать его во временную
 * папку перед каждым прогоном, то есть завести вторую копию и второй источник
 * правды. Объектное хранилище решает ту же задачу, но добавляет службу в
 * on-prem-контур заказчика; для одной машины это плата без выгоды.
 *
 * ЧТО ЗАМЕНЯЕТ ЭТОТ МОДУЛЬ
 *
 * До него загрузки не было вовсе: на карточке объекта стояло поле, куда руками
 * вписывали путь к папке на сервере, и ядро читало эту папку. То есть браузер
 * диктовал серверу, какой каталог файловой системы прочитать. Здесь путь
 * СЧИТАЕТСЯ по арендатору, шифру и партии, а извне приходит только имя партии,
 * и оно сверяется с перечнем существующих.
 *
 * ИЗОЛЯЦИЯ АРЕНДАТОРА — КАТАЛОГОМ
 *
 * В базе её держит RLS, здесь — первый сегмент пути, и он берётся из СЕССИИ, а
 * не из запроса. Ни одна функция этого модуля не принимает арендатора из формы.
 *
 * ПАРТИЯ — ЭТО ВЕРСИЯ ВХОДА
 *
 * Повторная загрузка не затирает предыдущую: сметы правят и присылают заново, и
 * «какой именно комплект проверяли» — вопрос, на который прогон обязан отвечать
 * годы спустя. Поэтому партия названа временем в UTC и неизменна.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";

import { expandArchive, isArchive } from "./archives.js";

/**
 * Корень хранения документов заказчика.
 *
 * ИМЯ ПЕРЕМЕННОЙ ОДНО, И ЭТО НЕ ПЕДАНТИЗМ.
 *
 * Здесь читалось `SI_UPLOAD_ROOT` — имя, которого не было НИ В ОДНОМ файле
 * окружения. В `.env` при этом стояло `STROYINTELLECT_OBJECTS_PATH`, а в
 * compose — `OBJECTS_PATH`. Три имени одного, из которых работало то, что никто
 * не задавал.
 *
 * Найдено на сервере: `.env` объявлял `/srv/stroyintellekt/objects`, документы
 * заказчика ложились в `/opt/stroyintellekt/var/objects` — то есть ВНУТРЬ
 * каталога с кодом. Правило развёртывания требует обратного: документы
 * монтируются и в поставку не входят (ТЗ §11), потому что образ уезжает в
 * реестр, а сметы заказчика там не место.
 *
 * Хуже самого пути было обещание: переменная в окружении заявляла то, чего не
 * делала. Настройка, которую можно задать и которая ни на что не влияет, —
 * это ложь конфигурации, и обнаруживается она позже всего.
 */
export function uploadRoot(): string {
  const configured = process.env["STROYINTELLECT_OBJECTS_PATH"];
  return resolve(configured === undefined || configured.trim() === "" ? "var/objects" : configured);
}

/**
 * Расширения, которые система умеет читать.
 *
 * Список — не про безопасность в первую очередь, а про честность: `.dwg` или
 * `.zip` система прочитать не может, и принять их значило бы пообещать разбор,
 * которого не будет. Отказ с названной причиной полезнее принятого файла,
 * который потом молча пропустят на разборе.
 */
/**
 * ФОРМАТЫ, КОТОРЫЕ СИСТЕМА ЧИТАЕТ, — а не которые дверь пропускает.
 *
 * До 07.09.2026 это был белый список двери: файл с иным расширением
 * отвергался с причиной «система не умеет читать». На комплектах заказчика так
 * отвалилось 33 файла из 298 — .doc, .rtf, .pptx, .rar, .png, .frw. Владелец
 * требует принимать любой вход: агенты работают с тем, что есть, а нечитаемый
 * файл называется нечитаемым внутри, не выбрасывается на двери (spec-demo-stage-1
 * А11). Перечень остался: страница называет, что разбирается, а гейт
 * `door-and-walk.test.ts` проверяет, что у каждого формата есть чтение либо
 * названная причина.
 */
export const ACCEPTED = [
  ".xlsx", ".xls", ".pdf", ".docx", ".doc", ".rtf", ".pptx", ".odt", ".ods", ".odp",
  ".xml", ".csv", ".txt", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp",
] as const;

/*
 * Архив принимается и РАСПАКОВЫВАЕТСЯ, а не хранится как файл: ядро читает
 * каталог, и файл внутри архива остался бы невидимым для обхода. Перечень
 * архивных расширений живёт в `archives.ts` — второе имя на один и тот же
 * список разошлось бы с первым при первом изменении.
 */


/** Потолок на файл. Крупнейший файл `input-1` — 4,3 МБ; 32 МБ с запасом. */
// 512 МБ — столько же принимает nginx (`client_max_body_size 512m`): потолок
// двери ниже потолка сервера читался бы как отказ системы, а не сети.
export const MAX_FILE_BYTES = 512 * 1024 * 1024;

/**
 * Потолок на партию.
 *
 * Было 40 — по комплекту `input-1` из семи файлов с запасом. После распаковки
 * архивов это стало неверным числом: типовой вход клиента по условию задачи —
 * «сто смет Excel одним ZIP», и сороковой файл отсекал бы шестьдесят из ста.
 *
 * 300 — то же число, что потолок записей архива (`MAX_ENTRIES`): два разных
 * потолка на одном пути дали бы отказ, причину которого пришлось бы искать в
 * двух местах.
 */
export const MAX_FILES = 1000;

export interface AcceptedFile {
  /**
   * Путь внутри партии, разделённый косой чертой.
   *
   * У файла, присланного напрямую, это просто имя. У файла из архива — путь,
   * который был в архиве: «Смета/Раздел 3/ЛСР-05.xlsx». Задача требует
   * «понимать, какой файл откуда появился», и путь — единственное место, где
   * это знание живёт бесплатно.
   */
  readonly name: string;
  readonly bytes: number;
  /** SHA-256 содержимого: тот же отпечаток, которым ядро помечает входы. */
  readonly hash: string;
  /** Имя архива, если файл приехал внутри него. Пусто — прислан напрямую. */
  readonly origin?: string;
}

export interface RejectedFile {
  readonly name: string;
  /** Причина словом — её показывают человеку, а не только пишут в лог. */
  readonly reason: string;
}

export interface SavedBatch {
  readonly batch: string;
  readonly path: string;
  readonly accepted: readonly AcceptedFile[];
  readonly rejected: readonly RejectedFile[];
}

/**
 * Имя файла приводится к безопасному виду.
 *
 * `basename` снимает любой путь: `../../etc/passwd` становится `passwd`. Дальше
 * отбрасываются разделители, управляющие знаки и ведущая точка — скрытые файлы
 * в партии означают, что кто-то пытается спрятать вход от глаз.
 *
 * Кириллица СОХРАНЯЕТСЯ: имена смет по-русски («РИМ Курган_СОТВ_ испр…»), и
 * транслитерация превратила бы понятный перечень в кашу. Опасность несёт
 * структура пути, а не алфавит.
 */
export function safeName(raw: string): string | undefined {
  const base = basename(raw.replaceAll("\\", "/")).trim();
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[/\\:*?"<>|]/g, "_");

  if (cleaned === "" || cleaned === "." || cleaned === "..") return undefined;
  if (cleaned.startsWith(".")) return undefined;
  if (cleaned.length > 180) return undefined;

  return cleaned;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

/**
 * Имя партии: время в UTC.
 *
 * Двоеточия и точка недопустимы в именах файлов на Windows, поэтому заменяются
 * дефисом. Порядок при этом сохраняется: ISO-8601 сортируется как строка ровно
 * так же, как по времени, — и перечень партий не нуждается в чтении времени
 * файла, чтобы стоять в правильном порядке.
 */
export function batchName(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

/**
 * Шифр объекта в сегмент пути.
 *
 * Шифр приходит из адреса, то есть извне, — значит проверяется. Разрешены
 * буквы, цифры, дефис и подчёркивание: этого хватает на `KRG-1` и не хватает
 * на `..`.
 */
function safeCode(code: string): string | undefined {
  return /^[A-Za-z0-9_-]{1,64}$/.test(code) ? code : undefined;
}

/** Имя партии, пришедшее извне, — тоже сегмент пути, и тоже проверяется. */
function safeBatch(batch: string): string | undefined {
  return /^[0-9A-Za-z_-]{1,64}Z?$/.test(batch) ? batch : undefined;
}

/**
 * Каталог партии.
 *
 * Возвращает `undefined`, а не бросает: непригодный шифр — это испорченный
 * адрес, а не сбой, и обработчик обязан ответить отказом с причиной.
 */
export function batchPath(tenantId: string, code: string, batch: string): string | undefined {
  const object = objectPath(tenantId, code);
  const safe = safeBatch(batch);

  if (object === undefined || safe === undefined) return undefined;

  return inside(join(object, safe));
}

/**
 * Каталог объекта — родитель всех его партий.
 *
 * Заведён отдельно, потому что перечень партий читает именно его. Первая версия
 * получала этот путь так: `batchPath(tenant, code, "заглушка")` и отрезала
 * последний сегмент. Заглушка была написана по-русски, проверка сегмента её не
 * пропускала, `batchPath` возвращал `undefined` — и перечень партий всегда
 * оказывался ПУСТЫМ, то есть экран сообщал «ничего не загружали» про объект, по
 * которому загружено всё. Ошибка тихая: пустой перечень выглядит законно.
 */
export function objectPath(tenantId: string, code: string): string | undefined {
  // Арендатор приходит из сессии, а не из запроса, — и всё равно проверяется:
  // сегмент пути обязан быть безопасным независимо от того, кто его подал.
  const safeTenant = /^[0-9a-fA-F-]{8,64}$/.test(tenantId) ? tenantId : undefined;
  const code_ = safeCode(code);

  if (safeTenant === undefined || code_ === undefined) return undefined;

  return inside(join(uploadRoot(), safeTenant, code_));
}

/**
 * Последняя черта обороны: собранный путь обязан лежать ВНУТРИ корня.
 *
 * Проверки сегментов выше уже не пускают `..`, и эта проверка при них
 * избыточна. Она здесь потому, что избыточной перестанет быть при первой же
 * правке регулярного выражения — а правка регулярного выражения не выглядит как
 * правка безопасности.
 */
function inside(path: string): string | undefined {
  return path.startsWith(uploadRoot() + sep) ? path : undefined;
}

export interface IncomingFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/**
 * Записать партию.
 *
 * Отклонённые файлы НЕ отменяют партию целиком: из семи присланных шесть могут
 * быть сметами, а седьмой — архивом, и терять шесть из-за одного бессмысленно.
 * Но и молчать о нём нельзя — он возвращается в `rejected` с причиной, и экран
 * её показывает.
 */
export async function saveBatch(input: {
  readonly tenantId: string;
  readonly code: string;
  readonly files: readonly IncomingFile[];
  readonly now: Date;
}): Promise<SavedBatch | undefined> {
  const batch = batchName(input.now);
  const path = batchPath(input.tenantId, input.code, batch);

  if (path === undefined) return undefined;

  const accepted: AcceptedFile[] = [];
  const rejected: RejectedFile[] = [];
  const payloads: IncomingFile[] = [];
  const seen = new Set<string>();

  /**
   * АРХИВЫ РАСКРЫВАЮТСЯ ДО РАЗБОРА ПАРТИИ.
   *
   * Присланное сначала превращается в плоский перечень «путь → содержимое», и
   * дальше архив ничем не отличается от прямой загрузки: те же потолки, тот же
   * белый список расширений, та же проверка на дубль. Один проход правил на два
   * способа доставки — иначе правило, добавленное для одного, забудут для
   * другого.
   */
  const incoming: { readonly name: string; readonly bytes: Uint8Array; readonly origin?: string }[] = [];

  for (const file of input.files) {
    const outerName = safeName(file.name);

    if (outerName === undefined) {
      rejected.push({ name: file.name, reason: "имя файла непригодно для хранения" });
      continue;
    }

    if (!isArchive(extensionOf(outerName))) {
      incoming.push({ name: outerName, bytes: file.bytes });
      continue;
    }

    const expanded = await expandArchive(file.bytes);

    for (const rejection of expanded.rejected) {
      rejected.push({ name: `${outerName} → ${rejection.path}`, reason: rejection.reason });
    }

    for (const entry of expanded.files) {
      incoming.push({ name: entry.path, bytes: entry.bytes, origin: outerName });
    }

    // Архив, из которого не вышло ни одного файла, — это отказ, о котором
    // обязаны сказать. Молчание здесь читалось бы как «загрузили, всё хорошо».
    if (expanded.files.length === 0 && expanded.rejected.length === 0) {
      rejected.push({ name: outerName, reason: "архив пуст: ни одного файла внутри" });
    }
  }

  for (const file of incoming.slice(0, MAX_FILES)) {
    // Путь из архива уже проверен посегментно (`safeEntryPath`); имя файла,
    // присланного напрямую, — тоже. Второй раз здесь проверяется ПОСЛЕДНИЙ
    // сегмент: именно он станет именем файла на диске.
    const name = file.name;
    const leaf = basename(name);

    // РАСШИРЕНИЕ ДВЕРЬ НЕ ПРОВЕРЯЕТ (А11): любой файл принимается и попадает в
    // партию; что из него можно прочитать, решает обход по содержимому, и
    // нечитаемое называется нечитаемым там, а не выбрасывается здесь.
    if (file.bytes.byteLength === 0) {
      rejected.push({ name, reason: "файл пуст" });
      continue;
    }

    if (file.bytes.byteLength > MAX_FILE_BYTES) {
      rejected.push({
        name,
        reason: `${Math.round(file.bytes.byteLength / 1024 / 1024)} МБ больше потолка ${MAX_FILE_BYTES / 1024 / 1024} МБ`,
      });
      continue;
    }

    if (seen.has(name)) {
      rejected.push({ name, reason: "в этой же партии файл с таким путём уже принят" });
      continue;
    }

    seen.add(name);
    accepted.push({
      name,
      bytes: file.bytes.byteLength,
      hash: createHash("sha256").update(file.bytes).digest("hex"),
      // «Нет происхождения» и «происхождение равно undefined» — разные
      // утверждения при `exactOptionalPropertyTypes`, и второе типом запрещено.
      ...(file.origin === undefined ? {} : { origin: file.origin }),
    });
    // Содержимое запоминается ЗДЕСЬ, вместе с решением принять файл.
    //
    // Первая версия писала вторым проходом по `input.files`, сверяя имя со
    // списком принятых, — и на двух файлах с одним именем писала дважды: второй
    // проход не знал, что дубль уже отклонён. Ловушка «искать по имени то, что
    // уже решено» повторяется всякий раз, когда решение и действие разнесены на
    // два цикла. Проверка на дубль имени это и поймала.
    payloads.push({ name, bytes: file.bytes });
  }

  // Потолок считается по РАСКРЫТОМУ перечню, а не по числу присланных: один
  // архив — это один присланный файл и сто файлов внутри.
  if (incoming.length > MAX_FILES) {
    rejected.push({
      name: `и ещё ${incoming.length - MAX_FILES}`,
      reason: `за один раз принимается не больше ${MAX_FILES} файлов`,
    });
  }

  // Каталог заводится ТОЛЬКО когда есть что положить: пустая партия в перечне
  // читалась бы как «загружали и потеряли».
  if (accepted.length === 0) {
    return { batch, path, accepted, rejected };
  }

  await mkdir(path, { recursive: true });

  // `wx` — «создать, а если есть, отказать». Партия названа временем и новая
  // всегда, значит существующий файл здесь означает ошибку в расчёте пути, а
  // не обычный повтор; молча перезаписать его было бы худшим из ответов.
  for (const file of payloads) {
    const target = join(path, file.name);

    // Подкаталоги партии заводятся по ходу: структура папок архива сохраняется,
    // а значит у файла может быть путь, а не только имя.
    if (dirname(target) !== path) await mkdir(dirname(target), { recursive: true });

    await writeFile(target, file.bytes, { flag: "wx" });
  }

  return { batch, path, accepted, rejected };
}

/**
 * Файлы одной партии — С ПУТЯМИ внутри неё.
 *
 * Задача требует «понимать, какой файл откуда появился». После распаковки
 * архива это знание живёт в путях: «Смета/Раздел 3/ЛСР-05.xlsx» отвечает на
 * вопрос, а «ЛСР-05.xlsx» — нет. Перечень партий показывает только их число, и
 * до этой функции путь существовал на диске и нигде больше.
 */
/** Обёртка над `readdir` с типами: нужна только затем, чтобы вывести тип. */
async function entriesOf(folder: string) {
  return readdir(folder, { withFileTypes: true });
}

export async function listBatchFiles(
  tenantId: string,
  code: string,
  batch: string,
): Promise<readonly { readonly path: string; readonly bytes: number }[]> {
  const root = batchPath(tenantId, code, batch);
  if (root === undefined) return [];

  const found: { path: string; bytes: number }[] = [];

  const walk = async (folder: string, prefix: string, depth: number): Promise<void> => {
    // Та же глубина, что у распаковки и у обхода ядра: три разных числа на один
    // предмет разошлись бы, и партия, принятая загрузкой, могла бы не прочитаться.
    if (depth > 12) return;

    // Тип берётся у самого вызова, а не через `ReturnType<typeof readdir>`:
    // у `readdir` восемь перегрузок, и `ReturnType` выбирает первую — ту, что
    // отдаёт буферы вместо строк.
    let entries: Awaited<ReturnType<typeof entriesOf>>;

    try {
      entries = await entriesOf(folder);
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = join(folder, entry.name);
      const shown = prefix === "" ? entry.name : `${prefix}/${entry.name}`;

      if (entry.isDirectory()) {
        await walk(full, shown, depth + 1);
        continue;
      }

      if (!entry.isFile()) continue;

      try {
        found.push({ path: shown, bytes: (await stat(full)).size });
      } catch {
        continue;
      }
    }
  };

  await walk(root, "", 0);

  return found.sort((left, right) => left.path.localeCompare(right.path, "ru"));
}

export interface BatchView {
  readonly batch: string;
  readonly files: number;
  readonly bytes: number;
  readonly at: Date;
}

/**
 * Партии объекта, новые сверху.
 *
 * Отсутствие каталога — не ошибка: объект, по которому ещё не загружали,
 * законен, и пустой перечень это и означает.
 */
export async function listBatches(tenantId: string, code: string): Promise<readonly BatchView[]> {
  const parent = objectPath(tenantId, code);
  if (parent === undefined) return [];

  let names: readonly string[];

  try {
    names = await readdir(parent);
  } catch {
    return [];
  }

  const views: BatchView[] = [];

  for (const name of names) {
    const path = batchPath(tenantId, code, name);
    if (path === undefined) continue;

    try {
      const info = await stat(path);
      if (!info.isDirectory()) continue;

      // Считается ПО ДЕРЕВУ: после распаковки архива файлы лежат в подпапках,
      // и плоский подсчёт показал бы «файлов 2» там, где их сто, — по числу
      // папок верхнего уровня.
      const files = await listBatchFiles(tenantId, code, name);
      const bytes = files.reduce((sum, file) => sum + file.bytes, 0);

      views.push({ batch: name, files: files.length, bytes, at: info.mtime });
    } catch {
      continue;
    }
  }

  return views.sort((left, right) => right.batch.localeCompare(left.batch));
}

/**
 * Существует ли партия — проверяется ПЕРЕД прогоном.
 *
 * Прогон принимает имя партии из формы, и без этой проверки имя из формы стало
 * бы путём к произвольному каталогу — ровно та дыра, которую этот модуль
 * закрывает.
 */
export async function batchExists(tenantId: string, code: string, batch: string): Promise<string | undefined> {
  const path = batchPath(tenantId, code, batch);
  if (path === undefined) return undefined;

  try {
    const info = await stat(path);
    return info.isDirectory() ? path : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Сколько отклонённых файлов называется В АДРЕСЕ поимённо.
 *
 * НАЙДЕНО НА КЕЙСЕ ЗАКАЗЧИКА: загрузка 53 файлов вернула **502 Bad Gateway**,
 * а в журнале nginx стояло
 *
 *   upstream sent too big header while reading response header
 *
 * Причина не в размере тела и не в таймауте: перечень отклонённых уезжал в
 * параметры адреса перенаправления, а русские имена файлов в процентной
 * кодировке занимают по шесть байт на букву. Заголовок `Location` перестал
 * влезать в буфер nginx.
 *
 * ХУЖЕ САМОГО ОТКАЗА ТО, ЧТО ФАЙЛЫ ПРИ ЭТОМ СОХРАНИЛИСЬ. Обработчик доработал
 * до конца, партия легла на диск — и клиент получил 502, не узнав ни номера
 * партии, ни того, что загрузка удалась. Молчаливый успех, выглядящий отказом.
 *
 * Поэтому перечень ОГРАНИЧЕН, а остаток НАЗВАН числом: три имени отвечают на
 * вопрос «что именно не взяли», а «и ещё N» — на вопрос «сколько всего».
 * Полный перечень остаётся в партии на диске и доступен экрану.
 */
export const REJECTED_IN_URL = 3;

/**
 * Жёсткий потолок на длину параметра «отклонено».
 *
 * Буфер заголовков ответа у nginx по умолчанию 4 КБ, и в него должен уместиться
 * ВЕСЬ заголовок, не только `Location`. Килобайт на перечень оставляет место
 * остальному с запасом.
 *
 * Потолок именно жёсткий, а не «обрежем три имени и надеемся»: длина русского
 * имени файла в процентной кодировке не ограничена ничем, и одно имя способно
 * съесть весь буфер.
 */
const REJECTED_URL_BUDGET = 1024;

/**
 * Итог загрузки в параметрах адреса — с потолком на длину.
 *
 * Отдельной функцией, а не строкой в обработчике, ровно затем, чтобы потолок
 * можно было проверить набором: заголовок, выросший сверх буфера, обнаруживается
 * не на разборе кода, а на 502 у клиента.
 *
 * УБЫВАНИЕ ПОДРОБНОСТИ, А НЕ ОБРЫВ. Сначала пробуем назвать файлы поимённо;
 * если не вмещается — только причину и число; если и это не вмещается — одно
 * число. Число отклонённых уходит ОТДЕЛЬНЫМ параметром и не теряется ни при
 * каком урезании: «сколько не взяли» — единственное, чего нельзя не сказать.
 */
export function итогЗагрузкиВАдрес(
  url: URL,
  saved: {
    readonly batch: string;
    readonly accepted: readonly unknown[];
    readonly rejected: readonly { readonly name: string; readonly reason: string }[];
  },
): void {
  url.searchParams.set("партия", saved.batch);
  url.searchParams.set("принято", String(saved.accepted.length));

  if (saved.rejected.length === 0) return;

  url.searchParams.set("не-взято", String(saved.rejected.length));

  const причины = new Set(saved.rejected.map((file) => file.reason));

  /**
   * ОДНА ПРИЧИНА НА ВСЕХ — САМЫЙ ЧАСТЫЙ СЛУЧАЙ, и он же самый расточительный
   * при построчной записи. На кейсе «Новотэкс» отклонено четыре файла одной
   * причиной в 110 знаков: повторённая четырежды в процентной кодировке, она
   * занимает больше двух килобайт и ничего не добавляет.
   */
  const имена = saved.rejected.slice(0, REJECTED_IN_URL).map((file) => file.name);
  const остаток = saved.rejected.length - имена.length;
  const хвост = остаток > 0 ? ` и ещё ${остаток}` : "";

  const варианты =
    причины.size === 1
      ? [
          `${[...причины][0]!} — ${saved.rejected.length} шт.: ${имена.join(", ")}${хвост}`,
          `${[...причины][0]!} — ${saved.rejected.length} шт.`,
        ]
      : [
          saved.rejected
            .slice(0, REJECTED_IN_URL)
            .map((file) => `${file.name} — ${file.reason}`)
            .join(" | ") + хвост,
          `причин ${причины.size}, файлов ${saved.rejected.length}: ${имена.join(", ")}${хвост}`,
          `причин ${причины.size}, файлов ${saved.rejected.length}`,
        ];

  for (const вариант of варианты) {
    if (encodeURIComponent(вариант).length <= REJECTED_URL_BUDGET) {
      url.searchParams.set("отклонено", вариант);
      return;
    }
  }

  // Ни один вариант не влез: остаётся число, и оно уже записано выше отдельным
  // параметром. Экран скажет «не взято N» и отправит за подробностями в партию.
  url.searchParams.set("отклонено", "перечень не помещается в адрес — см. партию");
}
