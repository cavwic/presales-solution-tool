from pathlib import Path
import sys

REQUIRED = ["Decision Summary", "Scope", "Context", "Component", "Interface", "Deployment", "Observability", "Recovery", "Responsibility", "Alternatives", "Unknowns"]

def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check_output.py <markdown-file>")
        return 2
    text = Path(sys.argv[1]).read_text(encoding="utf-8")
    missing = [item for item in REQUIRED if item.lower() not in text.lower()]
    if missing:
        print("missing architecture coverage: " + ", ".join(missing))
        return 1
    print("solution architecture pack: valid")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
