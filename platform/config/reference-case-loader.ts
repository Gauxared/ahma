/**
 * Загрузка эталонного случая — пары «вход, по которому у легаси есть выход».
 *
 * Схема строгая по той же причине, что у воркфлоу: ожидание без источника —
 * выдумка, а замер, построенный на выдумке, показывает паритет там, где его
 * нет. Поэтому `source` обязателен и непуст, а `about` обязан содержать хотя бы
 * одно слово: без него совпадение суммы засчитается вслепую.
 */
import { z } from "zod";

import type { ReferenceCase } from "@modules/eval/reference-case.js";

import { loadBundle } from "./bundle-loader.js";
import type { LoadedBundle } from "./bundle-loader.js";

const DECIMAL = /^-?\d+(?:\.\d+)?$/;

export const referenceCaseSchema = z.object({
  id: z.string().min(1),
  object: z.string().min(1),
  reference: z.string().min(1),
  note: z.string().optional(),
  expectations: z
    .array(
      z.object({
        id: z.string().min(1),
        claim: z.string().min(1),
        amount: z.string().regex(DECIMAL, "сумма ожидания должна быть десятичной строкой"),
        source: z
          .string()
          .min(1, "ожидание без указания места в эталоне — выдумка, а не ожидание"),
        about: z
          .array(z.string().min(1))
          .min(1, "без признака предмета совпадение суммы засчиталось бы вслепую"),
        tolerance: z.string().regex(DECIMAL).optional(),
      }),
    )
    .min(1, "эталонный случай без ожиданий измерил бы ноль и отчитался бы стопроцентным"),
});

export function loadReferenceCase(path: string): LoadedBundle<ReferenceCase> {
  return loadBundle(path, referenceCaseSchema) as LoadedBundle<ReferenceCase>;
}
