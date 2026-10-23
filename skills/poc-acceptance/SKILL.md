---
name: poc-acceptance
description: Design auditable POC plans and acceptance matrices for enterprise AI, robotics, automation, and integrated systems. Use before building or entering a site, when parties disagree about success, or when samples, baselines, metrics, failure tests, data capture, owners, exit conditions, and handover evidence must be fixed.
---

# POC Acceptance

Make a POC answer a decision. Do not treat a polished demo or selected success video as acceptance evidence.

## Workflow

1. State the decision the POC must support and what it will not prove.
2. Freeze the test environment, versions, user roles, data or object set, and allowed changes.
3. Establish the baseline and measurement method before target values.
4. Define normal, boundary, adversarial, degraded, recovery, and stop cases.
5. Write each metric with numerator, denominator, unit, sample size, tolerance, evidence location, and signer.
6. Record every run, including failures and human intervention.
7. Set pass, conditional pass, repeat, and stop conditions.
8. Define the handover package and unresolved risks.
9. Use [references/template.md](references/template.md), review [references/example.md](references/example.md), and run `python scripts/check_output.py <file>`.

## Domain Minimums

- AI: retrieval and generation separately, groundedness, refusal, access, prompt injection, latency, cost, fallback, and human queue.
- Robotics: task state path, takt, intervention, navigation/manipulation failures, safety triggers, continuous run, service response, and recovery.
- Dexterous hands: object-level results, initial pose, grasp strategy, force/tactile data, slip, damage, temperature, communication errors, cycle conditions, and maintenance.

## Boundaries

- Do not tune the test set after observing results without versioning the change.
- Do not remove failures from the denominator.
- Do not claim safety or compliance certification from a POC.
- Do not expose customer samples or logs in reusable examples.
