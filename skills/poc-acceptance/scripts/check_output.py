from pathlib import Path
import sys

REQUIRED = ["Decision", "Non-claims", "Baseline", "Environment", "Sample", "Test Cases", "Acceptance Matrix", "Failure", "Recovery", "Data Capture", "Stop Conditions", "Handover", "Risks"]

def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check_output.py <markdown-file>")
        return 2
    text = Path(sys.argv[1]).read_text(encoding="utf-8")
    missing = [item for item in REQUIRED if item.lower() not in text.lower()]
    if missing:
        print("missing POC controls: " + ", ".join(missing))
        return 1
    print("POC acceptance plan: valid")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
