# Requirement schema

Required fields:

| Field | Meaning |
|---|---|
| id | Stable row identifier |
| baseline | `discovery` or `tender` |
| category | One controlled category |
| title | Short operational label |
| originalText | Verbatim source clause |
| normalizedText | One testable interpretation |
| mandatory | Explicit mandatory marker |
| scored | Explicit scoring item |
| scoreWeight | Source scoring value or rule |
| dueDate | Source date or empty |
| sourceRef | Document, segment, locator, excerpt |
| owner | Responsible internal role or empty |
| responseStatus | Initialize as `missing_evidence` |
| deviationType | Initialize as `pending` |
| formalResponse | Empty during extraction |
| evidenceRefs | Empty during extraction |
| reviewState | `draft` until human review |
| linkedDiscoveryId | Matching discovery row or empty |
| conflictNote | Conflict, ambiguity, or amendment note |
| acceptanceCriteria | Source acceptance wording or empty |

Do not set `confirmed`, `conditional`, `custom`, or `unsupported` during source extraction unless the user separately provides reviewed capability evidence and explicitly requests response analysis.
