---
category: Changed
audience: public
---

**UI copy rewrite, first batch.** About 260 user-facing strings across `apps/web` rewritten in place, with no behaviour or layout change: the "Nothing answered" transport-failure lines (about forty wordings) become "Couldn't connect." plus what did not happen, em dashes leave UI strings, and the matter section descriptions in `apps/web/src/lib/matters/sections.ts` are cut to one line each. Conflicts, meetings, directory, signing, Magnus and the PDF editor are untouched until their open work lands. Tests that quoted the old copy move with it.

## Public

**Shorter, plainer messages.** When a save or a load can't reach Magna Carta, the message now says "Couldn't connect." and what didn't happen. Long help lines on matter sections, settings, billing, trust, the calendar, files, discovery and sign-in were cut down to what you need to act.
