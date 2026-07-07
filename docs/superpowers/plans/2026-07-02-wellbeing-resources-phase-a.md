# Wellbeing Resources — Phase A (Research Corpus) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a verified, regenerable per-jurisdiction research corpus of lawyer mental-health / emotional-support resources (State Bar Lawyer Assistance Programs + affiliated hotlines/peer networks/clinical vendors) plus a permanent national safety net — the data that Phase B's typed package is built from.

**Architecture:** Mirror `docs/research/trust-rules/`: a captured **source corpus** with a provenance manifest → per-group **extract JSON** authored by research → a Python **merge pipeline** producing the single dataset `profiles.json` → a generated **viewer.html** for human verify/needs-fix. Edit the dataset via `extract/*.json` + the pipeline; never hand-edit `profiles.json` or the HTML. Provenance is carried at the **resource** level.

**Tech Stack:** Python 3 (pipeline + viewer generation, mirrors trust-rules), JSON (dataset), Markdown (research drafts), YAML (source manifest). No product code in this phase.

## Global Constraints

- **Provenance discipline (non-negotiable):** every `HIGH`/`MEDIUM` resource rests on a **verbatim quote from an official source fetched during the research session** — never training recall. Mark `LOW` when only general knowledge supports it; `NA` when a jurisdiction genuinely has no program (→ resolves to the national safety net by design).
- **We own the national crisis numbers.** The national safety net (988, SAMHSA 1-800-662-4357, ABA CoLAP directory) is authored by us and always present; never scraped per-state, never trusting a state page to be current.
- **Never infer availability.** A phone's `availability` is `aroundTheClock` **only** where the source page states 24/7; otherwise `businessHours` (if stated) or `unspecified`.
- **Committed coverage:** 50 states + DC (51 jurisdictions). Territories (PR/GU/VI/AS/MP) best-effort.
- **Full names, no shorthand** (repo golden rule 12): spell out program names; `sourceUrl` not `src`.
- **Python invocation:** scripts assume `python` = Python 3 on PATH; on Windows set `PYTHONIOENCODING=utf-8` (the dataset carries `§`/`é`). Run all scripts from `docs/research/wellbeing-resources/`.
- **Do NOT begin the gated research tasks (Task 6 onward) until the owner gives an explicit go-ahead.** Tooling + seed (Tasks 1–5) use data already gathered in the 2026-07-02 spike and may proceed once the plan is approved.

---

## File Structure

```
docs/research/wellbeing-resources/
  README.md                     # process doc: confidence legend, schema, run order (Task 1)
  .gitignore                    # ignore large captured binaries if not committing them (Task 1)
  sources/
    manifest.yaml               # provenance: sha256, publisher, year/accessed, sourceUrl, accessGate (Task 2 seeds; research appends)
    _collection-worklist.tsv    # how each source was obtained (Task 2 seeds; research appends)
    US-XX/                      # per-jurisdiction captured pages (created during research)
    NATIONAL/                   # captured national-source pages
  extract/
    national.json               # the national safety net (Task 5)
    group-00-spike.json         # the 6 verified spike jurisdictions (Task 5)
    group-01-al-id.json ...     # per-group research extractions (Tasks 6+)
  pipeline/
    validate.py                 # dataset invariants — the "test" (Task 2)
    merge_profiles.py           # extract/*.json → profiles.json (Task 3)
  build_viewer.py               # profiles.json → viewer.html (Task 4)
  profiles.json                 # THE DATASET (generated — never hand-edit)
  viewer.html                   # generated verify/needs-fix coverage map (never hand-edit)
  group-01-al-id.md ...         # human-readable research drafts w/ ✅/⚠️/❓ markers (Tasks 6+)
```

**Dataset shape (`profiles.json`, authored via `extract/*.json`):**

```json
{
  "schemaVersion": 1,
  "national": [{ "<resource>": "..." }],
  "jurisdictions": {
    "US-CA": {
      "fips": "06",
      "code": "CA",
      "name": "California",
      "source": "US-CA",
      "resources": [{ "<resource>": "..." }]
    }
  }
}
```

**Resource object (the unit of provenance):**

```json
{
  "name": "Lawyer Assistance Program (LAP)",
  "operator": "State Bar of California",
  "operatorType": "stateBar",
  "scope": "statewide",
  "url": "https://www.calbar.ca.gov/legal-professionals/legal-resource-center/lawyer-assistance-program",
  "phones": [
    {
      "number": "877-527-4435",
      "label": "Confidential intake",
      "availability": "unspecified",
      "hoursNote": "Hours not published"
    }
  ],
  "email": "LAP@calbar.ca.gov",
  "services": [
    "counseling",
    "substanceUse",
    "mentalHealth",
    "peerSupport",
    "monitoring",
    "financialAid"
  ],
  "confidential": "Confidential by statute (Bus. & Prof. Code §6234)",
  "cost": "Some services free; fees may apply",
  "description": "State Bar of California program: confidential assessment, short-term counseling, peer support, and referrals for lawyers, applicants, and law students.",
  "confidence": "HIGH",
  "sourceUrl": "https://www.calbar.ca.gov/legal-professionals/legal-resource-center/lawyer-assistance-program",
  "sourceTier": "primary-official",
  "verifiedOn": "2026-07-02",
  "notes": ""
}
```

**Enumerations (single source of truth — `pipeline/validate.py` enforces):**

- `operatorType`: `stateBar | nonprofit | court | vendor | national`
- `scope`: `statewide | metro | national`
- `availability`: `aroundTheClock | businessHours | unspecified`
- `service`: `counseling | substanceUse | mentalHealth | peerSupport | crisisLine | teletherapy | financialAid | familySupport | monitoring`
- `confidence`: `HIGH | MEDIUM | LOW | NA`
- `sourceTier`: `primary-official | corroborated | secondary`

