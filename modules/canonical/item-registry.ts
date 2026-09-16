/**
 * Справочник канонических позиций (ADR-R-013).
 *
 * Канонизация идёт двумя путями, и смешивать их нельзя:
 *
 *   кодовый  — по шифру ФЕР/ГЭСН/ФССЦ. Детерминированный, без модели.
 *              На курганском комплекте закрывает 97 позиций из 101.
 *   текстовый — по наименованию, для КП подрядчиков, где шифров нет вовсе.
 *              Требует модели, уверенности и подтверждения человеком.
 *
 * Здесь реализован кодовый. Текстовый — задача M5, но справочник у них общий:
 * оба пути ведут к одному `CanonicalItem`, иначе сравнение сметы с КП не сойдётся.
 */
import type { CanonicalItem, ItemCode } from "@contracts/index.js";

function codeKey(code: ItemCode): string {
  return `${code.system}:${code.code.trim().toLowerCase()}`;
}

export class CanonicalItemRegistry {
  readonly #byId = new Map<string, CanonicalItem>();
  readonly #byCode = new Map<string, CanonicalItem>();

  add(item: CanonicalItem): void {
    if (this.#byId.has(item.id)) {
      throw new Error(`Каноническая позиция ${item.id} уже есть в справочнике`);
    }

    for (const code of item.codes) {
      const key = codeKey(code);
      const owner = this.#byCode.get(key);

      if (owner !== undefined) {
        throw new Error(
          `Шифр ${code.system} ${code.code} уже закреплён за позицией ${owner.id}: ` +
            "один шифр не может указывать на две канонические позиции",
        );
      }
    }

    this.#byId.set(item.id, item);
    for (const code of item.codes) {
      this.#byCode.set(codeKey(code), item);
    }
  }

  findById(id: string): CanonicalItem | undefined {
    return this.#byId.get(id);
  }

  findByCode(code: ItemCode): CanonicalItem | undefined {
    return this.#byCode.get(codeKey(code));
  }

  get size(): number {
    return this.#byId.size;
  }

  all(): readonly CanonicalItem[] {
    return [...this.#byId.values()];
  }
}
