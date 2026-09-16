/**
 * Журнал обращений к моделям — ТЗ §12.1л, ADR-R-020.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ЖУРНАЛ, ЕСЛИ ЕСТЬ ЗАПИСИ ШЛЮЗА
 *
 * Записи egress-шлюза в `audit_event` отвечают на вопрос «КУДА ходили»: имя
 * хоста, разрешено или нет, причина. Регламент передачи данных спрашивает
 * другое — КАКОЙ процесс, какие классы данных, было ли обезличивание, сколько
 * токенов. По имени хоста на это не ответить.
 *
 * ТЗ дословно: «обращение к внешним моделям происходит только по процессам
 * Регламента и только после анонимизации, ЧТО ПОДТВЕРЖДАЕТСЯ ЗАПИСЯМИ
 * ЖУРНАЛА». Подтверждать было нечем: таблица `model_call` существовала с M0 и
 * не заполнялась.
 *
 * ПОЧЕМУ ТАБЛИЦА, А НЕ ЖУРНАЛ В ПАМЯТИ
 *
 * До этого был `InMemoryCallJournal` со сводкой по процессам. Сводка для
 * Регламента строится по ВСЕЙ истории обращений, а журнал в памяти знал только
 * текущий процесс: перезапущенный воркер отчитывался бы за неполный период и
 * выглядел бы при этом исправным. Предъявлять такую сводку нельзя.
 *
 * ЗАПИСЬ ПРОВЕРЯЕТСЯ ПЕРЕД СОХРАНЕНИЕМ, И ЭТО НЕ ДУБЛИРОВАНИЕ ШЛЮЗА
 *
 * Шлюз — это ворота: он не пускает конфиденциальное наружу без обезличивания.
 * Здесь проверяется САМА ЗАПИСЬ: если в журнал пришло «внешний контур,
 * коммерческая тайна, без обезличивания», то либо у шлюза дефект, либо кто-то
 * обошёл его стороной. Молча записать такую строку значило бы задокументировать
 * нарушение и не заметить его.
 *
 * Та же мысль, что в анонимизаторе, который перечитывает собственный вывод:
 * механизм, проверяющий только вход, не находит собственных ошибок.
 */
import { checkExternalCall } from "../runtime/call-journal.js";
import type { CollectedModelCall } from "../runtime/call-journal.js";

import type { Tx } from "./prisma.js";

/** Сводка по процессам внешнего контура — основа Регламента передачи данных. */
export interface ExternalProcessSummary {
  readonly process: string;
  readonly calls: number;
  readonly dataClasses: readonly string[];
  /** Сколько обращений прошло БЕЗ обезличивания. Обязано быть нулём (§12.1л). */
  readonly withoutAnonymization: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export class ModelCallRepository {
  /**
   * Записывает обращение.
   *
   * Противоречивая запись — отказ, а не строка в журнале. Журнал, в котором
   * зафиксировано нарушение §12.1л, не отчётность, а улика; и если она попала
   * туда молча, значит нарушение уже случилось незамеченным.
   */
  async record(tx: Tx, tenantId: string, call: CollectedModelCall): Promise<{ readonly id: string }> {
    const rejection = checkExternalCall({ ...call, tenantId });

    if (rejection !== undefined) {
      throw new Error(
        `Журнал обращений отклонил запись: процесс ${rejection.process} передаёт класс данных ` +
          `${rejection.dataClass} во внешний контур без обезличивания (ТЗ §8.3, §12.1л). ` +
          "Либо egress-шлюз пропустил то, что не должен был, либо обращение прошло мимо него.",
      );
    }

    const created = await tx.modelCall.create({
      data: {
        tenantId,
        process: call.process,
        operationId: call.operationId,
        contour: call.contour,
        provider: call.provider,
        model: call.model,
        dataClasses: [...call.dataClasses],
        anonymized: call.anonymized,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        at: new Date(call.at),
      },
    });

    return { id: created.id };
  }

  /**
   * Сводка обращений во ВНЕШНИЙ контур по процессам.
   *
   * Внутренние обращения сюда не входят: Регламент передачи данных — о том, что
   * покидает контур. Смешать их значило бы раздуть отчёт вызовами к локальной
   * модели, которые ничего не передают наружу.
   */
  async externalProcesses(tx: Tx): Promise<readonly ExternalProcessSummary[]> {
    const calls = await tx.modelCall.findMany({
      where: { contour: "external" },
      select: {
        process: true,
        dataClasses: true,
        anonymized: true,
        inputTokens: true,
        outputTokens: true,
      },
    });

    const byProcess = new Map<string, ExternalProcessSummary & { classes: Set<string> }>();

    for (const call of calls) {
      const existing = byProcess.get(call.process) ?? {
        process: call.process,
        calls: 0,
        dataClasses: [],
        withoutAnonymization: 0,
        inputTokens: 0,
        outputTokens: 0,
        classes: new Set<string>(),
      };

      for (const dataClass of call.dataClasses) existing.classes.add(dataClass);

      byProcess.set(call.process, {
        ...existing,
        calls: existing.calls + 1,
        withoutAnonymization: existing.withoutAnonymization + (call.anonymized ? 0 : 1),
        inputTokens: existing.inputTokens + call.inputTokens,
        outputTokens: existing.outputTokens + call.outputTokens,
      });
    }

    return [...byProcess.values()].map(({ classes, ...summary }) => ({
      ...summary,
      dataClasses: [...classes].sort((a, b) => a.localeCompare(b, "ru")),
    }));
  }
}
