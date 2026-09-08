---
category: Fixed
audience: internal
---

**Four surfaces named the wrong day, and the gate that would have caught them now exists.** "Date Entered" on the time details panel and the time print sheet, the attachment date on the time record window, and "Created" on the invoice print sheet each rendered `createdAt.slice(0, 10)` — the **UTC** day of a stored instant — through a formatter that pins to UTC.

A record entered at 18:30 in Los Angeles has a `createdAt` of 01:30Z the next morning, so all four named the following day for every entry made after late afternoon in an American office. Two of them are print sheets that reach clients.

They now use `formatInstantDate`, which reads the day in the viewer's own zone. The two print-sheet contexts gained an `instantDate` member beside their existing `date`, because the two are not the same question: `date` is contracted as "a work date as a reader sees it" and pins to UTC so a recorded day never moves, and passing an instant's first ten characters through it was a misuse of that contract rather than only a formatting slip.

The date gate missed this: its rule matched `.toISOString().slice(0, 10)` and not a slice of a value already holding an instant, which is the form all four took. It now reads the receiver — a name that can only mean a moment — and found twenty-three more sites in the same shape. Those genuinely wanted the UTC day, so `civilDateOf` gained the string form and they say so by name; a slice is invisible to every scan, which is the whole reason the four bugs were written that way. `validFrom`/`validTo` are deliberately not read, because those columns hold a civil date at one end and an instant at the other by design.

Worth recording: this is the case a compile-time brand could not have caught. `createdAt.slice(0, 10)` produces a perfectly well-formed `YYYY-MM-DD`, so a branded type obtained by parsing accepts it. The value is not malformed — it is the wrong day, and only knowing where the string came from tells the two apart.
