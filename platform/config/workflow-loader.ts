/**
 * Загрузка воркфлоу из конфигурации (M2).
 *
 * Утверждение, которое этот модуль делает проверяемым: **воркфлоу — это данные,
 * а не код**. Такты, порядок шагов и предусловия лежат в `config/workflows/*.json`
 * и меняются без пересборки. Второй воркфлоу (`estimate-only`) существует ровно
 * затем, чтобы это доказать: один воркфлоу не доказывает ничего.
 *
 * Схема строгая намеренно. Три вещи отвергаются, потому что каждая при
 * исполнении выглядит успехом:
 *
 *  · предусловие не в форме «предмет:статус» — при разборе молча не сработает
 *    и шаг пройдёт без гейта;
 *  · воркфлоу без тактов — пройдёт мгновенно и отчитается завершённым;
 *  · такт без шагов — пропустится и будет засчитан пройденным.
 *
 * Fail closed (ADR-R-014): ошибка конфигурации останавливает сборку.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { loadBundle } from "./bundle-loader.js";
import type { LoadedBundle } from "./bundle-loader.js";

/** Предусловие вида «предмет:статус» либо «предмет:статус|статус». */
const PRECONDITION = /^[^:\s]+:[^:\s]+$/;

const stepSchema = z.object({
  agent: z.string().min(1),
  produces: z.array(z.string().min(1)),
  requires: z.array(
    z
      .string()
      .regex(PRECONDITION, "предусловие должно иметь вид «предмет:статус»"),
  ),
});

const stageSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  // Пустой такт при исполнении пропускается и выглядит пройденным.
  steps: z.array(stepSchema).min(1, "такт без шагов пройдёт молча и будет засчитан"),
});

export const workflowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Откуда перенесён протокол. Нужен, чтобы правку можно было сверить с оригиналом. */
  source: z.string().optional(),
  note: z.string().optional(),
  maxRework: z.number().int().nonnegative().default(2),
  stages: z.array(stageSchema).min(1, "воркфлоу без тактов завершится мгновенно и отчитается успехом"),
});

export type WorkflowDefinition = z.infer<typeof workflowSchema>;

export function loadWorkflow(path: string): LoadedBundle<WorkflowDefinition> {
  return loadBundle(path, workflowSchema);
}

/**
 * Читает все воркфлоу каталога. Порядок — по имени файла, чтобы состав реестра
 * не зависел от порядка обхода файловой системы.
 */
export function loadWorkflows(directory: string): readonly LoadedBundle<WorkflowDefinition>[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => loadWorkflow(join(directory, name)));
}

/** Схема таблицы маршрута приёма (ADR-R-012). */
const routeRuleSchema = z.object({
  id: z.string().min(1),
  when: z.object({
    domain: z.string().optional(),
    side: z.string().optional(),
    stage: z.string().optional(),
    volume: z.string().optional(),
    goal: z.string().optional(),
  }),
  configuration: z.string().min(1),
  agent: z.string().min(1),
  criterion: z.string().min(1),
  note: z.string().optional(),
});

export const routingSchema = z.object({
  source: z.string().optional(),
  note: z.string().optional(),
  configurations: z.record(z.string(), z.string()).optional(),
  routes: z.array(routeRuleSchema).min(1),
  requiredForRoute: z.array(z.string().min(1)).min(1),
});

export type RoutingConfig = z.infer<typeof routingSchema>;

export function loadRouting(path: string): LoadedBundle<RoutingConfig> {
  return loadBundle(path, routingSchema);
}

/** Схема приёмочного чек-листа агента (ТЗ §12.2). */
export const checklistSchema = z.object({
  agent: z.string().min(1),
  title: z.string().min(1),
  source: z.string().optional(),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        requirement: z.string().min(1),
        /** Пункт без способа проверки — пожелание, а не критерий приёмки. */
        howToCheck: z.string().min(1),
      }),
    )
    .min(1, "чек-лист без пунктов принял бы агента непроверенным"),
});

export type ChecklistConfig = z.infer<typeof checklistSchema>;

export function loadChecklists(directory: string): readonly LoadedBundle<ChecklistConfig>[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => loadBundle(join(directory, name), checklistSchema));
}
