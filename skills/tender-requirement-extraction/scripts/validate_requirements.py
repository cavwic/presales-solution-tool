#!/usr/bin/env python3
import argparse
import csv
import json
import sys
from pathlib import Path


REQUIRED = {"id", "baseline", "category", "title", "originalText", "normalizedText", "sourceRef", "responseStatus", "deviationType", "reviewState"}
CSV_REQUIRED = {"id", "baseline", "category", "title", "originalText", "normalizedText", "locator", "responseStatus", "deviationType", "reviewState"}


def rows_from_json(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    rows = data.get("requirements") if isinstance(data, dict) else data
    if not isinstance(rows, list):
        raise ValueError("JSON must contain a requirements array")
    for row in rows:
        missing = REQUIRED - set(row)
        if missing:
            raise ValueError(f"row {row.get('id', '<unknown>')} missing fields: {sorted(missing)}")
    return rows


def rows_from_csv(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = CSV_REQUIRED - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"CSV missing columns: {sorted(missing)}")
        return list(reader)


def validate(rows: list[dict], csv_mode: bool) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    seen: set[str] = set()
    for row in rows:
        row_id = row.get("id", "<unknown>")
        if row_id in seen:
            errors.append(f"duplicate id: {row_id}")
        seen.add(row_id)
        source = row.get("locator") if csv_mode else row.get("sourceRef")
        if not source:
            errors.append(f"missing source locator: {row_id}")
        if not str(row.get("originalText", "")).strip():
            errors.append(f"missing original clause: {row_id}")
        if not str(row.get("normalizedText", "")).strip():
            warnings.append(f"missing normalized requirement: {row_id}")
        if row.get("responseStatus") != "missing_evidence":
            warnings.append(f"extraction row is not initialized as missing_evidence: {row_id}")
        if row.get("deviationType") != "pending":
            warnings.append(f"extraction row is not initialized as pending deviation: {row_id}")
        if row.get("reviewState") == "approved":
            errors.append(f"extraction cannot approve a row: {row_id}")
    return errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args()
    try:
        csv_mode = args.input.suffix.lower() == ".csv"
        rows = rows_from_csv(args.input) if csv_mode else rows_from_json(args.input)
        errors, warnings = validate(rows, csv_mode)
    except Exception as exc:
        print(json.dumps({"ok": False, "errors": [str(exc)], "warnings": []}, ensure_ascii=False, indent=2))
        return 1
    result = {"ok": not errors and (not args.strict or not warnings), "rows": len(rows), "errors": errors, "warnings": warnings}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
