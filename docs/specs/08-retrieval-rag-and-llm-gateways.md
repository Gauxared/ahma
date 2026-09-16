---
title: "СтройИнтеллект: retrieval, RAG и LLM gateways"
date_created: 2026-08-05
updated: 2026-08-05
type: spec
status: superseded
layer: system
horizon: delivery
scope: retrieval-rag-llm
project: stroyintellekt
source: owner-decisions-and-architecture
related:
  - 04-canonical-data-and-structured-output.md
  - 05-knowledge-and-parameter-platform.md
  - 09-security-tenancy-and-data-handling.md
  - 10-api-queue-and-runtime-state.md
  - 13-testing-evals-and-delivery-gates.md
supersedes: []
superseded_by: docs/architecture_v3.md
owner: govard
agent_read_priority: critical
---

# СтройИнтеллект: retrieval, RAG и LLM gateways

## 1. Цель

Платформа реализует два сравниваемых retrieval track:

- `file_first`: поиск по утверждённым файлам и structured artifacts без vector index;
- `rag_enabled`: hybrid retrieval по утверждённому corpus/index snapshot.

Оба track:

- работают через общий `EvidenceRetriever`;
- применяют одинаковые tenant/ACL filters;
- возвращают один evidence schema;
- не участвуют в deterministic calculations;
- сравниваются на одном benchmark до production selection.

## 2. EvidenceItem

```yaml
evidence_item:
  evidence_id: uuid
  source_ownership_scope: platform | tenant
  source_tenant_id: uuid | null
  project_id: uuid | null
  source_ref: SourceRef
  document_version_id: uuid
  document_title: string
  source_type: contract | norm | estimate | rule | parameter | other
  text: string
  metadata: object
  access_scope:
    visibility: tenant | project | platform_public
    acl_tags: []
  retrieval:
    track: file_first | rag_enabled
    rank: integer
    score: decimal | null
    lexical_score: decimal | null
    vector_score: decimal | null
    rerank_score: decimal | null
  content_hash: sha256
```

`source_tenant_id = null` допустим только для admitted `platform_public` source. Requester `tenant_id` и ACL decision находятся в `EvidenceQuery/EvidenceResult` и не смешиваются с source ownership.

## 3. EvidenceQuery

```yaml
evidence_query:
  query_id: uuid
  tenant_id: uuid
  project_id: uuid | null
  actor_id: uuid
  purpose: norm_lookup | source_support | explanation | report_generation | other
  query_text: string
  filters:
    source_types: []
    document_version_ids: []
    effective_at: date | null
    parameter_keys: []
    rule_ids: []
  track: file_first | rag_enabled
  snapshot_ref: string
  max_items: integer
  trace_id: string
```

## 4. Общий port

```python
class EvidenceRetriever(Protocol):
    async def retrieve(
        self,
        query: EvidenceQuery,
        context: RetrievalContext,
    ) -> EvidenceResult: ...
```

```yaml
evidence_result:
  query_id: uuid
  requester_tenant_id: uuid
  track: file_first | rag_enabled
  snapshot_ref: string
  items: []
  retrieval_trace_id: uuid
  acl_decision_id: uuid
  result_hash: sha256
```

## 5. File-first track

`file_first` использует:

- exact metadata filters;
- keyword/BM25 search;
- document/table indexes;
- parameter/rule catalogs;
- deterministic ranking policy.

Snapshot:

```yaml
file_first_snapshot:
  snapshot_id: string
  corpus_manifest_hash: sha256
  tokenizer_version: string
  lexical_index_version: string
  ranking_policy_version: string
  created_at: date-time
```

Track остаётся production-safe fallback, пока RAG не прошёл admission.

## 6. RAG-enabled track

```yaml
rag_snapshot:
  snapshot_id: string
  corpus_manifest_hash: sha256
  chunking_policy_version: string
  embedding_model_id: string
  embedding_model_version: string
  vector_index_version: string
  lexical_index_version: string
  hybrid_weight_policy: string
  reranker_model_id: string | null
  reranker_version: string | null
  retrieval_policy_version: string
  created_at: date-time
```

Pipeline:

```text
ACL-filtered candidate scope
→ lexical retrieval
→ vector retrieval
→ score normalization
→ hybrid merge
→ optional rerank
→ duplicate/source-span collapse
→ final ACL assertion
→ evidence result
```

## 7. Corpus admission

Corpus может включать только:

- approved document versions;
- valid effective editions;
- tenant-visible sources;
- chunks с complete SourceRef;
- content, прошедший security processing;
- source status `active`.

Corpus manifest:

```yaml
corpus_manifest:
  corpus_id: string
  tenant_id: uuid | null
  project_id: uuid | null
  source_entries:
    - document_version_id: uuid
      content_hash: sha256
      status: active | excluded
      reason_code: string | null
  manifest_hash: sha256
```

Tenant-private content не включается в shared index.

## 8. Chunk contract

```yaml
knowledge_chunk:
  chunk_id: uuid
  tenant_id: uuid | null
  document_version_id: uuid
  source_ref: SourceRef
  text: string
  title_path: []
  token_count: integer
  chunking_policy_version: string
  acl_tags: []
  effective_from: date | null
  effective_to: date | null
  content_hash: sha256
```

Chunk не может смешивать tenant scopes или source editions.

## 9. LLM Gateway

