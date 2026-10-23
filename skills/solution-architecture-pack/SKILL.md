---
name: solution-architecture-pack
description: Build a reviewable solution architecture pack for enterprise AI, robotics, automation, and integrated hardware/software systems. Use after discovery has established a qualified problem and when the team needs system boundaries, components, interfaces, identity and data flows, deployment, observability, failure behavior, responsibilities, alternatives, and implementation phases.
---

# Solution Architecture Pack

Create architecture material that engineering, delivery, security, operations, and customer stakeholders can review against the same boundaries.

## Required Inputs

Require a discovery record or explicitly list missing inputs. Do not hide unconfirmed data, traffic, site, safety, interface, or service assumptions inside the diagram.

## Workflow

1. State the business task, in-scope outcome, non-goals, and acceptance owner.
2. Draw a system-context view with actors and external systems before internal components.
3. Define layers: experience, orchestration, model/control, data/perception, integration, infrastructure, and operations as relevant.
4. Create interface contracts with direction, protocol, identity, version, timeout, retry, idempotency, errors, owner, and fallback.
5. Trace data and control paths, including sensitive data, tool writes, emergency stops, or human approvals.
6. Describe degraded modes, observability, recovery, rollback, and service ownership.
7. Compare at least one alternative and explain the decision using evidence and constraints.
8. Phase the implementation around evidence gates, not feature volume.
9. Fill [references/template.md](references/template.md) and run `python scripts/check_output.py <file>`.

## Evidence Rules

- Label components or capabilities as confirmed, proposed, optional, or unknown.
- Link product claims to official documents and a verification date.
- Keep customer internal details out of reusable packs.
- A standards link is an entry point, not proof that a design is compliant.

## Boundaries

This skill does not certify cybersecurity, functional safety, regulatory compliance, or performance. Escalate those decisions to accountable specialists.
