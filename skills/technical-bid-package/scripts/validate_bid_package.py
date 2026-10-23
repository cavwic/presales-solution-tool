#!/usr/bin/env python3
import argparse
import json
import sys
from datetime import date
from pathlib import Path


REQUIRED_KINDS = {
    "technical-proposal",
    "response-matrix",
    "deviation-table",
    "module-detail",
    "drawing-register",
    "deployment-manual",
    "acceptance-plan",
    "certificate-register",
}


def validate(project: dict) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    evidence = {item.get("id"): item for item in project.get("evidence", [])}
    requirements = {item.get("id"): item for item in project.get("requirements", [])}
    for item in requirements.values():
        label = item.get("title") or item.get("id")
        if item.get("baseline") != "tender":
            continue
        if not item.get("sourceRef"):
            errors.append(f"tender requirement has no source: {label}")
        if item.get("reviewState") == "approved":
            if not item.get("formalResponse", "").strip():
                errors.append(f"approved requirement has no formal response: {label}")
            if item.get("responseStatus") == "missing_evidence":
                errors.append(f"missing-evidence requirement is approved: {label}")
        refs = item.get("evidenceRefs", [])
        if item.get("responseStatus") == "confirmed" and not refs:
            errors.append(f"confirmed requirement has no evidence: {label}")
        for ref in refs:
            if ref not in evidence:
                errors.append(f"requirement references unknown evidence {ref}: {label}")
        if item.get("responseStatus") == "unsupported" and item.get("deviationType") != "negative":
            errors.append(f"unsupported requirement is not a negative deviation: {label}")
        if item.get("category") == "commercial" and item.get("formalResponse", "").strip():
            warnings.append(f"commercial response requires owner review: {label}")
    for item in evidence.values():
        expires = item.get("expiresAt", "")
        if expires and expires < date.today().isoformat():
            warnings.append(f"evidence review date has expired: {item.get('title', item.get('id'))}")
    for section in project.get("sections", []):
        label = section.get("title", section.get("id"))
        if section.get("reviewState") == "approved" and not section.get("requirementIds"):
            errors.append(f"approved section has no requirement mapping: {label}")
        if section.get("reviewState") == "approved" and not section.get("evidenceIds"):
            warnings.append(f"approved section has no evidence mapping: {label}")
        for requirement_id in section.get("requirementIds", []):
            if requirement_id not in requirements:
                errors.append(f"section references unknown requirement {requirement_id}: {label}")
    delivered = {item.get("kind") for item in project.get("deliverables", []) if item.get("status") == "approved"}
    for kind in sorted(REQUIRED_KINDS - delivered):
        warnings.append(f"technical package item not approved: {kind}")
    return errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("project", type=Path)
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args()
    try:
        project = json.loads(args.project.read_text(encoding="utf-8-sig"))
        errors, warnings = validate(project)
    except Exception as exc:
        print(json.dumps({"ok": False, "errors": [str(exc)], "warnings": []}, ensure_ascii=False, indent=2))
        return 1
    result = {"ok": not errors and (not args.strict or not warnings), "errors": errors, "warnings": warnings}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