```python
class LLMGateway(Protocol):
    async def generate_structured(
        self,
        request: LLMRequest,
        output_schema: JsonSchema,
        context: LLMContext,
    ) -> StructuredLLMResult: ...
```

```yaml
llm_request:
  request_id: uuid
  tenant_id: uuid
  analysis_id: uuid
  purpose: classify | extract | explain | draft_report | compare_evidence
  model_policy_id: string
  system_prompt_version: string
  prompt_template_version: string
  redacted_payload: object
  evidence_items: []
  output_schema_id: string
  trace_id: string
```

```yaml
structured_llm_result:
  request_id: uuid
  status: succeeded | rejected_schema | rejected_grounding | provider_failed | policy_blocked
  output: object | null
  claims: []
  usage:
    input_tokens: integer | null
    output_tokens: integer | null
  provider_metadata:
    provider_id: string
    model_id: string
    model_version: string | null
  request_payload_hash: sha256
  response_hash: sha256 | null
```

## 10. Outbound redaction gate

Перед provider call обязателен `RedactionResult` из spec 04:

- `decision = allow`;
- `residual_validation.status = passed`;
- `residual_validation.residual_findings` пуст;
- outbound payload hash совпадает с request payload hash;
- provider allowlist разрешает purpose/data class;
- tenant policy разрешает внешний provider.

При любой ошибке вызов не выполняется.

## 11. Grounding

Каждый factual claim должен иметь:

```yaml
claim:
  claim_id: uuid
  text: string
  claim_type: factual | inference | recommendation
  evidence_refs: []
  grounding_state: supported | partially_supported | unsupported | not_required
```

`unsupported` factual claim блокирует публикацию отчёта. Recommendation должна отделяться от factual evidence.

## 12. Structured output validation

Результат проходит:

1. JSON parse;
2. schema validation;
3. enum/unit validation;
4. claim-to-evidence validation;
5. tenant/source ACL validation;
6. prohibited-field scan;
7. business gate.

Free-form provider response не становится canonical result.

## 13. Prompt injection и hostile content

Controls:

- retrieved text рассматривается как data, не instruction;
- system/developer policy не включается в corpus;
- tools недоступны retrieval-generation model;
- source text не может менять output schema;
- content с injection markers маркируется;
- generated citations сверяются с actual evidence IDs;
- hidden instructions не исполняются;
- provider output не запускает code/SQL/template expressions.

## 14. Caching

```text
retrieval_cache_key = sha256(
  tenant_id
  + actor_acl_hash
  + query_text
  + filters
  + track
  + snapshot_ref
  + retrieval_policy_version
)
```

LLM cache key включает redacted payload hash, evidence result hash, model/prompt/schema versions. Cache никогда не разделяется между tenant-private scopes.

## 15. Track comparison

Оба track запускаются:

- на одном query set;
- по эквивалентному corpus manifest;
- с одинаковыми ACL/effective-date filters;
- с фиксированными snapshots;
- без использования test labels для настройки production result.

Метрики:

- Recall@K;
- Precision@K;
- MRR/nDCG;
- citation precision;
- answer groundedness;
- unsupported claim rate;
- cross-tenant leakage;
- latency;
- cost;
- human preference;
- downstream task success.

## 16. Production admission RAG

`rag_enabled` может стать production default только если:

- offline retrieval gates пройдены;
- zero cross-tenant leakage на adversarial corpus;
- citation/grounding gates пройдены;
- latency/cost budgets утверждены;
- shadow/canary evidence не хуже file-first по safety;
- rollback на file-first проверен;
- owner утверждает decision record.

До этого RAG имеет status `test_eval_only`.

## 17. Failure and fallback

| Failure | Поведение |
|---|---|
| vector index unavailable | fallback file-first, если purpose допускает |
| snapshot missing | block, без поиска по latest |
| provider unavailable | retry policy, затем partial result без выдуманного текста |
| schema invalid | limited repair attempt, затем reject |
| grounding failed | block report claim |
| ACL mismatch | security incident, result discarded |
| redaction failed | provider call blocked |

Fallback всегда отражается в trace и UI.

## 18. Observability

Логируются без raw sensitive content:

- query/trace IDs;
- tenant/project IDs;
- track/snapshot;
- candidate/result counts;
- latency by stage;
- provider/model/prompt/schema versions;
- token/cost metrics;
- ACL/redaction verdict;
- fallback reason;
- output/manifest hashes.

## 19. Acceptance

- один interface/schema для двух track;
- одинаковый tenant-filtered corpus даёт только tenant-visible evidence;
- snapshot полностью воспроизводим;
- factual claims без evidence блокируются;
- provider не получает payload при failed redaction;
- deterministic calculations не зависят от retrieval/LLM;
- file-first работает при отключённых vector/LLM providers;
- RAG не включается production default без admission;
- cross-tenant leakage = 0;
- prompt injection fixtures не меняют policy/schema;
- rollback RAG → file-first проверен.

## 20. Решения до реализации

| ID | Решение |
|---|---|
| `DEC-RAG-001` | Vector store и isolation topology |
| `DEC-RAG-002` | Embedding/reranker models |
| `DEC-RAG-003` | Chunking profiles по source type |
| `DEC-RAG-004` | Admission thresholds |
| `DEC-RAG-005` | Provider allowlist и data residency |
| `DEC-RAG-006` | Допустимый structured-output repair count |
