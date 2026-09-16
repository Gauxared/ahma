import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Склейка классов: `clsx` для условий, `twMerge` для конфликтов утилит.
 *
 * Порядок важен. Без `twMerge` вызов `cn("p-2", "p-4")` оставил бы оба класса, и
 * победил бы тот, что раньше в собранном CSS, — то есть результат зависел бы от
 * порядка правил в бандле, а не от порядка аргументов. Это ровно тот вид
 * зависимости от случая, который потом ловится «почему на проде другой отступ».
 */
export function cn(...values: ClassValue[]): string {
  return twMerge(clsx(values));
}
