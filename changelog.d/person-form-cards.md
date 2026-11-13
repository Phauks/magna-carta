---
category: Changed
audience: public
---

**A record's sections are folding cards, and New Person reads the person back as a contact card.** `record-sections.svelte` draws each section as a bordered card whose header (a button with `aria-expanded`) carries the section's icon, name and count and folds the card; a jump from the rail unfolds it. The sections no longer repeat their name as a second heading inside the card ("Ways To Reach Them", "Addresses", "Sealed Identifiers", "Belongs To", "Other Name"). New Person's right column is `new-person-context.svelte`: the duplicate check states where it stands in one sentence, and the read-back shows the photo, name, pronouns and dates, then each fact marked by kind (`PersonSummaryLine.mark`).

## Public

**Each part of a person's record is a card you can fold away.** On New Person and in a record's window, every section sits in its own card with its name and how many entries it holds at the top; press the header to fold it, and choose it in the list on the left to open it again. Beside New Person, the Directory check says plainly whether anyone similar is already recorded, and below it the person is shown the way their record will open, photo and name first.
