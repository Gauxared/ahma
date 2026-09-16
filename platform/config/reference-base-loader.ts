/**
 * Чтение опорных баз агентов из смонтированной папки заказчика.
 *
 * ПОЧЕМУ ЗДЕСЬ, А НЕ В МОДУЛЕ
 *
 * Доступ к диску — свойство платформы. Модуль `modules/agents/reference-base.ts`
 * знает ФОРМУ базы и умеет её показать; читает файл платформа. Та же граница,
 * что у портов Проверки.
 *
 * ПОЧЕМУ ЧТЕНИЕ НЕ ПАДАЕТ, КОГДА КНИГИ НЕТ
 *
 * Книги — документы заказчика (ТЗ §11, ADR-R-021), они монтируются и в поставку
 * не входят. Разработчик, склонировавший репозиторий, их не увидит, и сборка
 * обязана подняться без них. Отсутствие базы — не ошибка конфигурации, а
 * объявленная деградация: режим `[БЕЗ БАЗЫ]` самого легаси.
 *
 * Это НЕ противоречит fail-closed (ADR-R-014): закрыто то, что должно быть
 * закрыто — неверно ЗАПОЛНЕННАЯ конфигурация. Отсутствующий документ заказчика
 * конфигурацией не является.
 */
import { existsSync } from "node:fs";

import { parseReferenceSheet, type ReferenceBase, type ReferenceSheet } from "@modules/agents/reference-base.js";

import { fileContentHash, listXlsxSheets, readXlsxSheet } from "../storage/xlsx-reader.js";

/**
 * Читает из книги только листы, прошедшие отбор по имени — так из Единой базы
 * (120 листов с префиксами `АРТ·`, `ЛЮД·`, `00·`…) роль получает свои листы, а
 * Дирижёр — листы памяти 00–09, и никто не тащит чужие 100 листов в окно.
 */
export async function loadReferenceBaseSheets(path: string, keep: (sheetName: string) => boolean): Promise<ReferenceBase | undefined> {
  if (!existsSync(path)) return undefined;

  const source = path.split("/").filter(Boolean).pop() ?? path;
  const contentHash = await fileContentHash(path);
  const sheets: ReferenceSheet[] = [];

  for (const name of await listXlsxSheets(path)) {
    if (!keep(name) || /навигатор/i.test(name)) continue;
    const sheet = await readXlsxSheet(path, { sheetName: name });
    const rows = [...sheet.rows.keys()]
      .sort((a, b) => a - b)
      .map((rowNumber) => {
        const cells = sheet.rows.get(rowNumber)!;
        return [...cells.keys()]
          .sort((a, b) => a.localeCompare(b))
          .map((column) => cells.get(column) ?? "");
      });
    sheets.push(parseReferenceSheet(sheet.name, rows));
  }

  return sheets.length === 0 ? undefined : { source, contentHash, sheets };
}

/**
 * Читает книгу целиком: все листы, кроме навигатора.
 *
 * Навигатор — карта самой книги, знания в нём нет; для агента это шум, который
 * занимает место в окне.
 */
export async function loadReferenceBase(path: string): Promise<ReferenceBase | undefined> {
  if (!existsSync(path)) return undefined;

  const source = path.split("/").filter(Boolean).pop() ?? path;
  const contentHash = await fileContentHash(path);
  const sheets: ReferenceSheet[] = [];

  /**
   * ЛИСТЫ БЕРУТСЯ СПИСКОМ, А НЕ ПЕРЕБОРОМ ПО ИНДЕКСУ С ОБРЫВОМ НА СОРОК ПЕРВОМ.
   *
   * Прежний цикл заканчивался `if (index > 40) break`. У Единой базы 120
   * вкладок — восемьдесят не читались никогда, и ничто об этом не сообщало:
   * книга выглядела прочитанной. Требование Т12 — вся база в системе.
   */
  for (const name of await listXlsxSheets(path)) {
    if (/навигатор/i.test(name)) continue;

    let sheet;

    try {
      sheet = await readXlsxSheet(path, { sheetName: name });
    } catch {
      continue;
    }

    const rows = [...sheet.rows.keys()]
      .sort((a, b) => a - b)
      .map((rowNumber) => {
        const cells = sheet.rows.get(rowNumber)!;
        return [...cells.keys()]
          .sort((a, b) => a.localeCompare(b))
          .map((column) => cells.get(column) ?? "");
      });

    sheets.push(parseReferenceSheet(sheet.name, rows));
  }

  return { source, contentHash, sheets };
}
