---
category: Fixed
---

- **The narrative trust-rules catalog no longer cites a repealed rule for the home jurisdiction, and
  every entry nobody can check is now marked as exactly that.** The 56-jurisdiction research catalog's
  Nevada entry — compiled as "verified in full" — cited SCR 78.5 throughout, a rule repealed in 2019;
  it is corrected against the primary-source research records
  (`docs/research/2026-08-07-nevada-trust-accounting-rules.md` and the unclaimed-funds/escheat
  record), including the five-year retention figure's two distinct clocks, the finding that Nevada
  mandates no reconciliation at any cadence (the State Bar handbook's monthly-reconciliation claim
  miscites a subsection about banks remitting interest), and that designated client trust accounts do
  not escheat under Nevada's unclaimed-property act — unclaimed trust funds follow NRPC 1.15(f) to
  the Clients' Security Fund, permissively, on a from-receipt clock. Every one of the 55 sibling
  entries came from the same research pass and has no primary source in the repository to check
  against, so each file now carries a banner stating those entries are NOT VERIFIED whatever their
  compiled confidence label — research leads, not findings.
- **The trust-jurisdictions review gate is hardened before anything binds to it.** An attorney review
  now binds to a revision string derived from the profile's content (authored date plus a content
  fingerprint), so an amendment that forgets the revision bump closes the gate instead of silently
  inheriting the attestation. The two newer jurisdiction refusals — rules encoded but not
  attorney-reviewed, and a reviewed jurisdiction's unresearched field — now map to the same
  trust-jurisdiction-unavailable problem type as their siblings instead of falling to the generic
  movement-refused catch-all. A source-scan fitness test guards the review-the-corpus display seam:
  a surface reaching an unreviewed value's `.value` outside the gate fails the scan unless it carries
  an explicit display-only marker. And the silence-resolved singleton values (no prohibited methods,
  no reconciliation required) are frozen, so no caller can mutate the shared answer every later
  caller receives.