---

### Task 1: Corpus scaffold + README + provenance seed files

**Files:**

- Create: `docs/research/wellbeing-resources/README.md`
- Create: `docs/research/wellbeing-resources/.gitignore`
- Create: `docs/research/wellbeing-resources/sources/_collection-worklist.tsv`
- Create: `docs/research/wellbeing-resources/sources/manifest.yaml`

**Interfaces:**

- Consumes: nothing (first task).
- Produces: the directory tree and the `README.md` schema/legend that every later task follows; `manifest.yaml` + `_collection-worklist.tsv` that research tasks append to.

- [ ] **Step 1: Create the README (schema, legend, run order)**

Create `docs/research/wellbeing-resources/README.md`:

````markdown
# Wellbeing Resources — Research Corpus

Per-jurisdiction lawyer mental-health / emotional-support resources (State Bar Lawyer Assistance
Programs + affiliated hotlines/peer networks/clinical vendors) + a permanent national safety net.
Feeds the Phase B package `@magna-carta/wellbeing-resources`. Design spec:
`docs/superpowers/specs/2026-07-02-wellbeing-resources-design.md`.

## Confidence legend

- ✅ `HIGH` — confirmed from a directly-fetched primary-official source this session.
- ⚠️ `MEDIUM` — partial: corroborated or secondary source only.
- ❓ `LOW` — general knowledge, unverified against a fetched source. Must be resolved before Phase B.
- `NA` — jurisdiction has no program; resolves to the national safety net by design (an answer, not a gap).

## Dataset

`profiles.json` is generated — never hand-edit it or `viewer.html`. Author data in `extract/*.json`,
then run the pipeline. Provenance lives at the **resource** level (`confidence`, `sourceUrl`,
`sourceTier`, `verifiedOn`).

## Run order (from this directory)

```
python pipeline/merge_profiles.py    # extract/*.json → profiles.json
python pipeline/validate.py          # invariant check (exit non-zero on violation)
python build_viewer.py               # profiles.json → viewer.html
```

Windows: prefix with `PYTHONIOENCODING=utf-8`.

## Discipline

Every HIGH/MEDIUM value rests on a verbatim quote from an official source fetched this session —
never training recall. We author the national crisis numbers (988) ourselves; never trust a state
page to be current. `availability` is `aroundTheClock` only where the page states 24/7.
````

- [ ] **Step 2: Create `.gitignore` for captured binaries**

Create `docs/research/wellbeing-resources/.gitignore`:

```gitignore
# Captured source pages can be large; keep the .txt extractions and manifest in git,
# ignore heavy binaries unless a source needs its exact bytes committed.
sources/**/*.pdf
```

- [ ] **Step 3: Seed the provenance tracking files**

Create `docs/research/wellbeing-resources/sources/_collection-worklist.tsv` with a header row:

```tsv
sourceKey	jurisdiction	sourceUrl	method	accessedOn	notes
```

Create `docs/research/wellbeing-resources/sources/manifest.yaml`:

```yaml
# Provenance for every captured source. Research tasks append one entry per fetched page.
# sha256 is of the captured .txt extraction (or .html/.pdf where committed).
schemaVersion: 1
sources: []
```

- [ ] **Step 4: Commit**

```bash
git add docs/research/wellbeing-resources/README.md docs/research/wellbeing-resources/.gitignore docs/research/wellbeing-resources/sources/_collection-worklist.tsv docs/research/wellbeing-resources/sources/manifest.yaml
git commit -m "docs(wellbeing): scaffold research corpus (README, provenance seed files)"
```

---

### Task 2: Dataset validator (`pipeline/validate.py`)

**Files:**

- Create: `docs/research/wellbeing-resources/pipeline/validate.py`
- Create (temporary test fixtures, deleted at end of task): `docs/research/wellbeing-resources/pipeline/_fixture_ok.json`, `_fixture_bad.json`

**Interfaces:**

- Consumes: a `profiles.json`-shaped dict (the dataset shape from File Structure).
- Produces: `validate(data: dict) -> list[str]` returning a list of violation strings (empty = valid); a CLI `python pipeline/validate.py [path]` that prints violations and exits 1 if any. Later tasks call it as the data "test".

- [ ] **Step 1: Write the validator with an inline self-test**

Create `docs/research/wellbeing-resources/pipeline/validate.py`:

```python
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
```

- [ ] **Step 2: Run the self-test to verify it passes**

Run (from `docs/research/wellbeing-resources/`):

```bash
PYTHONIOENCODING=utf-8 python pipeline/validate.py --selftest
```

Expected: `selftest passed: OK fixture clean; BAD fixture raised N violations` (N ≥ 8), exit 0.

- [ ] **Step 3: Commit**

```bash
git add docs/research/wellbeing-resources/pipeline/validate.py
git commit -m "docs(wellbeing): dataset validator with invariant self-test"
```

---

### Task 3: Merge pipeline (`pipeline/merge_profiles.py`)

**Files:**

- Create: `docs/research/wellbeing-resources/pipeline/merge_profiles.py`

**Interfaces:**

- Consumes: `extract/national.json` (`{"national": [...]}`) and `extract/group-*.json` (`{"jurisdictions": {"US-XX": {...}}}`).
- Produces: `profiles.json` with `{schemaVersion, national, jurisdictions}`; a CLI `python pipeline/merge_profiles.py`. Fails loudly on duplicate jurisdiction keys across group files.

- [ ] **Step 1: Write the merge script**

