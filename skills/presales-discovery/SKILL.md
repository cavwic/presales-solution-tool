---
name: presales-discovery
description: Structure presales discovery for enterprise AI, robotics, automation, and complex system opportunities. Use when requirements are vague, before proposing architecture or a POC, when preparing discovery workshops, or when converting customer statements into facts, assumptions, unknowns, risks, owners, and next verification actions.
---

# Presales Discovery

Turn a request into a qualified opportunity record. Preserve the difference between what the customer confirmed, what public evidence supports, what the team assumes, and what remains unknown.

## Workflow

1. Identify the business task, user, trigger, current process, expected output, and cost of failure.
2. Map stakeholders: sponsor, business owner, technical owner, security, operations, procurement, and acceptance signer.
3. Inspect data, interfaces, site conditions, access, safety, service, and deployment constraints relevant to the domain.
4. Label every material statement as `confirmed`, `assumption`, `unknown`, or `not-applicable`.
5. Convert each unknown that could change scope, price, schedule, safety, or acceptance into a verification action with an owner and due date.
6. Recommend one outcome: `disqualify`, `research`, `discovery workshop`, `controlled POC`, or `proposal`.
7. Produce the structure in [references/template.md](references/template.md) and run `python scripts/check_output.py <file>`.

## Domain Gates

- For AI, cover data ownership, access control, model/RAG/agent boundaries, evaluation, tool permissions, cost, observability, fallback, and human takeover.
- For robotics, cover objects, site, takt, task states, safety, external systems, failure recovery, service, and acceptance.
- For dexterous hands, cover why a simpler end effector is insufficient, object set, actuation, tactile sensing, control, load definition, thermal behavior, cycle life, and maintenance.

## Boundaries

- Do not promise capability from a product name or demo.
- Do not infer unpublished parameters.
- Do not convert personal practice into a customer deployment.
- Do not include customer identities, internal interfaces, prices, contacts, or restricted material unless the user explicitly confirms authorization.
- This skill prepares discovery material; it does not replace safety, legal, security, or compliance review.

Use [references/example.md](references/example.md) for output depth, not as factual input.
