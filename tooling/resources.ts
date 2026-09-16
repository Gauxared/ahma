/**
 * Предохранитель ресурсов: что запущено рядом и хватит ли памяти.
 *
 * ЗАЧЕМ ЭТО ПОЯВИЛОСЬ
 *
 * 5 сентября 2026 на машине владельца `systemd-oomd` убил **GNOME Shell** — то
 * есть весь рабочий стол со всеми окнами. Причина в журнале дословно: давление
 * памяти на пользовательский слайс 71,03 % при пороге 50 % дольше двадцати
 * секунд. Убийца выбирает жертву по давлению, а не по вине: наши процессы
 * выжили, а окна пользователя закрылись.
 *
 * Что к этому привело — замерено, а не предположено:
 *
 * | Вкладчик | Пик |
 * |---|---|
 * | `pnpm test:all` без потолка форков | **7,4 ГБ** (семь форков vitest) |
 * | Chrome владельца | 7,8 ГБ |
 * | рабочий стол | 1,9 ГБ |
 * | сервер разработки, оставленный запущенным | 0,9 ГБ |
 * | воркеры, которых я расплодил до восьми штук | 0,3 ГБ каждый |
 *
 * Потолок форков закрыт в `vitest.config.ts` (7,4 → 4,1 ГБ суммарно, из них
 * наших около двух). Здесь закрывается второе: **тяжёлое, запущенное поверх
 * уже работающего тяжёлого.** Я запускал наборы, не остановив сервер
 * разработки и воркер, и делал это неоднократно.
 *
 * ПОЧЕМУ ПРЕДУПРЕЖДЕНИЕ, А НЕ ЗАПРЕТ
 *
 * Запрет, срабатывающий не вовремя, обходят — и тогда он перестаёт работать
 * совсем. Здесь отказ наступает ТОЛЬКО при явной опасности: мало свободной
 * памяти. Соседние процессы называются всегда, но лишь как сведение: бывает,
 * что сервер нужен именно во время прогона.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readlinkSync } from "node:fs";

/** Сколько памяти считаем достаточным для прогона наборов. */
const NEED_MB = Number.parseInt(process.env["STROYINTELLECT_NEED_MB"] ?? "4096", 10);

export interface Neighbour {
  readonly pid: number;
  readonly rssMb: number;
  readonly what: string;
  /**
   * Процесс запущен ИЗ ЭТОГО дерева, а не из контейнера или соседнего проекта.
   *
   * Различать обязательно: контейнерные воркеры `si-demo` работают со своей
   * базой и своим кодом, и советовать их закрыть значило бы советовать сломать
   * чужой стенд. Гасит `pnpm стоп` только своё.
   */
  readonly ours: boolean;
}

/** Доступная память в мегабайтах — из `MemAvailable`, а не из «свободной». */
export function availableMb(meminfo = readFileSync("/proc/meminfo", "utf8")): number {
  const line = meminfo.split("\n").find((row) => row.startsWith("MemAvailable:"));
  const kb = Number.parseInt((line ?? "").replace(/\D+/g, ""), 10);

  // Неизвестно — не повод отказывать: на машине без `/proc` предохранитель
  // молчит, а не блокирует работу.
  return Number.isFinite(kb) ? Math.round(kb / 1024) : Number.POSITIVE_INFINITY;
}

/**
 * Наши тяжёлые процессы, запущенные рядом.
 *
 * Ищутся ПО КОМАНДНОЙ СТРОКЕ, а не по имени: все они — `node`, и по имени
 * неотличимы ни друг от друга, ни от редактора.
 */
/** Рабочий каталог процесса. Пусто — процесс чужой либо уже завершился. */
function cwdOf(pid: number): string {
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return "";
  }
}

export function neighbours(ps = psOutput(), root = process.cwd()): readonly Neighbour[] {
  const known: readonly (readonly [RegExp, string])[] = [
    [/next dev/, "сервер разработки (pnpm dev:web)"],
    [/next start|next-server/, "собранное приложение (pnpm start:web)"],
    [/apps\/worker\/src\/main/, "воркер (pnpm worker)"],
    [/vitest/, "прогон юнит-наборов"],
    [/playwright/, "сквозные наборы"],
  ];

  const found: Neighbour[] = [];

  for (const row of ps.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(row);
    if (match === null) continue;

    const [, pid, rss, args] = match;
    // Свой собственный процесс соседом не считается: иначе предохранитель
    // сообщал бы о самом себе и требовал себя же закрыть.
    if (Number(pid) === process.pid) continue;

    const what = known.find(([pattern]) => pattern.test(args ?? ""))?.[1];
    if (what === undefined) continue;

    const cwd = cwdOf(Number(pid));

    found.push({
      pid: Number(pid),
      rssMb: Math.round(Number(rss) / 1024),
      what,
      ours: cwd === root || cwd.startsWith(`${root}/`),
    });
  }

  return found;
}

