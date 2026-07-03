#!/usr/bin/env python3
"""Merge extract/*.json into the single profiles.json dataset.

- extract/national.json      -> {"national": [...]}
- extract/group-*.json       -> {"jurisdictions": {"US-XX": {...}}}
Duplicate jurisdiction keys across group files are a hard error.
Run from docs/research/wellbeing-resources/.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
EXTRACT = ROOT / "extract"


def main():
    national = []
    nat_path = EXTRACT / "national.json"
    if nat_path.exists():
        national = json.loads(nat_path.read_text(encoding="utf-8")).get("national", [])
    jurisdictions = {}
    for gf in sorted(EXTRACT.glob("group-*.json")):
        data = json.loads(gf.read_text(encoding="utf-8"))
        for key, val in data.get("jurisdictions", {}).items():
            if key in jurisdictions:
                print(f"ERROR: duplicate jurisdiction {key} (also in {gf.name})")
                return 1
            jurisdictions[key] = val
    out = {
        "schemaVersion": 1,
        "national": national,
        "jurisdictions": dict(sorted(jurisdictions.items())),
    }
    (ROOT / "profiles.json").write_text(
        json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"merged: {len(national)} national + {len(jurisdictions)} jurisdictions -> profiles.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
