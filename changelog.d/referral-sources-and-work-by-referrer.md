---
category: Added
audience: public
---

**Referrals and the Work by Referrer report.** A client (person or organization) can record how they found the firm: a Source picked from a list the firm keeps under Settings, Referral Sources (seeded with Past Client, Another Attorney, Friend or Family, Website, Search Engine, Advertisement and Other; add, rename, reorder, retire and restore), and an optional Referred By person or organization from the Directory. Either or both may be set. The record window's header reads "Referred by Daniel Okafor (Another Attorney)", the name opening that record; the About card holds a Referral row edited in place, and New Person and New Organization carry the same two fields. Work by Referrer, a new financial report, groups the Revenue report's billed and collected figures by each client's source and then by who referred them, with a Not recorded group, and its totals are Revenue's for the same period. Backed by `packages/directory/src/referrals.ts`, `packages/reporting/src/financial/work-by-referrer.ts` and the `20261120T195119_referral-sources` per-firm migration (additive). A merge moves a record's referrals onto the surviving record.

## Public

**Record how clients found you, and see what each referral source brought in.** Pick a Source from your firm's own list (kept under Settings, Referral Sources) and, if a person sent them, who referred them. The new Work by Referrer report shows what each source and each referrer's clients were billed and paid in a period.
