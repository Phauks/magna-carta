---
category: Changed
audience: public
---

**Firm Profile is the firm's name alone; the marks moved to a new Firm Brand page, and Rooms and Resources moved under Firm.** `settings/firm-profile/+page.svelte` drops its offices plate (a copy of the Offices register) and its brand-images plate; the plate moved unchanged to `settings/firm-brand/`, registered as the `firm-brand` section in `apps/web/src/lib/settings/settings-sections.ts` and gated on the same `firm:manageProfile` the brand-image routes enforce. The `resources` section's group is now `firm`, and its catalog's actions column is one `DropdownMenu` behind an icon-sized trigger rather than a button per act.

## Public

**Firm settings are tidier.** **Firm Profile** now holds just the firm's name, and the firm's logo and other brand images have their own page, **Settings › Firm › Firm Brand**. The list of offices no longer appears on Firm Profile, since **Offices** already shows it. **Rooms and Resources** moved from Practice to Firm, and each resource's **Change**, **Retire** and **Restore** now sit in a **...** menu at the end of its row.