Create `docs/research/wellbeing-resources/pipeline/merge_profiles.py`:

```python
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
```

- [ ] **Step 2: Smoke-test the merge against a throwaway fixture**

Run (from `docs/research/wellbeing-resources/`):

```bash
mkdir -p extract
echo '{"national":[]}' > extract/national.json
echo '{"jurisdictions":{"US-ZZ":{"fips":"00","code":"ZZ","name":"Test","source":"US-ZZ","resources":[]}}}' > extract/group-99-tmp.json
PYTHONIOENCODING=utf-8 python pipeline/merge_profiles.py
```

Expected: `merged: 0 national + 1 jurisdictions -> profiles.json`, and `profiles.json` exists with the `US-ZZ` key.

- [ ] **Step 3: Remove the throwaway fixtures**

Run:

```bash
rm extract/group-99-tmp.json profiles.json
```

(Leave `extract/national.json` empty-stub in place; Task 5 fills it.)

- [ ] **Step 4: Commit**

```bash
git add docs/research/wellbeing-resources/pipeline/merge_profiles.py
git commit -m "docs(wellbeing): merge pipeline (extract/*.json -> profiles.json)"
```

---

### Task 4: Viewer generator (`build_viewer.py`)

**Files:**

- Create: `docs/research/wellbeing-resources/build_viewer.py`

**Interfaces:**

- Consumes: `profiles.json`.
- Produces: `viewer.html` — a self-contained page listing the national safety net (pinned) and every jurisdiction's resources, each with a verify / needs-fix toggle (state persisted in `localStorage`) and confidence/coverage filters. CLI `python build_viewer.py`.

- [ ] **Step 1: Write the viewer generator**

Create `docs/research/wellbeing-resources/build_viewer.py`:

