/**
 * Манифест расширения (ADR-R-017).
 *
 * Каждое расширение декларирует не только «что я умею», но и **контур, классы
 * данных, точки выхода наружу и требуемые права**. Без этой декларации
 * расширяемость и §8.3 противоречат друг другу: «подключить внешний API»
 * превращается в дыру в контуре данных.
 *
 * Реестр валидирует манифест схемой при старте и ведёт себя fail-closed:
 * невалидное или несовместимое расширение не регистрируется, а не пропускается
 * молча.
 */
import { z } from "zod";

/**
 * Виды расширений. Первые пять — реестры из ADR-R-023: роль, процедура, функция,
 * атом исполнения, композиция. Остальные — адаптеры внешнего мира.
 */
export const EXTENSION_KINDS = [
  "agent",
  "skill",
  "tool",
  "operation",
  "workflow",
  "parser",
  "exporter",
  "integration",
  "model-provider",
  "ocr",
  "knowledge-source",
] as const;

export type ExtensionKind = (typeof EXTENSION_KINDS)[number];

/** ТЗ §6.1: внутренний контур — режим по умолчанию. */
export const CONTOURS = ["internal", "external"] as const;
export type Contour = (typeof CONTOURS)[number];

/**
 * Классы данных, которыми оперирует расширение. Нужны, чтобы решать, требуется ли
 * анонимизация перед выходом во внешний контур (ТЗ §8.3).
 */
export const DATA_CLASSES = [
  "public",
  "object_meta",
  "positions",
  "prices",
  "contract_terms",
  "customer_identity",
  "commercial_secret",
] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

/** Классы, которые нельзя выпускать во внешний контур в исходном виде (ТЗ §8.3). */
const CONFIDENTIAL: ReadonlySet<DataClass> = new Set<DataClass>([
  "commercial_secret",
  "customer_identity",
  "contract_terms",
]);

export function isConfidential(dataClass: DataClass): boolean {
  return CONFIDENTIAL.has(dataClass);
}

export const egressSchema = z.object({
  destinations: z.array(z.string().min(1)).min(1),
  purpose: z.string().min(1),
});

export const extensionManifestSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  kind: z.enum(EXTENSION_KINDS),
  /** Версия контракта, который расширение реализует, например "1.0.0". */
  implements: z.string().min(1),
  contour: z.enum(CONTOURS).default("internal"),
  dataClasses: z.array(z.enum(DATA_CLASSES)).default([]),
  egress: egressSchema.optional(),
  requiresPermissions: z.array(z.string().min(1)).default([]),
  /** Способности, которые расширение предоставляет (ADR-R-026). */
  provides: z.array(z.string().min(1)).default([]),
});

export type ExtensionManifest = z.infer<typeof extensionManifestSchema>;

export const extensionBundleSchema = z.object({
  extensions: z.array(extensionManifestSchema).min(1),
});

export type ExtensionBundle = z.infer<typeof extensionBundleSchema>;
