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