```python
#!/usr/bin/env python3
"""Generate viewer.html from profiles.json — a human verify/needs-fix coverage map.
Run from docs/research/wellbeing-resources/. Never hand-edit viewer.html; regenerate.
"""
import html
import json
from pathlib import Path

ROOT = Path(__file__).parent


def esc(x):
    return html.escape(str(x if x is not None else ""))


def phone_html(p):
    tag = {"aroundTheClock": "24/7", "businessHours": "business hrs", "unspecified": "hours n/a"}
    return (f'<span class="phone">{esc(p.get("number"))}'
            f' <em>{esc(p.get("label",""))} · {tag.get(p.get("availability"),"")}</em></span>')


def resource_html(r, jkey, idx):
    rid = f"{jkey}:{idx}"
    phones = " ".join(phone_html(p) for p in r.get("phones", []))
    url = r.get("url")
    link = f'<a href="{esc(url)}" target="_blank" rel="noreferrer">{esc(url)}</a>' if url else "<i>no url</i>"
    services = ", ".join(esc(s) for s in r.get("services", []))
    return f"""
    <div class="resource" data-conf="{esc(r.get('confidence'))}" data-id="{esc(rid)}">
      <div class="rhead">
        <b>{esc(r.get('name'))}</b>
        <span class="conf conf-{esc(r.get('confidence'))}">{esc(r.get('confidence'))}</span>
        <span class="tier">{esc(r.get('sourceTier'))}</span>
        <span class="optype">{esc(r.get('operatorType'))} · {esc(r.get('scope'))}</span>
        <span class="verified">verified {esc(r.get('verifiedOn'))}</span>
      </div>
      <div class="rbody">
        <div>{esc(r.get('operator'))}</div>
        <div>{link}</div>
        <div class="phones">{phones}</div>
        <div class="svc">{services}</div>
        <div class="meta">{esc(r.get('confidential',''))} · {esc(r.get('cost',''))}</div>
        <div class="desc">{esc(r.get('description',''))}</div>
        <div class="src">source: <a href="{esc(r.get('sourceUrl'))}" target="_blank" rel="noreferrer">{esc(r.get('sourceUrl'))}</a></div>
      </div>
      <div class="actions">
        <button class="verify" onclick="mark('{esc(rid)}','verify')">verify</button>
        <button class="needsfix" onclick="mark('{esc(rid)}','needsfix')">needs-fix</button>
        <span class="state" id="st-{esc(rid)}"></span>
      </div>
    </div>"""


def main():
    data = json.loads((ROOT / "profiles.json").read_text(encoding="utf-8"))
    nat = "".join(resource_html(r, "NATIONAL", i) for i, r in enumerate(data.get("national", [])))
    blocks = []
    for jkey, j in data.get("jurisdictions", {}).items():
        rs = "".join(resource_html(r, jkey, i) for i, r in enumerate(j.get("resources", [])))
        blocks.append(f'<section class="jx" data-code="{esc(j.get("code"))}">'
                      f'<h2>{esc(j.get("name"))} <small>{esc(j.get("code"))} · {esc(j.get("fips"))}</small></h2>{rs}</section>')
    count = len(data.get("jurisdictions", {}))
    page = f"""<!doctype html><html><head><meta charset="utf-8"><title>Wellbeing Resources — Coverage</title>
<style>
 body{{font:14px system-ui,sans-serif;margin:0;background:#f6f7f9;color:#1a1a1a}}
 header{{position:sticky;top:0;background:#fff;border-bottom:1px solid #ddd;padding:10px 16px;z-index:5}}
 .national{{background:#fff8e6;border:1px solid #e8d48a;margin:12px 16px;padding:8px 12px;border-radius:8px}}
 section.jx{{margin:12px 16px}}
 h2{{font-size:16px;margin:8px 0}} h2 small{{color:#888;font-weight:400}}
 .resource{{background:#fff;border:1px solid #e2e4e8;border-radius:8px;padding:8px 12px;margin:6px 0}}
 .rhead{{display:flex;gap:10px;align-items:center;flex-wrap:wrap}}
 .conf{{font-size:11px;padding:1px 6px;border-radius:10px;color:#fff}}
 .conf-HIGH{{background:#2e7d32}} .conf-MEDIUM{{background:#ef6c00}} .conf-LOW{{background:#c62828}} .conf-NA{{background:#607d8b}}
 .tier,.optype,.verified{{font-size:11px;color:#666}}
 .rbody div{{margin:2px 0}} .phone em{{color:#666;font-style:normal;font-size:12px}}
 .src{{font-size:11px;color:#888}} .actions{{margin-top:6px}}
 button{{cursor:pointer;border:1px solid #ccc;background:#fafafa;border-radius:6px;padding:3px 10px;margin-right:6px}}
 .state{{font-weight:600}} .st-verify{{color:#2e7d32}} .st-needsfix{{color:#c62828}}
 [data-conf][hidden]{{display:none}}
</style></head><body>
<header>
 <b>Wellbeing Resources — Coverage</b> · {count} jurisdictions
 &nbsp; filter:
 <label><input type=checkbox class=cf value=HIGH checked>HIGH</label>
 <label><input type=checkbox class=cf value=MEDIUM checked>MEDIUM</label>
 <label><input type=checkbox class=cf value=LOW checked>LOW</label>
 <label><input type=checkbox class=cf value=NA checked>NA</label>
</header>
<div class="national"><h2>National safety net (always present)</h2>{nat}</div>
{''.join(blocks)}
<script>
 function mark(id,kind){{localStorage.setItem('wb:'+id,kind);render(id);}}
 function render(id){{var k=localStorage.getItem('wb:'+id)||'';var el=document.getElementById('st-'+id);
   if(el){{el.textContent=k?('→ '+k):'';el.className='state st-'+k;}}}}
 document.querySelectorAll('.resource').forEach(function(r){{render(r.dataset.id);}});
 function applyFilters(){{var on={{}};document.querySelectorAll('.cf').forEach(function(c){{on[c.value]=c.checked;}});
   document.querySelectorAll('.resource').forEach(function(r){{r.hidden=!on[r.dataset.conf];}});}}
 document.querySelectorAll('.cf').forEach(function(c){{c.addEventListener('change',applyFilters);}});
</script>
</body></html>"""
    (ROOT / "viewer.html").write_text(page, encoding="utf-8")
    print(f"built viewer.html for {count} jurisdictions + {len(data.get('national', []))} national")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Defer running until Task 5 has data**

The viewer needs a real `profiles.json`; it is exercised at the end of Task 5. No run here.

- [ ] **Step 3: Commit**

```bash
git add docs/research/wellbeing-resources/build_viewer.py
git commit -m "docs(wellbeing): viewer generator (profiles.json -> coverage map)"
```

---

### Task 5: Seed national safety net + the 6 verified spike jurisdictions

Uses data already gathered in the 2026-07-02 spike (CA/TX/NY/WY/SD + national) — **not new research.** This proves the whole pipeline end-to-end before any gated research begins.

**Files:**

- Modify: `docs/research/wellbeing-resources/extract/national.json`
- Create: `docs/research/wellbeing-resources/extract/group-00-spike.json`
- Generated: `profiles.json`, `viewer.html`

**Interfaces:**

- Consumes: the resource shape (File Structure) + enums (validator).
- Produces: a valid seeded `profiles.json` with `national` populated and jurisdictions `US-CA, US-TX, US-NY, US-WY, US-SD`.

- [ ] **Step 1: Author the national safety net**

Write `docs/research/wellbeing-resources/extract/national.json`:

```json
{
  "national": [
    {
      "name": "988 Suicide & Crisis Lifeline",
      "operator": "SAMHSA / Vibrant Emotional Health",
      "operatorType": "national",
      "scope": "national",
      "url": "https://988lifeline.org/",
      "phones": [
        {
          "number": "988",
          "label": "Call, text, or chat",
          "availability": "aroundTheClock",
          "hoursNote": "24/7/365"
        }
      ],
      "services": ["crisisLine", "mentalHealth"],
      "confidential": "Free and confidential",
      "cost": "Free",
      "description": "US national crisis line for anyone in emotional distress or thinking about suicide — call, text, or chat, 24/7.",
      "confidence": "HIGH",
      "sourceUrl": "https://988lifeline.org/",
      "sourceTier": "primary-official",
      "verifiedOn": "2026-07-02"
    },
    {
      "name": "SAMHSA National Helpline",
      "operator": "Substance Abuse and Mental Health Services Administration",
      "operatorType": "national",
      "scope": "national",
      "url": "https://www.samhsa.gov/find-help/helplines/national-helpline",
      "phones": [
        {
          "number": "1-800-662-4357",
          "label": "Treatment referral & information",
          "availability": "aroundTheClock",
          "hoursNote": "24/7/365, English & Spanish"
        }
      ],
      "services": ["substanceUse", "mentalHealth"],
      "confidential": "Free and confidential",
      "cost": "Free",
      "description": "Confidential treatment referral and information service for mental-health and substance-use disorders.",
      "confidence": "HIGH",
      "sourceUrl": "https://www.samhsa.gov/find-help/helplines/national-helpline",
      "sourceTier": "primary-official",
      "verifiedOn": "2026-07-02"
    },
    {
      "name": "ABA Commission on Lawyer Assistance Programs (CoLAP) — Directory of state programs",
      "operator": "American Bar Association",
      "operatorType": "national",
      "scope": "national",
      "url": "https://www.americanbar.org/groups/lawyer_assistance/resources/lap_programs_by_state/",
      "phones": [],
      "services": ["peerSupport", "mentalHealth", "substanceUse"],
      "confidential": "Routes to confidential state programs",
      "cost": "Free",
      "description": "The ABA's maintained by-state directory of Lawyer Assistance Programs — the lawyer-specific fallback for finding a local program.",
      "confidence": "HIGH",
      "sourceUrl": "https://www.americanbar.org/groups/lawyer_assistance/",
      "sourceTier": "primary-official",
      "verifiedOn": "2026-07-02"
    }
  ]
}
```

- [ ] **Step 2: Author the 6 spike jurisdictions**

Write `docs/research/wellbeing-resources/extract/group-00-spike.json` from the verified spike findings. Include, at minimum, one HIGH resource per jurisdiction with real `url`/`phones`/`verifiedOn: "2026-07-02"`, plus the secondary resources the spike surfaced (NY's NYC Bar metro program as a second `US-NY` resource with `scope: "metro"`; TX's Sheeran-Crowley Trust as a `nonprofit`/`financialAid` resource; WY's WPAP as a `vendor` resource):

```json
{
  "jurisdictions": {
    "US-CA": {
      "fips": "06",
      "code": "CA",
      "name": "California",
      "source": "US-CA",
      "resources": [
        {
          "name": "Lawyer Assistance Program (LAP)",
          "operator": "State Bar of California",
          "operatorType": "stateBar",
          "scope": "statewide",
          "url": "https://www.calbar.ca.gov/legal-professionals/legal-resource-center/lawyer-assistance-program",
          "phones": [
            {
              "number": "877-527-4435",
              "label": "Confidential intake (877-LAP-4HELP)",
              "availability": "unspecified",
              "hoursNote": "Hours not published"
            }
          ],
          "email": "LAP@calbar.ca.gov",
          "services": [
            "counseling",
            "substanceUse",
            "mentalHealth",
            "peerSupport",
            "monitoring",
            "financialAid"
          ],
          "confidential": "Confidential by statute (Bus. & Prof. Code §6234)",
          "cost": "Some services free; fees may apply",
          "description": "State Bar of California program: confidential assessment, short-term counseling, peer support, and referrals for lawyers, applicants, and law students.",
          "confidence": "HIGH",
          "sourceUrl": "https://www.calbar.ca.gov/legal-professionals/legal-resource-center/lawyer-assistance-program",
          "sourceTier": "primary-official",
          "verifiedOn": "2026-07-02"
        }
      ]
    },
    "US-TX": {
      "fips": "48",
      "code": "TX",
      "name": "Texas",
      "source": "US-TX",
      "resources": [
        {
          "name": "Texas Lawyers' Assistance Program (TLAP)",
          "operator": "State Bar of Texas",
          "operatorType": "stateBar",
          "scope": "statewide",
          "url": "https://www.tlaphelps.org/",
          "phones": [
            {
              "number": "1-800-343-8527",
              "label": "Confidential helpline (1-800-343-TLAP)",
              "availability": "aroundTheClock",
              "hoursNote": "24/7"
            }
          ],
          "services": ["counseling", "substanceUse", "mentalHealth", "peerSupport", "crisisLine"],
          "confidential": "Confidential by statute",
          "cost": "Free",
          "description": "State Bar of Texas program: confidential 24/7 support, peer assistance, and referrals for lawyers, judges, and law students.",
          "confidence": "HIGH",
          "sourceUrl": "https://www.tlaphelps.org/",
          "sourceTier": "primary-official",
          "verifiedOn": "2026-07-02"
        },
        {
          "name": "Sheeran-Crowley Lawyer Wellness Trust",
          "operator": "Texas Lawyers Concerned for Lawyers",
          "operatorType": "nonprofit",
          "scope": "statewide",
          "url": "https://www.sheerancrowley.org/get-help",
          "phones": [],
          "services": ["financialAid", "substanceUse", "mentalHealth"],
          "confidential": "Works with TLAP",
          "cost": "Grants toward treatment for those in need",
          "description": "Nonprofit trust that funds treatment (paid to providers) for Texas legal professionals working with TLAP.",
          "confidence": "HIGH",
          "sourceUrl": "https://www.sheerancrowley.org/what-we-do",
          "sourceTier": "primary-official",
          "verifiedOn": "2026-07-02"
        }
      ]
    },
    "US-NY": {
      "fips": "36",
      "code": "NY",
      "name": "New York",
      "source": "US-NY",
      "resources": [
        {
          "name": "Lawyer Assistance Program (LAP)",
          "operator": "New York State Bar Association",
          "operatorType": "stateBar",
          "scope": "statewide",
          "url": "https://nysba.org/lawyer-assistance-program/",
          "phones": [
            {
              "number": "877-772-8835",
              "label": "Confidential hotline",
              "availability": "aroundTheClock",
              "hoursNote": "24/7"
            },
            {
              "number": "518-487-5669",
              "label": "Intake coordinator",
              "availability": "businessHours"
            }
          ],
          "services": [
            "counseling",
            "substanceUse",
            "mentalHealth",
            "peerSupport",
            "monitoring",
            "familySupport"
          ],
          "confidential": "Confidential under Judiciary Law §499",
          "cost": "Free (4 free counseling sessions/yr for members)",
          "description": "Statewide NYSBA program: free confidential support, referrals, and peer help for lawyers, judges, law students, and families.",
          "confidence": "HIGH",
          "sourceUrl": "https://nysba.org/lawyer-assistance-program/",
          "sourceTier": "primary-official",
          "verifiedOn": "2026-07-02"
        },
        {
          "name": "Lawyer Assistance Program (NYC)",
          "operator": "New York City Bar Association",
          "operatorType": "nonprofit",
          "scope": "metro",
          "url": "https://www.nycbar.org/serving-the-community/lawyer-assistance-program/",
          "phones": [
            {
              "number": "212-302-5787",
              "label": "Confidential helpline",
              "availability": "aroundTheClock",
              "hoursNote": "24/7"
            }
          ],
          "services": ["counseling", "substanceUse", "mentalHealth", "peerSupport"],
          "confidential": "Free and confidential (Judiciary Law §499)",
          "cost": "Free",
          "description": "NYC-area program (no bar membership required) for lawyers, judges, law students, and families in the five boroughs and Westchester.",
          "confidence": "HIGH",
          "sourceUrl": "https://www.nycbar.org/serving-the-community/lawyer-assistance-program/",
          "sourceTier": "primary-official",
          "verifiedOn": "2026-07-02"
        }
      ]
    },
    "US-WY": {
      "fips": "56",
      "code": "WY",
      "name": "Wyoming",
      "source": "US-WY",
      "resources": [
        {
          "name": "Wyoming Lawyer Assistance Program (WyLAP)",
          "operator": "Wyoming State Bar",
          "operatorType": "stateBar",
          "scope": "statewide",
          "url": "https://www.wyomingbar.org/for-lawyers/lawyer-resources/lawyer-assistance-program/",
          "phones": [
            {
              "number": "307-432-2101",
              "label": "WyLAP Director",
              "availability": "unspecified",
              "hoursNote": "Not a 24/7 crisis line"
            }
          ],
          "services": ["peerSupport", "substanceUse", "mentalHealth", "financialAid"],
          "confidential": "Strictly confidential",
          "cost": "Free intake",
          "description": "Wyoming State Bar program: confidential peer support and referrals; clinical services via a contracted provider (WPAP).",
          "confidence": "HIGH",
          "sourceUrl": "https://www.wyomingbar.org/for-lawyers/lawyer-resources/lawyer-assistance-program/",
          "sourceTier": "primary-official",
          "verifiedOn": "2026-07-02"
        },
        {
          "name": "Wyoming Professional Assistance Program (WPAP)",
          "operator": "WPAP (contracted provider)",
          "operatorType": "vendor",
          "scope": "statewide",
          "url": "https://wpapro.org/",
          "phones": [
            { "number": "307-472-1222", "label": "Direct line", "availability": "unspecified" }
          ],
          "services": ["counseling", "substanceUse", "mentalHealth", "monitoring"],
          "confidential": "Anonymous, confidential, voluntary",
          "cost": "Free evaluation/consultation",
          "description": "Independent professional-assistance program (serves multiple licensed professions) contracted for WyLAP's clinical evaluation, referral, and monitoring.",
          "confidence": "HIGH",
          "sourceUrl": "https://wpapro.org/",
          "sourceTier": "primary-official",
          "verifiedOn": "2026-07-02"
        }
      ]
    },
    "US-SD": {
      "fips": "46",
      "code": "SD",
      "name": "South Dakota",
      "source": "US-SD",
      "resources": [
        {
          "name": "Lawyers Assistance Program",
          "operator": "State Bar of South Dakota (Sand Creek / ALLONE Health)",
          "operatorType": "stateBar",
          "scope": "statewide",
          "url": "https://www.sdlawyerwellness.com/gethelp",
          "phones": [
            {
              "number": "1-888-243-5744",
              "label": "Sand Creek member assistance (24/7)",
              "availability": "aroundTheClock",
              "hoursNote": "24/7"
            },
            {
              "number": "605-391-5191",
              "label": "Lawyers Concerned for Lawyers peer contact",
              "availability": "unspecified"
            }
          ],
          "services": [
            "counseling",
            "substanceUse",
            "mentalHealth",
            "peerSupport",
            "crisisLine",
            "familySupport"
          ],
          "confidential": "Free, confidential assessment; records not shared with the Bar",
          "cost": "Free (short-term); cost-coverage project up to $500",
          "description": "South Dakota program on its own site: 24/7 assessment and short-term counseling via Sand Creek/ALLONE, plus confidential peer support.",
          "confidence": "HIGH",
          "sourceUrl": "https://www.sdlawyerwellness.com/gethelp",
          "sourceTier": "primary-official",
          "verifiedOn": "2026-07-02"
        }
      ]
    }
  }
}
```

- [ ] **Step 3: Merge, validate, and build the viewer**

Run (from `docs/research/wellbeing-resources/`):

```bash
PYTHONIOENCODING=utf-8 python pipeline/merge_profiles.py
PYTHONIOENCODING=utf-8 python pipeline/validate.py
PYTHONIOENCODING=utf-8 python build_viewer.py
```

Expected: merge reports `3 national + 5 jurisdictions`; validate prints `0 violation(s)` and exits 0; viewer reports `built viewer.html for 5 jurisdictions + 3 national`.

- [ ] **Step 4: Eyeball the viewer**

Open `docs/research/wellbeing-resources/viewer.html` in a browser. Confirm: the national safety net is pinned at top; all 5 states show; confidence filter toggles rows; verify/needs-fix buttons persist a state label after reload.

- [ ] **Step 5: Commit**

```bash
git add docs/research/wellbeing-resources/extract/national.json docs/research/wellbeing-resources/extract/group-00-spike.json docs/research/wellbeing-resources/profiles.json docs/research/wellbeing-resources/viewer.html
git commit -m "docs(wellbeing): seed national safety net + 6 verified spike jurisdictions"
```

---

## Gated research tasks (Task 6+) — DO NOT START WITHOUT OWNER GO-AHEAD

Each group task is one research batch and follows the **same procedure** (spelled out in Task 6 and restated compactly per task). Groups exclude the 5 already-seeded states (CA, TX, NY, WY, SD).

**Shared research procedure (every group task performs these, per jurisdiction in the group):**

1. From the ABA CoLAP by-state directory (`https://www.americanbar.org/groups/lawyer_assistance/resources/lap_programs_by_state/` — **use a browser; it 403s automated fetch**) find the state's program(s).
2. Open each program's **own official page**; capture it to `sources/US-XX/` (`.txt` extraction; PDF only if bytes matter) and append a `manifest.yaml` entry (sha256 of the `.txt`, publisher, `sourceUrl`, `accessedOn`) + a `_collection-worklist.tsv` row.
3. Record findings in `group-NN-*.md` with the `✅/⚠️/❓` marker per resource.
4. Author the jurisdiction's resources into `extract/group-NN-*.json` — **verbatim-grounded**; `confidence: HIGH` only with a fetched primary-official page; capture multiple resources where they exist (statewide + metro + vendor/nonprofit); set `availability` honestly; `verifiedOn` = today.
5. `python pipeline/merge_profiles.py && python pipeline/validate.py` → must exit 0.
6. `python build_viewer.py`; spot-check the new rows.
7. Commit the group's `sources/`, `group-NN-*.md`, `extract/group-NN-*.json`, regenerated `profiles.json` + `viewer.html`.

