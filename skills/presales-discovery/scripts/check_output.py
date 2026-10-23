from pathlib import Path
import sys

REQUIRED = ["Decision Summary", "Business Task", "Confirmed Facts", "Assumptions and Unknowns", "Constraints", "Acceptance", "Next Actions"]

def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check_output.py <markdown-file>")
        return 2
    text = Path(sys.argv[1]).read_text(encoding="utf-8")
    missing = [section for section in REQUIRED if section.lower() not in text.lower()]
    if missing:
        print("missing sections: " + ", ".join(missing))
        return 1
    if not any(label in text.lower() for label in ["unknown", "未知"]):
        print("output must preserve unknowns")
        return 1
    print("presales discovery output: valid")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
