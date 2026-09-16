/**
 * Неизменяемый снапшот Проверки (M2, ADR-R-024, ADR-R-027).
 *
 * Записывает НЕ состав опорной базы, а хэши того, что прогон реально
 * использовал: документы объекта, конфигурационные бандлы, версии операций и
 * формул, промпты агентов, модели, разрешённые разделы знания и объявленные
 * деградации.
 *
 * Почему так, а не копией базы (ADR-R-027): база растёт и сужается, и снимок
 * её состава делал бы каждое расширение событием, затрагивающим прошлые
 * прогоны. Контентная адресация этого не требует — прошлый прогон ссылается на
 * версии записей по хэшу и остаётся воспроизводимым.
 *
 * ЧТО ЗДЕСЬ ПРОВЕРЯЕМО, А В ЛЕГАСИ БЫЛО НА ЧЕСТНОМ СЛОВЕ
 *
 * Утверждение «повтор прогона даёт тот же ответ» в оригинале ничем не
 * подкреплено: Claude Desktop над папкой не фиксирует ни версий промптов, ни
 * состава базы, и два прогона на одних документах могут разойтись незаметно.
 * Здесь утверждение сведено к ОДНОМУ сравнению строк: `snapshotDigest`.
 *
 * ДВА РЕШЕНИЯ, БЕЗ КОТОРЫХ ОТПЕЧАТОК БЕСПОЛЕЗЕН
 *
 * 1. Время прогона в отпечаток НЕ входит. Иначе повтор никогда не совпадёт сам
 *    с собой, и проверять станет нечего. Время хранится в снапшоте отдельно:
 *    отпечаток отвечает «те же ли входы», снапшот — ещё и «когда это было».
 *
 * 2. Деградации входят в отпечаток. Прогон без каталога позиций и прогон с ним
 *    дают разные результаты; если деградация не учтена, они выглядят
 *    одинаковыми, и отпечаток начинает лгать ровно там, где он нужнее всего.
 */
import { createHash } from "node:crypto";

export interface HashedInput {
  readonly path: string;
  readonly contentHash: string;
}

export interface VersionedComponent {
  readonly id: string;
  readonly version: number;
}

export interface PromptRef {
  readonly agent: string;
  readonly contentHash: string;
}

export interface ModelRef {
  readonly provider: string;
  readonly model: string;
}

export interface DegradationRef {
  readonly capability: string;
  readonly reason: string;
}

export interface SnapshotInput {
  readonly objectPath: string;
  readonly producedAt: string;
  readonly documents: readonly HashedInput[];
  readonly configs: readonly HashedInput[];
  readonly operations: readonly VersionedComponent[];
  readonly formulas: readonly VersionedComponent[];
  readonly prompts: readonly PromptRef[];
  readonly models: readonly ModelRef[];
  /** Разделы знания, разрешённые в прогоне (ADR-R-024). */
  readonly knowledgeScope: readonly string[];
  readonly degradations: readonly DegradationRef[];
}

export interface CheckSnapshot extends SnapshotInput {
  /** Версия формы снапшота: её изменение меняет смысл отпечатка. */
  readonly snapshotVersion: number;
}

export const SNAPSHOT_VERSION = 1 as const;

/**
 * Приводит снапшот к каноническому виду.
 *
 * Порядок обхода Map и файловой системы не должен просачиваться в отпечаток:
 * иначе «тот же прогон» перестаёт быть тем же на другой машине. Всё
 * сортируется, и сортировка — часть контракта, а не деталь реализации.
 */
export function buildSnapshot(input: SnapshotInput): CheckSnapshot {
  const byPath = (a: HashedInput, b: HashedInput): number => a.path.localeCompare(b.path);
  const byId = (a: VersionedComponent, b: VersionedComponent): number => a.id.localeCompare(b.id);

  return {
    snapshotVersion: SNAPSHOT_VERSION,
    objectPath: input.objectPath,
    producedAt: input.producedAt,
    documents: [...input.documents].sort(byPath),
    configs: [...input.configs].sort(byPath),
    operations: [...input.operations].sort(byId),
    formulas: [...input.formulas].sort(byId),
    prompts: [...input.prompts].sort((a, b) => a.agent.localeCompare(b.agent)),
    models: [...input.models].sort((a, b) => `${a.provider}/${a.model}`.localeCompare(`${b.provider}/${b.model}`)),
    knowledgeScope: [...input.knowledgeScope].sort((a, b) => a.localeCompare(b)),
    degradations: [...input.degradations].sort((a, b) => a.capability.localeCompare(b.capability)),
  };
}

/**
 * Отпечаток входов прогона.
 *
 * Отвечает ровно на один вопрос: «тот ли это набор входов». Совпадение
 * отпечатков означает, что повтор обязан дать тот же результат; расхождение
 * называет, что прогоны различны, но не говорит чем — для этого есть сам
 * снапшот.
 *
 * `objectPath` и `producedAt` в отпечаток не входят: одна и та же папка,
 * переложенная в другое место, — это те же документы, а время прогона к
 * входам не относится.
 */
export function snapshotDigest(snapshot: CheckSnapshot): string {
  const canonical = {
    snapshotVersion: snapshot.snapshotVersion,
    documents: snapshot.documents.map((item) => [item.path.split("/").pop(), item.contentHash]),
    configs: snapshot.configs.map((item) => [item.path, item.contentHash]),
    operations: snapshot.operations.map((item) => [item.id, item.version]),
    formulas: snapshot.formulas.map((item) => [item.id, item.version]),
    prompts: snapshot.prompts.map((item) => [item.agent, item.contentHash]),
    models: snapshot.models.map((item) => [item.provider, item.model]),
    knowledgeScope: snapshot.knowledgeScope,
    degradations: snapshot.degradations.map((item) => [item.capability, item.reason]),
  };

  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}