### Task 6: Research group 01 — AL AK AZ AR CO CT DE DC FL GA HI ID

**Files:** Create `extract/group-01-al-id.json`, `group-01-al-id.md`, `sources/US-{AL,AK,AZ,AR,CO,CT,DE,DC,FL,GA,HI,ID}/*`; append `sources/manifest.yaml`, `sources/_collection-worklist.tsv`; regenerate `profiles.json`, `viewer.html`.

- [ ] **Step 1:** Perform the shared research procedure (steps 1–4 above) for each of: Alabama, Alaska, Arizona, Arkansas, Colorado, Connecticut, Delaware, District of Columbia, Florida, Georgia, Hawaii, Idaho. FIPS: AL 01, AK 02, AZ 04, AR 05, CO 08, CT 09, DE 10, DC 11, FL 12, GA 13, HI 15, ID 16.
- [ ] **Step 2:** Run `PYTHONIOENCODING=utf-8 python pipeline/merge_profiles.py && PYTHONIOENCODING=utf-8 python pipeline/validate.py`. Expected: exit 0, `0 violation(s)`.
- [ ] **Step 3:** Run `PYTHONIOENCODING=utf-8 python build_viewer.py`; open `viewer.html`; confirm the 12 new jurisdictions render with HIGH/MEDIUM confidence and real contacts.
- [ ] **Step 4:** Commit: `git add docs/research/wellbeing-resources && git commit -m "docs(wellbeing): research group 01 (AL–ID)"`.

