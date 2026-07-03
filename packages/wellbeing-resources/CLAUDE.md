# @magna-carta/wellbeing-resources — area rules

Per-jurisdiction lawyer mental-health / emotional-support resources (State Bar Lawyer Assistance
Programs and affiliated hotlines/peer networks/clinical vendors) plus a permanent national safety net
(988, SAMHSA, ABA CoLAP). Compiled reference data, like `@magna-carta/government-links` — no per-firm or
matter scoping.

## The data is generated — never hand-edit it

`src/data.generated.ts` is built from the research corpus `docs/research/wellbeing-resources/` (the
single source of truth). To change the data:

1. Edit `docs/research/wellbeing-resources/extract/*.json` and re-run its pipeline
   (`docs/research/wellbeing-resources/pipeline`) to rebuild `profiles.json`.
2. Run `pnpm --filter @magna-carta/wellbeing-resources run build:data`.
3. Commit the regenerated `data.generated.ts` alongside the corpus change.

`pnpm --filter @magna-carta/wellbeing-resources run verify:data` fails if the committed file has drifted
from the corpus — keep them in lockstep in the same commit.

## Model invariants

- The **national safety net is unconditionally present** (988 first); accessors return it for every
  jurisdiction, covered or not.
- The shipped model carries only product-relevant fields. Research provenance (`confidence`,
  `sourceUrl`, `sourceTier`) is dropped by the generator; `verifiedOn` (ISO date) is kept.
- A jurisdiction with no dedicated program is `nationalFallbackOnly: true` with empty `resources` — an
  answer, not a gap.
- `availability: "aroundTheClock"` only where a source stated 24/7; never inferred.

## Surface

`./types` (model), `./registry` (accessors: `wellbeingResourcesForState`, `nationalResources`,
`allCoveredJurisdictions`, `isNationalFallbackOnly`), `./manifest` (`coverageManifest`). No barrel file
(`oxc/no-barrel-file`). Coverage map: `pnpm --filter @magna-carta/wellbeing-resources run directory`.
