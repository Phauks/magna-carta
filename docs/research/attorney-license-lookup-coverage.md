# Attorney-License Lookup Coverage (government-links `licensing` domain)

**Date:** 2026-06-16
**Scope:** Per-state public attorney-license search URLs for `@magna-carta/government-links` (`licensing` domain, `src/licensing/attorney-license.ts`). Records the two states that have **no public online search** and the authority that proves it.

## Status

All 51 jurisdictions (50 states + DC) carry an official attorney-lookup URL, verified by manual review (open the page, search a name/bar number, confirm it returns the attorney's record/status). **49 are real online name-or-bar-number searches.** Two are not, and link to the official verification entry point instead:

| State | Why no online search | Official authority (the link we point at) |
| ----- | -------------------- | ----------------------------------------- |
| **New Hampshire** (33) | The NH Office of Professional Licensure and Certification does **not** license attorneys, and the NH Bar Association's member directory is not a public instant search. Verification is **by request form / phone**. | NH Bar Association — [Attorney Verification / Good Standing Request](https://www.nhbar.org/attorney-verification-good-standing-request/). Disciplinary records: NH Supreme Court Attorney Discipline System. |
| **South Dakota** (46) | The State Bar of South Dakota (the mandatory bar and regulator) publishes no confirmed public online attorney search; verification is **by contact / phone**. | [State Bar of South Dakota](https://www.statebarofsouthdakota.com/) (mandatory bar, created by the SD Legislature in 1931; all SD attorneys must be active members). |

Both are unified (mandatory) bars, so the bar/regulator is the authoritative source even though it offers no instant lookup. If either publishes an online search later, swap the URL in `attorney-license.ts`.

## Note on the authority varying by state

The licensing authority is not uniform: most states use the mandatory bar's member directory; non-unified-bar states use the judiciary / supreme court / attorney-regulation / disciplinary board (e.g. New York OCA, Ohio Supreme Court, Illinois ARDC, Colorado Office of Attorney Regulation, New Jersey Disciplinary Review Board, Minnesota MARS, North Dakota Courts). A "Find a Lawyer" *referral* directory is **not** acceptable — it lists only paid participants, not the full roster — so those were rejected during review in favor of the full licensee/member search.
