---
name: technical-proposal-audit
description: Audit technical proposals, bid responses, architecture packs, and POC plans for evidence gaps, unsupported claims, scope drift, missing interfaces, unowned dependencies, unsafe assumptions, untestable acceptance language, confidentiality exposure, and delivery omissions. Use before internal review, customer submission, pricing, contract response, or handover.
---

# Technical Proposal Audit

Review a proposal as an adversarial delivery handover. Findings come first, ordered by severity, with precise evidence and a corrective action.

## Audit Workflow

1. Establish document purpose, audience, decision stage, contractual status, and authorized disclosure boundary.
2. Extract every material commitment about capability, parameter, schedule, integration, security, safety, service, performance, or outcome.
3. Trace each commitment to a source, assumption, owner, and verification method.
4. Check scope, non-goals, responsibilities, dependencies, interfaces, versions, failure modes, recovery, observability, and acceptance.
5. Look for internal contradictions between diagrams, tables, schedules, bill of materials, and prose.
6. Scan for customer names, personal data, prices, internal file names, screenshots, confidential interfaces, and unauthorized media.
7. Report findings using [references/template.md](references/template.md). Do not rewrite the proposal until the decision owner accepts the material changes.
8. Run `python scripts/check_output.py <file>` on the audit report.

## Severity

- `P0`: creates an immediate safety, legal, privacy, security, or irreversible contractual risk.
- `P1`: likely to cause a wrong design, failed acceptance, material cost, or delivery blockage.
- `P2`: weakens maintainability, traceability, operability, or decision quality.
- `P3`: clarity or consistency issue with limited delivery impact.

## Required Review Questions

- Is every claimed product fact current, version-scoped, and sourced?
- Are unknowns visible, owned, and scheduled for verification?
- Does each interface define identity, direction, version, timeout, errors, and fallback?
- Does the design show degraded operation, human takeover, recovery, and rollback?
- Can a customer repeat every acceptance test without the proposal author's interpretation?
- Are safety, security, legal, and compliance statements appropriately limited?
- Does reusable material exclude customer identities and restricted information?

## Boundaries

This skill identifies technical and disclosure risks. It does not provide legal advice, certify compliance or safety, or authorize publication.
