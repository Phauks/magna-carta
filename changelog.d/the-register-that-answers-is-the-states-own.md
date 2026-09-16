---
category: Added
audience: public
---

**Attorney License Lookup has a screen** — the fourth tool page, and the first of the five the catalogue still owed. Pick a state, get that state's official attorney register, open it beside your work. It reads nothing back and stores nothing: the tool is a link generator (`backing: library`), and the registers are the authority, so a copy of one of their answers held here and going stale would be worse than no answer — a suspension is exactly the fact that changes after you look.

The branching lives in `$lib/tools/attorney-license/attorney-license.ts`, DOM-free and tested, the same split the WHOIS tool keeps. The state list comes from `@magna-carta/government-links`, whose licensing registry gained the state's own `name`: it was previously recoverable only by taking a suffix off the site's display label, and the alternative was a second hand-written list of the fifty states. The screen imports the `/licensing` entry point rather than `/registry`, so rendering a state picker does not ship fifty states of county assessor tables to the browser.

Two of the fifty-one registers are served over plain HTTP (Rhode Island's judiciary search and Washington's). That is a fact about US government portals rather than a transcription error, and the screen says so before the link instead of after it: on such a page the lawyer being asked about, and the answer, are readable by anything on the path. The link is still offered, because the register is the authority whatever it is served over.

The catalogue entry's description changed with it. It said the tool would "check a lawyer's bar standing and discipline history", which promised an answer this platform never sees.

## Public

**You can now open any state's official attorney register from Tools.** Choose a state and Magna Carta takes you to the page where that state verifies a lawyer's licence and standing — the bar association's directory in most states, the judiciary's or disciplinary board's search in the rest. All fifty states and the District of Columbia are covered.

Magna Carta does not look the lawyer up for you and does not keep what you find. The register is the authority, and standing can change the day after you check, so you always read it live and first-hand. Where a state publishes its register without encryption, the screen tells you before you go.
