---
name: tender-requirement-extraction
description: Extract and review source-linked requirements from tender documents, amendments, clarification files, schedules, tables, and OCR text. Use when Codex must shred an RFP or tender into technical, business, qualification, scoring, schedule, acceptance, delivery, and commercial handoff rows; compare tender and discovery baselines; or produce a compliance review matrix without claiming unsupported compliance.
---

# Tender requirement extraction

## Boundary

Read only the files in the user-supplied local project workspace. Preserve the original clause and its source locator. Do not paraphrase normative source text in the `originalText` field. Put interpretation in `normalizedText`.

Treat scanned or unreadable pages as missing input. Do not infer their content from neighboring pages, filenames, or common tender language. Report the exact pages that require OCR or manual review.

If an output template is supplied, treat it only as a formatting asset. Do not read template text, cell values, examples, conclusions, or instructions as tender evidence or generated content.

Read each source from its `workspacePath`. Tender originals belong under `2_招标要求/1_招标文件/导入文件`, clarification rounds under `2_招标要求/2_澄清及相关文件`, and generated analysis under `2_招标要求/3_招标文件分析`. When a SHA-256 already exists in the project, reference its canonical path in `说明文档.txt` instead of copying it.

## Procedure

1. Read `references/extraction-rules.md` and `references/requirement-schema.md`.
2. Inventory all tender files, appendices, drawings registers, schedules, clarifications, and amendments. Record file name, version, date, hash when available, and precedence.
3. Read the discovery baseline without modifying it. Treat the issued tender as a separate baseline.
4. Extract atomic requirements. Split a clause when its obligations have different owners, evidence, dates, responses, or acceptance methods.
5. Classify each row as technical, business, qualification, scoring, schedule, acceptance, delivery, or commercial.
6. Capture mandatory markers, scoring value, disqualification risk, due date, required attachment, certificate, drawing, interface, owner, and acceptance condition when present.
7. Attach a source reference to every row:
   - PDF: file, page, section, and excerpt.
   - DOCX: file, heading, paragraph or table cell, and excerpt.
   - XLSX: file, sheet, cell or range, and value.
   - PPTX: file, slide, and text block.
   - OCR/text: file and line range, clearly marked as OCR when applicable.
8. Link tender rows to discovery rows only when they address the same obligation. Mark additions, changes, removals, and conflicts. Do not hide a stricter tender condition behind a broad discovery statement.
9. Initialize response status as `missing_evidence` and deviation as `pending`. Extraction alone cannot establish that a product satisfies a requirement.
10. Write `requirements.csv`, `requirements.md`, and the updated `project.json` without changing reviewed identifiers.
11. Run `scripts/validate_requirements.py <project.json or requirements.csv>`.
12. Return the row count by category, mandatory/scored/disqualification counts, unreadable pages, conflicts, and items requiring human review.

## Review gates

Human review is required before changing any extracted row to approved. Explicitly flag:

- Mandatory and disqualification clauses.
- Scoring criteria and evidence instructions.
- Conflicting clauses or amendment precedence.
- Commercial, price, legal, qualification, and submission instructions that need another owner.
- Requirements that bundle several obligations.
- Ambiguous units, thresholds, dates, interfaces, certificates, or acceptance methods.

Use `assets/requirements.csv` and `assets/requirements.md` for a new matrix. Read `references/example.md` for an example with an amendment.
