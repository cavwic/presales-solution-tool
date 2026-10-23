from pathlib import Path
import re
import sys

REQUIRED = ["Audit Scope", "Findings", "Unsupported", "Responsibility", "Interface", "Recovery", "Acceptance", "Confidentiality", "Open Questions", "Residual Risk"]

def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check_output.py <markdown-file>")
        return 2
    text = Path(sys.argv[1]).read_text(encoding="utf-8")
    missing = [item for item in REQUIRED if item.lower() not in text.lower()]
    if missing:
        print("missing audit coverage: " + ", ".join(missing))
        return 1
    if not re.search(r"\bP[0-3]\b", text):
        print("findings require P0-P3 severity")
        return 1
    print("technical proposal audit: valid")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