function psOutput(): string {
  try {
    return execFileSync("ps", ["-eo", "pid=,rss=,args="], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  } catch {
    return "";
  }
}

/**
 * Решение предохранителя.
 *
 * Отказ — только по памяти. Соседи называются всегда: знать, что рядом
 * работает сервер разработки, полезно и когда памяти хватает, — именно он
 * делал наборы недостоверными (`Ф-49`).
 */
export function guard(available: number, near: readonly Neighbour[], need = NEED_MB): {
  readonly ok: boolean;
  readonly lines: readonly string[];
} {
  const lines: string[] = [];

  const ours = near.filter((item) => item.ours);
  const alien = near.filter((item) => !item.ours);

  if (ours.length > 0) {
    lines.push("  Из этого дерева уже работает:");
    for (const item of ours) {
      lines.push(`    · ${item.what} — ${item.rssMb} МБ, pid ${item.pid}`);
    }
    lines.push("  Остановить своё: pnpm стоп");
  }

  if (alien.length > 0) {
    // Названы, но не предложены к остановке: это контейнеры и соседние
    // деревья. Они едят ту же память, и знать о них надо; трогать — нет.
    const total = alien.reduce((bytes, item) => bytes + item.rssMb, 0);
    lines.push(`  Вне этого дерева (контейнеры, соседние проекты): ${alien.length} шт., ${total} МБ — не трогаем.`);
  }

  if (available < need) {
    lines.push(
      "",
      `  ОТКАЗ: доступно ${available} МБ, нужно ${need} МБ.`,
      "  5 сентября при нехватке памяти systemd-oomd убил рабочий стол владельца —",
      "  не наш процесс, а GNOME Shell со всеми окнами. Прогон поверх занятой памяти",
      "  стоит дороже, чем ожидание.",
      `  Порог снимается переменной STROYINTELLECT_NEED_MB (сейчас ${need}).`,
    );

    return { ok: false, lines };
  }

  lines.push(`  Доступно памяти: ${available} МБ при пороге ${need}.`);

  return { ok: true, lines };
}

/**
 * Остановка своего.
 *
 * Гасит ТОЛЬКО процессы этого дерева. Контейнеры и соседние проекты остаются:
 * `pnpm стоп`, который тушит чужой стенд, применяют один раз и дальше боятся.
 *
 * Сначала `SIGTERM`: воркер умеет дорабатывать текущую задачу и говорит об
 * этом в журнал. `SIGKILL` — вторым заходом и только тем, кто не ушёл: убить
 * воркер посреди записи артефакта значит оставить прогон без результата,
 * который он уже получил и за который заплачено обращениями к модели.
 */
export async function stopOurs(): Promise<readonly string[]> {
  const ours = neighbours().filter((item) => item.ours);

  if (ours.length === 0) return ["Из этого дерева ничего не запущено."];

  const lines: string[] = [];

  for (const item of ours) {
    try {
      process.kill(item.pid, "SIGTERM");
      lines.push(`  остановлен: ${item.what}, pid ${item.pid} (${item.rssMb} МБ)`);
    } catch {
      lines.push(`  уже завершился: ${item.what}, pid ${item.pid}`);
    }
  }

  // Пять секунд на добровольный уход. Воркеру этого хватает: он проверяет
  // сигнал между шагами, а не в середине обращения к модели.
  await new Promise((resolve) => setTimeout(resolve, 5000));

  const упрямые = neighbours().filter((item) => item.ours);

  for (const item of упрямые) {
    try {
      process.kill(item.pid, "SIGKILL");
      lines.push(`  ДОБИТ (не ушёл за пять секунд): ${item.what}, pid ${item.pid}`);
    } catch {
      // Ушёл между двумя проверками — обычное дело, сообщать не о чем.
    }
  }

  return lines;
}

if (process.argv[1]?.endsWith("resources.ts") === true) {
  if (process.argv.includes("--стоп")) {
    const lines = await stopOurs();
    process.stdout.write(`Остановка процессов этого дерева:\n${lines.join("\n")}\n`);
  } else {
    const near = neighbours();
    const decision = guard(availableMb(), near);

    process.stdout.write(`Ресурсы перед прогоном:\n${decision.lines.join("\n")}\n`);
    process.exit(decision.ok ? 0 : 1);
  }
}
