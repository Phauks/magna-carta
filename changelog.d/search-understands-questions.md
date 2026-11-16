---
category: Added
audience: public
---

**Search reads a question for a place, your matters and dates.** Typing "hargrove invoices since june" on the Search page now searches Billing for "hargrove" from June 1 on. The page reads a place ("invoices", "notes", "calls", "files"), "my matters", and dates ("last month", "since june", "between may 1 and june 30", "in 2025") out of the question by rule, shows each as a chip under the search box that can be taken away, and offers Search the Words Only. The search across matters (`GET /api/v1/search`) takes `from` and `to` days, held to the date each place is listed by, inside the visible-matter rule and before the limit. No model reads the question yet.

## Public

**Ask Search in your own words.** Type something like "hargrove invoices since june" and Search looks in Billing from June on. What it understood shows as chips under the box; click one to remove it.
