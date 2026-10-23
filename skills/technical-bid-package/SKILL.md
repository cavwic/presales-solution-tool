---
name: technical-bid-package
description: Build and audit a technical bid package from reviewed tender requirements and verified company materials. Use when Codex must draft a technical proposal, compliance response matrix, deviation table, module descriptions, drawing register, deployment manual, FAT/SAT acceptance plan, certificate register, or customer presentation without inventing capability, qualifications, price, or legal commitments.
---

# Technical bid package

## Entry gate

Read `references/bid-package-rules.md` and `references/template-mapping.md`. Work only in the user-supplied local workspace.

Read source files from their `workspacePath`. Keep each checklist item's imported templates and references under its directory in `3_技术标组包/1_投标文件输出`, and write generated deliverables plus non-empty detail requirements under that item's `生成文件` folder. Reuse project files by SHA-256 and record cross-folder references in `说明文档.txt`; do not create duplicate copies.

Do not start formal drafting until:

- Applicable tender rows have source locators and review states.
- Amendments and clarification files are inventoried.
- The evidence library identifies approved product introductions, SOWs, manuals, historical solutions, certificates, and drawings with versions and review dates.
- Business, commercial, price, qualification, legal, and submission items have responsible owners.

If these conditions are not met, produce a blocking list instead of plausible filler.

## Procedure

1. Load the active `project.json`, reviewed requirements, evidence library, working files, and available templates. Templates are format-only assets: do not use their body text, cell values, sample claims, commitments, or instructions as drafting input. Prefer the deliverable-specific matching template, then the matching general project template.
2. Build or update the compliance matrix first. Map each requirement to response status, deviation, evidence, owner, formal wording, technical section, acceptance method, and review state.
3. Use only these internal response states:
   - `confirmed`: current evidence directly supports the response.
   - `conditional`: a named condition or configuration is required.
   - `custom`: development, integration, or non-standard work is required.
   - `missing_evidence`: evidence is absent, stale, or inconclusive.
   - `unsupported`: the available solution cannot meet the requirement.
4. Never write `confirmed` without evidence. Never turn conditional or custom work into an unqualified "fully satisfies" statement. Record unsupported items as negative deviation.
5. Build the technical proposal outline from tender instructions and evaluation criteria, not from a generic chapter list. Keep a requirement-to-section mapping.
6. Draft each section from current company evidence. Mark missing parameters, interfaces, drawings, certificates, and performance data as explicit review items.
7. Produce the required package:
   - Overall technical proposal.
   - Response matrix.
   - Deviation table.
   - Module and subsystem descriptions.
   - Drawing and attachment register.
   - Deployment and implementation manual.
   - FAT/SAT acceptance plan where applicable.
   - Certificate and qualification handoff register.
   - `presentation.md` and `presentation-plan.json`.
8. Use `assets/technical-proposal.md` and `assets/presentation-plan.json` as starting structures.
9. For a company PPTX template, inspect its layouts with `scripts/render_pptx.py --inspect-template <template.pptx>`. Create or update a layout map, then render the reviewed plan. Remove ordinary template slides before adding generated slides; retain only reusable masters, layouts, themes, and supported design assets. Do not promise to retain macros, complex animations, OLE objects, or unavailable fonts.
10. Run `scripts/validate_bid_package.py <project.json> --strict` before reporting the package ready.
11. Report blocking requirements, missing evidence, negative deviations, unapproved wording, expired materials, and files that require specialist input.

## Specialist boundaries

- Track civil, structural, electrical, network, topology, and CAD drawings by requirement, owner, version, and approval. Do not fabricate professional drawings.
- Extract commercial, price, bond, legal, qualification, and submission instructions, but assign them to the appropriate owner instead of inventing a response.
- Treat FAT, SAT, safety, regulatory, and certificate language as project-specific. Do not claim a certificate, test, or approval that is absent from current evidence.
- Do not submit, sign, stamp, email, upload, or publish the bid.

Read `references/example.md` for a conditional response example.
