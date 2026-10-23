# Example fragment: read-only RAG application

## Scope and Non-goals
- In scope: authorized search, cited answers, feedback queue.
- Non-goal: automatic external messaging.

## Interface Contracts
| Interface | Direction | Protocol | Identity | Version | Timeout/retry | Errors | Owner | Fallback |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| document sync | source to index | HTTPS | service account | unknown | proposed | explicit status | IT | pause indexing |

## Unknowns and Verification Actions
- Identity role mapping: export a redacted ACL sample before POC.
