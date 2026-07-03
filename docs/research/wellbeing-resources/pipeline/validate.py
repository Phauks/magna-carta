#!/usr/bin/env python3
"""Validate a wellbeing-resources profiles.json against corpus invariants.

Usage: python pipeline/validate.py [profiles.json]   (default: ../profiles.json relative to pipeline/)
Exit code 1 if any violation. Run with --selftest to check the built-in fixtures.
"""
import json
import re
import sys
from pathlib import Path

OPERATOR_TYPES = {"stateBar", "nonprofit", "court", "vendor", "national"}
SCOPES = {"statewide", "metro", "national"}
AVAILABILITY = {"aroundTheClock", "businessHours", "unspecified"}
SERVICES = {
    "counseling", "substanceUse", "mentalHealth", "peerSupport", "crisisLine",
    "teletherapy", "financialAid", "familySupport", "monitoring",
}
CONFIDENCE = {"HIGH", "MEDIUM", "LOW", "NA"}
SOURCE_TIERS = {"primary-official", "corroborated", "secondary"}
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _check_resource(where, r, out, *, national=False):
    if not r.get("name"):
        out.append(f"{where}: resource missing name")
    if not r.get("operator"):
        out.append(f"{where}: resource '{r.get('name')}' missing operator")
    if r.get("operatorType") not in OPERATOR_TYPES:
        out.append(f"{where}: bad operatorType {r.get('operatorType')!r}")
    if r.get("scope") not in SCOPES:
        out.append(f"{where}: bad scope {r.get('scope')!r}")
    phones = r.get("phones", [])
    if not r.get("url") and not phones:
        out.append(f"{where}: resource '{r.get('name')}' has no contact (url or phone)")
    for p in phones:
        if not p.get("number"):
            out.append(f"{where}: phone missing number")
        if p.get("availability") not in AVAILABILITY:
            out.append(f"{where}: bad phone availability {p.get('availability')!r}")
    services = r.get("services", [])
    if national and not services:
        pass  # national entries may be pure crisis lines w/o service tags
    for s in services:
        if s not in SERVICES:
            out.append(f"{where}: bad service tag {s!r}")
    conf = r.get("confidence")
    if conf not in CONFIDENCE:
        out.append(f"{where}: bad confidence {conf!r}")
    if r.get("sourceTier") not in SOURCE_TIERS:
        out.append(f"{where}: bad sourceTier {r.get('sourceTier')!r}")
    if not ISO_DATE.match(r.get("verifiedOn", "")):
        out.append(f"{where}: verifiedOn not ISO date: {r.get('verifiedOn')!r}")
    if conf in {"HIGH", "MEDIUM"} and not r.get("sourceUrl"):
        out.append(f"{where}: {conf} resource '{r.get('name')}' missing sourceUrl")


def validate(data):
    out = []
    nat = data.get("national")
    if not nat:
        out.append("top-level: national safety net missing or empty")
    else:
        if not any(p.get("number") == "988" for r in nat for p in r.get("phones", [])):
            out.append("national: 988 Suicide & Crisis Lifeline not present")
        for i, r in enumerate(nat):
            if r.get("operatorType") != "national":
                out.append(f"national[{i}]: operatorType must be 'national'")
            _check_resource(f"national[{i}]", r, out, national=True)
    seen_fips, seen_code = set(), set()
    for key, j in data.get("jurisdictions", {}).items():
        fips = j.get("fips", "")
        code = j.get("code", "")
        if not re.match(r"^\d{2}$", fips):
            out.append(f"{key}: fips must be 2 digits, got {fips!r}")
        if not re.match(r"^[A-Z]{2}$", code):
            out.append(f"{key}: code must be 2 uppercase letters, got {code!r}")
        if fips in seen_fips:
            out.append(f"{key}: duplicate fips {fips}")
        if code in seen_code:
            out.append(f"{key}: duplicate code {code}")
        seen_fips.add(fips)
        seen_code.add(code)
        if not j.get("name"):
            out.append(f"{key}: missing name")
        resources = j.get("resources", [])
        # NA-only coverage is allowed (thin jurisdiction → national fallback), but must be explicit.
        if not resources:
            out.append(f"{key}: no resources and not marked NA (add an NA-confidence placeholder or a real resource)")
        for i, r in enumerate(resources):
            _check_resource(f"{key}.resources[{i}]", r, out)
    return out


_FIXTURE_OK = {
    "schemaVersion": 1,
    "national": [{
        "name": "988 Suicide & Crisis Lifeline", "operator": "SAMHSA / Vibrant",
        "operatorType": "national", "scope": "national",
        "url": "https://988lifeline.org/",
        "phones": [{"number": "988", "label": "Call/text/chat", "availability": "aroundTheClock"}],
        "services": ["crisisLine"], "confidence": "HIGH",
        "sourceUrl": "https://988lifeline.org/", "sourceTier": "primary-official",
        "verifiedOn": "2026-07-02",
    }],
    "jurisdictions": {"US-CA": {
        "fips": "06", "code": "CA", "name": "California", "source": "US-CA",
        "resources": [{
            "name": "Lawyer Assistance Program (LAP)", "operator": "State Bar of California",
            "operatorType": "stateBar", "scope": "statewide",
            "url": "https://www.calbar.ca.gov/",
            "phones": [{"number": "877-527-4435", "label": "Intake", "availability": "unspecified"}],
            "services": ["counseling", "peerSupport"], "confidence": "HIGH",
            "sourceUrl": "https://www.calbar.ca.gov/", "sourceTier": "primary-official",
            "verifiedOn": "2026-07-02",
        }],
    }},
}
_FIXTURE_BAD = {
    "national": [],
    "jurisdictions": {"US-CA": {
        "fips": "6", "code": "ca", "name": "", "source": "US-CA",
        "resources": [{
            "name": "X", "operator": "", "operatorType": "wrong", "scope": "state",
            "phones": [{"number": "", "availability": "24/7"}],
            "services": ["therapy"], "confidence": "SURE", "sourceTier": "blog",
            "verifiedOn": "July",
        }],
    }},
}


def _selftest():
    ok = validate(_FIXTURE_OK)
    bad = validate(_FIXTURE_BAD)
    assert ok == [], f"OK fixture should be clean, got: {ok}"
    assert len(bad) >= 8, f"BAD fixture should raise many violations, got {len(bad)}: {bad}"
    print(f"selftest passed: OK fixture clean; BAD fixture raised {len(bad)} violations")


def main(argv):
    if "--selftest" in argv:
        _selftest()
        return 0
    path = Path(argv[1]) if len(argv) > 1 else Path(__file__).parent.parent / "profiles.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    violations = validate(data)
    for v in violations:
        print(f"VIOLATION: {v}")
    print(f"{len(violations)} violation(s) in {path}")
    return 1 if violations else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
