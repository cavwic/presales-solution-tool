from pathlib import Path
import re
import sys

REQUIRED = ["Decision Context", "Mandatory Gates", "Dimensions", "Source Register", "Evidence Matrix", "Unknowns", "Sensitivity", "Next Verification", "Non-claims"]

def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check_output.py <markdown-file>")
        return 2
    text = Path(sys.argv[1]).read_text(encoding="utf-8")
    missing = [item for item in REQUIRED if item.lower() not in text.lower()]
    if missing:
        print("missing research controls: " + ", ".join(missing))
        return 1
    if not re.search(r"https?://", text):
        print("source register requires at least one URL")
        return 1
    print("product comparison research: valid")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
