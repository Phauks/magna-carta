---
category: Added
audience: public
---

**A directory record has a More menu: copy its link, email it, or download it as a contact card.** `ActionDialog` takes an optional `menu` snippet, drawn first in its header controls as the same EllipsisVertical "More" dropdown the record window's kind's menu uses, so a record reads alike in either shell. The entity window fills it with Copy Link, Email Link and Download Contact Card; `contact-card.ts` builds a vCard 4.0 from the record and its contact points (name, a person's date of birth, and only the permitted, non-former emails, numbers and addresses), saved through `saveExport`.

## Public

**A Directory record can be shared or saved as a contact card.** The three-dot More button at the top of a person's or organization's record now offers Copy Link, Email Link, and Download Contact Card. The contact card is a .vcf file that phones, Outlook and other address books open. It holds the name, a person's date of birth, and the ways of reaching them that the person allows the firm to use, and leaves off identifiers, matters and anything recorded as former.
