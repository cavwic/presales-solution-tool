---
name: solution-workflow
description: Run a complete solution-engineering project from presales discovery through tender response, POC, award handover, and delivery coordination. Use when Codex must organize customer requirements, presales packs, technical bid work, cross-functional actions, commitments, or handover records in a local solution workspace; invoke tender-requirement-extraction and technical-bid-package for the two tender-specific stages.
---

# Solution workflow

## Operating boundary

Work only in the local workspace path supplied by the user. Do not upload, publish, email, submit, or apply company materials. Treat customer names, prices, contracts, credentials, contacts, drawings, and internal product details as confidential unless the user explicitly marks them public.

Keep four states separate:

- Source fact: directly supported by an identified file and locator.
- Confirmed internal capability: supported by a current approved company source.
- Analysis: a reasoned interpretation that still needs review.
- Unknown: information that is absent, stale, conflicting, or outside the available evidence.

Never convert an unknown into a commitment. Never write customer work, credentials, qualifications, certifications, performance, or compliance that the provided materials do not establish.

## Workflow

1. Read `references/workflow.md` and `references/workspace-contract.md`.
2. Inspect `workspace.json`, the active `project.json`, and the available source, library, template, work, and output files.
3. Preserve the existing schema version and identifiers. Do not replace reviewed rows with newly generated identifiers.
4. Determine the current stage and the missing gate:
   - Presales: initial requirement, meeting pack, action list, discovery baseline, and POC decision.
   - Tender: source inventory, requirement extraction, baseline comparison, response evidence, technical volume, and review.
   - Award: award supplements, final bid baseline, temporary changes, department responsibilities, handover tasks, responses, and acceptance.
5. Call `$tender-requirement-extraction` when tender files or amendments have not been converted into a source-linked review matrix.
6. Stop and request human review when extracted requirements are new, changed, conflicting, mandatory, scored, or disqualifying.
7. Call `$technical-bid-package` only after the applicable tender requirements are reviewed and the evidence library is inventoried.
8. Update the project manifest, Markdown working files, CSV matrices, and action records. Keep business, price, legal, and qualification items assigned to their responsible owners rather than drafting unsupported content.
9. Run `scripts/validate_workflow.py <workspace> --strict` before reporting completion.
10. Report completed outputs, blocking issues, assumptions, and exact files that need human approval.

## Deliverable rules

- Treat every DOCX, XLSX, or PPTX template as a format-only asset. Reuse supported layout, style, theme, dimensions, headers, footers, and master elements, but exclude all template body text, cell values, examples, claims, commitments, and instructions from drafting evidence and generated content. Prefer a deliverable-specific template; use the matching general project template only when no specific template is selected.
- Follow `workspacePath` and the numbered business folders in `references/workspace-contract.md`. Reuse an existing project file by SHA-256 and record the reference in `说明文档.txt`; do not copy the same file into multiple module folders.
- Use `assets/project-brief.md` for a new discovery record.
- Use `assets/handover-checklist.csv` for post-award technical handover.
- Apply the award-stage precedence in this order: temporary change notes, award supplements and award notes, then final bid files. Record conflicts instead of silently merging them.
- Define each participating department before splitting tasks. Store its responsibility boundary, owner, default deliverable type, and default response method. Assign tasks only to departments present in the project manifest.
- Each handover task must have a department, scope, deliverable, owner, due date, dependency, acceptance criteria, and response method. Use file upload for documents, drawings, BOMs, and test records; use a controlled package or repository path for software; use a written report or status confirmation for work that does not produce a file; use mixed response when more than one form is required.
- Do not mark a task submitted or accepted unless the response record matches its declared response method. Acceptance also requires explicit criteria.
- Keep discovery and tender requirements as separate baselines. Record additions, changes, removals, and conflicts.
- Define POC scope, sample, success criteria, failure scripts, fallback, owner, and sign-off before presenting it as ready.
- Preserve formal tender wording in the source field. Put plain-language interpretation in the normalized field.
- A technical solution section must point to reviewed requirements and verified evidence.
- Do not treat this Skill as legal advice, procurement approval, safety certification, or authorization to submit a bid.

## Output

Return a short operating summary with:

1. Current project stage and gate status.
2. Files created or updated.
3. Requirements or commitments that changed.
4. Blocking issues and owners.
5. Human approvals still required.

Read `references/example.md` when a concrete end-to-end example is needed.
