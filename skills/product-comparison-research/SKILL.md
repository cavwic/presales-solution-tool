---
name: product-comparison-research
description: Research and compare enterprise AI, robotics, industrial automation, sensors, and dexterous-hand products with source-level traceability. Use for product matrices, vendor profiles, shortlist research, parameter verification, or procurement support where facts, source dates, unknown fields, scenario-specific dimensions, and analytical judgments must remain distinct.
---

# Product Comparison Research

Build a decision matrix from primary evidence. The output should narrow verification work, not manufacture a universal winner.

## Workflow

1. Define product category, target task, operating conditions, mandatory gates, and decision owner.
2. Create category-specific dimensions. Never compare AI platforms, robot bodies, and end effectors using one generic scorecard.
3. Gather official product pages, manuals, developer documentation, releases, standards, and papers. Use recruitment or third-party reports only for context.
4. Record each claim as `fact`, `vendor statement`, `analysis`, or `unknown`, with URL and verification date.
5. Normalize units and test conditions. Do not compare load, latency, force, accuracy, or battery life without their definitions.
6. Keep unpublished fields as `unknown`; do not impute averages or silently score them as zero.
7. Apply transparent weights only after mandatory gates. Run sensitivity analysis by varying material weights.
8. Recommend the next action per candidate: reject, ask vendor, request document, test sample, or pilot.
9. Fill [references/template.md](references/template.md) and run `python scripts/check_output.py <file>`.

## Source Rules

- Prefer current official manuals and developer docs over marketing summaries.
- Store the verification date and product/version scope.
- Quote sparingly and paraphrase product claims.
- A missing public field is not proof that the capability is absent.
- A vendor claim is not independent test evidence.

## Boundaries

Do not use the score as an industry standard, procurement approval, safety certification, or proof of production fitness. Physical systems require sample testing under the target task.