### Task 7: Research group 02 — IL IN IA KS KY LA ME MD MA MI MN MS

**Files:** Create `extract/group-02-il-ms.json`, `group-02-il-ms.md`, `sources/US-{IL,IN,IA,KS,KY,LA,ME,MD,MA,MI,MN,MS}/*`; append manifest + worklist; regenerate dataset + viewer.

- [ ] **Step 1:** Shared research procedure for: Illinois, Indiana, Iowa, Kansas, Kentucky, Louisiana, Maine, Maryland, Massachusetts, Michigan, Minnesota, Mississippi. FIPS: IL 17, IN 18, IA 19, KS 20, KY 21, LA 22, ME 23, MD 24, MA 25, MI 26, MN 27, MS 28.
- [ ] **Step 2:** `python pipeline/merge_profiles.py && python pipeline/validate.py` → exit 0.
- [ ] **Step 3:** `python build_viewer.py`; spot-check new rows.
- [ ] **Step 4:** Commit: `git add docs/research/wellbeing-resources && git commit -m "docs(wellbeing): research group 02 (IL–MS)"`.

### Task 8: Research group 03 — MO MT NE NV NH NJ NM NC ND OH OK OR

**Files:** Create `extract/group-03-mo-or.json`, `group-03-mo-or.md`, `sources/US-{MO,MT,NE,NV,NH,NJ,NM,NC,ND,OH,OK,OR}/*`; append manifest + worklist; regenerate dataset + viewer.

