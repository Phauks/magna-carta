# Wellbeing Resources — Verification Pass + Coverage Close-out (2026-07-02)

Mirrors trust-rules' `group-5-verification-pass.md`. This pass re-verified every `MEDIUM`
(corroborated) entry from the first research pass — chiefly ones where a state's official site
returned HTTP 403 / a TLS cert mismatch — mostly by loading an **archived snapshot** of the same
official page via the Wayback Machine (a citable primary source that bypasses the live block).

## Coverage

- **56/56 US jurisdictions covered** (50 states + DC + 5 territories). States+DC = 51/51, no gaps.
- Territories: **Guam** and **U.S. Virgin Islands** have real bar-run wellness/assistance committees
  (HIGH, official pages loaded). **Puerto Rico, American Samoa, Northern Mariana Islands** have no
  standing lawyer-assistance program → `NA`, resolving to the national safety net by design.

## Upgrades MEDIUM → HIGH (archived/dedicated official page confirmed)

| Jurisdiction | Resource                             | Confirmed via                                                                     |
| ------------ | ------------------------------------ | --------------------------------------------------------------------------------- |
| IA           | Iowa LAP (ILAP)                      | Wayback snapshot of iowalap.org (live TLS mismatch)                               |
| IA           | Esquire Assistance Program           | Wayback snapshot of iowacourts.gov — **24/7/365 confirmed verbatim**              |
| MS           | Mississippi LJAP                     | Wayback snapshot of msbar.org                                                     |
| NV           | NLAP + LCL                           | Wayback snapshots of nvbar.org (both pages)                                       |
| RI           | Lawyers Helping Lawyers              | Wayback snapshot of ribar.com — **24/7 confirmed verbatim**                       |
| VA           | VJLAP                                | Wayback snapshot of vjlap.org (own site) — 24-hour line + "without fee" confirmed |
| AL           | Alabama Lawyer Assistance Foundation | dedicated alabar.org ALAF page (live)                                             |
| KY           | KYLAP Foundation                     | kylap.org/get-involved (live)                                                     |
| NM           | In This Together Fund                | headless-browser load of the sbnm.org page                                        |
| ND           | ND LAP                               | official SBAND brochure PDF (already HIGH; entry corrected — see below)           |
| OH           | Toledo Bar MAP                       | search-index cache of the official toledobar.org page                             |
| GA           | Lawyers Helping Lawyers (peer)       | georgialhl.org (renders fine; earlier fetch had truncated)                        |

## Corrections made during verification (factual fixes, not just confidence bumps)

- **MS** — the first pass called 800-593-9777 a "24-hour hotline." The official page labels it
  **"Office (toll-free)"** with **no 24-hour claim** → availability changed to `unspecified`;
  `crisisLine` service removed; added the office (601-948-0989) and Director's Direct (601-948-4475)
  lines.
- **NV** — no "five free therapy sessions" on the official page (it's a **physician-led initial
  assessment funded by NLAP at no charge**); LCL is a **callback model**, not a live 24/7 line;
  confidentiality is statutory under **Nevada SCR 106.5**. Removed the session-count and 24/7 claims;
  dropped `teletherapy` from NLAP.
- **VT** — **`lapvt.org` is a defunct/parked domain** (Wayback shows an expired-domain placeholder
  by late 2023). URL repointed to the Vermont Bar wellness page; kept `MEDIUM`; flagged that
  operator/cost/hours are not primary-verified. (A distinct **VT Bar Assistance Program /
  Bar Counsel** line, 802-859-3004, is kept separate — not conflated with VT LAP.)
- **RI** — the EAP contractor named on the official page is **CorpCare**, not SupportLinc/CuraLinc;
  benefit is up to **eight** counseling sessions.
- **ND** — the claimed **ND-LAP ↔ "The Village Business Institute" EAP linkage was unverified and
  appears incorrect** (no official ND-LAP source names The Village; `thevillagebusinessinstitute.com`
  does not resolve). **Dropped that resource.** ND-LAP helpline corrected to **800-472-2685** (per
  sband.org); the official brochure carries no phone, so email (NorthDakotaLAP@gmail.com) is the
  primary contact.
- **KY** — `kylap.org/foundation` **404s**; the authoritative page is `kylap.org/get-involved/`.
- **AL** — the Foundation is a **revolving loan fund** (loans to providers, repaid on recovery), not
  a grant-maker; official name **Alabama Lawyer Assistance Foundation (ALAF)**; distinct from the
  Alabama Law Foundation.
- **NM** — the In This Together Fund gives **temporary** assistance to **NM LAP clients**
  (eligibility-limited), not open grants.
- **GU trap avoided** — search hits describing a SupportLinc/CuraLinc "Guam Bar" LAP were actually
  the **State Bar of Georgia** (gabar.org), discarded.

## Residual MEDIUM (3 — documented, not gaps)

- **VT — VT LAP** and **VT — Bar Counsel wellness**: the program's own site is defunct; verified only
  via the VBA wellness page. Re-check if VT LAP republishes an official site.
- **CO — Colorado Crisis Services**: the statewide 24/7 line COLAP/CLHL refer to; its own page was
  not loaded (the referral is confirmed on COLAP's page). Not lawyer-specific.
- **PR / AS / MP**: `NA` by design (no standing program) — an answer, not a gap.

## Method discipline (kept)

Every HIGH/MEDIUM value rests on a verbatim quote from a source loaded this session (live, archived,
or headless-browser). `aroundTheClock` only where a loaded page literally states 24/7. National crisis
numbers (988) are ours, never scraped per-state. `NA` = resolves to the national safety net.

## Final tally

- **56/56 jurisdictions**; **78 state/territory resources** (73 states/DC after dropping the bogus
  ND Village linkage + 5 territories) **+ 3 national = 81 total**. **0 validator violations.**
- Confidence after this pass: **72 HIGH · 3 MEDIUM · 3 NA**. MEDIUM = VT ×2 (defunct site) +
  CO Crisis Services (referred line). NA = PR/AS/MP.
