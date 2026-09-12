---
category: Added
audience: public
---

**Settings · Offices, the firm's brand images on Firm Profile, and the office family under `apps/web/src/lib/offices/`.**

The whole locations backend had no screen. It now has one: a `DataTable.Grid` register over `GET /api/v1/locations` (which now joins each office's addresses, its staffing count, whether it prints its own logo and whether it is the firm's default), and one `RecordWindow` for entering, reading and correcting an office, with the entry segmented into Office, Addresses and Letterhead tabs on the left and the acts that commit on their own (members, the letterhead logo) in tabs on the right. `?office=<id>` opens a record on arrival, which is what `OfficeLink` links to.

The contract grows `location.email` (one per office; a telephone belongs to each address), the four international address lines and the country on `location_address` so the design system's `AddressFields` writes an office's address the way it writes anybody's, `PUT|DELETE /api/v1/locations/{id}/members/{userId}` composed onto the per-member replace-set, `PUT /api/v1/locations/{id}/firm-default` (without which the close refusal on the default office was unrecoverable), and `GET /api/v1/locations/{id}/letterhead-logo`, which streams the office's own mark or the firm's primary brand image. `firm_brand_image` is a new per-firm table, content-addressed by the bytes' SHA-256, behind `GET|PUT /api/v1/firm/profile/brand-images`, `PATCH|DELETE .../{sha256}` and `GET .../{sha256}/content`, all under `firm:manageProfile`. The office picker (`OfficePicker`), the link (`OfficeLink`) and the shared `firmOffices` read are the modular pieces the matter status window's Location consumes next.

## Public

**Offices have a screen.** Under Settings › Firm › Offices the firm's places of business are a table: name, standing, jurisdiction, time zone, numbering code, street address, telephone and how many members work there, with the email, the mailing address, the logo and the firm default a column-menu press away. A row opens the office's record, where it is entered, corrected, staffed, given its letterhead logo, made the firm's default or closed.

**An office has an email, and its addresses take the country's shape.** The street address and the mailing address are entered through the same country-shaped form every address in the product uses, each with its own telephone grouped the way that country writes numbers.

**The firm has its own marks.** Firm Profile holds a primary mark and any additional images beside it. Every office's letterhead prints the primary mark until that office is given a logo of its own, so a single-office firm sets its identity once.

**Firm Profile is the identity page.** The name, the marks, and the firm's offices with a link to each.