- [ ] **Step 1:** Shared research procedure for: Missouri, Montana, Nebraska, Nevada, New Hampshire, New Jersey, New Mexico, North Carolina, North Dakota, Ohio, Oklahoma, Oregon. FIPS: MO 29, MT 30, NE 31, NV 32, NH 33, NJ 34, NM 35, NC 37, ND 38, OH 39, OK 40, OR 41.
- [ ] **Step 2:** `python pipeline/merge_profiles.py && python pipeline/validate.py` → exit 0.
- [ ] **Step 3:** `python build_viewer.py`; spot-check new rows.
- [ ] **Step 4:** Commit: `git add docs/research/wellbeing-resources && git commit -m "docs(wellbeing): research group 03 (MO–OR)"`.

### Task 9: Research group 04 — PA RI SC TN UT VT VA WA WV WI

**Files:** Create `extract/group-04-pa-wi.json`, `group-04-pa-wi.md`, `sources/US-{PA,RI,SC,TN,UT,VT,VA,WA,WV,WI}/*`; append manifest + worklist; regenerate dataset + viewer.

- [ ] **Step 1:** Shared research procedure for: Pennsylvania, Rhode Island, South Carolina, Tennessee, Utah, Vermont, Virginia, Washington, West Virginia, Wisconsin. FIPS: PA 42, RI 44, SC 45, TN 47, UT 49, VT 50, VA 51, WA 53, WV 54, WI 55.
- [ ] **Step 2:** `python pipeline/merge_profiles.py && python pipeline/validate.py` → exit 0.
- [ ] **Step 3:** `python build_viewer.py`; spot-check new rows.
- [ ] **Step 4:** Commit: `git add docs/research/wellbeing-resources && git commit -m "docs(wellbeing): research group 04 (PA–WI)"`.

