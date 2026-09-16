/**
 * Проверка схемы на совместимость со строгим structured output.
 *
 * Измерено на настоящем endpoint 24.08.2026: в режиме `strict: true` провайдер
 * отвергает схему, если хотя бы одно свойство из `properties` отсутствует
 * в `required`, — необязательных полей не существует. Отказ приходит как 400
 * во время прогона.
 *
 * Девять агентских схем в M1 напорются на это девять раз, поэтому проверяем
 * заранее и падаем на тесте, а не на исполнении. Необязательность выражается
 * типом-объединением с `null`, а не отсутствием в `required`.
 */
export interface SchemaProblem {
  readonly path: string;
  readonly message: string;
}

interface SchemaNode {
  readonly type?: unknown;
  readonly properties?: Record<string, unknown>;
  readonly required?: unknown;
  readonly additionalProperties?: unknown;
  readonly items?: unknown;
}

export function findStrictSchemaProblems(schema: unknown, path = "<корень>"): readonly SchemaProblem[] {
  if (typeof schema !== "object" || schema === null) {
    return [];
  }

  const node = schema as SchemaNode;
  const problems: SchemaProblem[] = [];

  if (node.type === "object") {
    const properties = node.properties ?? {};
    const names = Object.keys(properties);
    const required = Array.isArray(node.required) ? node.required.map(String) : [];

    if (node.additionalProperties !== false) {
      problems.push({ path, message: "нужен additionalProperties: false" });
    }

    const missing = names.filter((name) => !required.includes(name));
    if (missing.length > 0) {
      problems.push({
        path,
        message:
          `в required отсутствуют свойства: ${missing.join(", ")}. ` +
          "В строгом режиме необязательных полей нет — используйте объединение с null",
      });
    }

    for (const [name, child] of Object.entries(properties)) {
      problems.push(...findStrictSchemaProblems(child, `${path}.${name}`));
    }
  }

  if (node.type === "array" && node.items !== undefined) {
    problems.push(...findStrictSchemaProblems(node.items, `${path}[]`));
  }

  return problems;
}

export function assertStrictSchema(schema: unknown, name = "схема"): void {
  const problems = findStrictSchemaProblems(schema);

  if (problems.length > 0) {
    const lines = problems.map((problem) => `  ${problem.path}: ${problem.message}`);
    throw new Error(`${name} несовместима со строгим structured output:\n${lines.join("\n")}`);
  }
}