### Task 10: Research group 05 (best-effort) — territories PR GU VI AS MP

Territories may have no lawyer-specific program. Where none exists, author a single `NA`-confidence marker resource documenting the absence (so the jurisdiction is explicit, not missing) — it resolves to the national safety net by design.

**Files:** Create `extract/group-05-territories.json`, `group-05-territories.md`, `sources/US-{PR,GU,VI,AS,MP}/*` (where a source exists); append manifest + worklist; regenerate dataset + viewer.

- [ ] **Step 1:** Shared research procedure for: Puerto Rico, Guam, US Virgin Islands, American Samoa, Northern Mariana Islands. FIPS: PR 72, GU 66, VI 78, AS 60, MP 69. For any with no program, author one resource `{ "name": "No dedicated lawyer-assistance program found", "operatorType": "national", "scope": "national", "confidence": "NA", "verifiedOn": "<today>", "notes": "Resolves to the national safety net.", "phones": [], "url": "https://www.americanbar.org/groups/lawyer_assistance/resources/lap_programs_by_state/", "services": ["mentalHealth"], "sourceTier": "primary-official", "sourceUrl": "https://www.americanbar.org/groups/lawyer_assistance/resources/lap_programs_by_state/", "operator": "—" }` (the `url`/`sourceUrl` give the validator a contact + provenance).
- [ ] **Step 2:** `python pipeline/merge_profiles.py && python pipeline/validate.py` → exit 0.
- [ ] **Step 3:** `python build_viewer.py`; spot-check.
- [ ] **Step 4:** Commit: `git add docs/research/wellbeing-resources && git commit -m "docs(wellbeing): research group 05 (territories, best-effort)"`.

### Task 11: Verification pass + coverage close-out

Mirrors trust-rules' `group-5-verification-pass.md`: re-verify weak entries and confirm committed coverage.

**Files:** Create `group-06-verification-pass.md`; modify any `extract/group-*.json` needing fixes; regenerate `profiles.json` + `viewer.html`.

- [ ] **Step 1:** Add a coverage check to the validator run: confirm all 51 committed jurisdictions (50 states + DC) are present as keys in `profiles.json`. Command:

```bash
PYTHONIOENCODING=utf-8 python -c "import json;d=json.load(open('profiles.json',encoding='utf-8'));ks=set(d['jurisdictions']);exp={'US-'+c for c in 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split()};print('MISSING:',sorted(exp-ks));print('count',len(ks&exp),'/51')"
```

Expected: `MISSING: []` and `count 51 /51`.

- [ ] **Step 2:** In `viewer.html`, filter to `LOW` and `MEDIUM`; for each, re-open the source and upgrade to `HIGH` where a primary-official page confirms it, or leave a documented reason in `group-06-verification-pass.md`. Re-run merge + validate after edits.
- [ ] **Step 3:** Write `group-06-verification-pass.md` summarizing final tallies (per-confidence counts, any residual MEDIUM/LOW with reasons, territories status).
- [ ] **Step 4:** Final run: `python pipeline/merge_profiles.py && python pipeline/validate.py && python build_viewer.py`. Expected: `0 violation(s)`, coverage 51/51.
- [ ] **Step 5:** Commit: `git add docs/research/wellbeing-resources && git commit -m "docs(wellbeing): verification pass + 51/51 coverage close-out"`.

---

## Self-Review

**Spec coverage:**

- Source corpus w/ provenance manifest → Task 1 (seed), Tasks 6–10 (append). ✅
- `profiles.json` per-field... resource-level provenance `{confidence, sourceUrl, sourceTier, verifiedOn}` → schema in File Structure + enforced by Task 2 validator. ✅ (Deliberate adaptation from trust-rules' per-field provenance; noted in spec Phase A.)
- Regenerable pipeline, edit inputs not outputs → Tasks 3–4; README run order. ✅
- Verify/needs-fix viewer → Task 4; exercised Task 5; used Tasks 6–11. ✅
- 50 states + DC committed, territories best-effort → Tasks 6–10, coverage gate Task 11. ✅
- ABA CoLAP seed via browser (403s) → shared procedure step 1; national entry Task 5. ✅
- We own national crisis numbers; 988 always present → Task 5 national.json; validator requires 988. ✅
- Never infer 24/7 → validator `availability` enum + procedure step 4; spike data uses `unspecified` where hours unpublished (CA/WY). ✅
- `NA` = resolves to national safety net → validator allows NA; Task 10 territory pattern. ✅
- Gated research (no start without go-ahead) → Global Constraints + Task 6 header. ✅

**Placeholder scan:** no TBD/TODO; every code step carries complete runnable content; research tasks carry the concrete jurisdiction lists + FIPS, not "fill in states". The shared procedure is stated once and restated per group (concrete states differ) — not a "similar to Task N" reference.

**Type consistency:** enum names (`operatorType`, `scope`, `availability`, `service`, `confidence`, `sourceTier`) match between the validator (Task 2), the seed data (Task 5), and the resource schema (File Structure). `merge_profiles.py` output keys (`schemaVersion`, `national`, `jurisdictions`) match `validate.py` and `build_viewer.py` readers. Jurisdiction key form `US-XX` consistent throughout.
