---
category: Changed
audience: public
---

**The Record Communication window is built around the phone number, and holds several calls at once.** `communication-fields.svelte` now leads with Call / Text and Incoming / Outgoing as a pressed button group (`$lib/components/button-choice.svelte`), then `PhoneNumberField`, then the notes, then a one-line When that opens on Change; the Contact field leaves the form while a record is being made. The window (`communication-record-window.svelte`) holds a list of `CallEntry` drafts down the left of the pane, each the draft on screen rather than a copy; saving one retires it and the window closes on the last, and `recordThenIntake` no longer closes the window, so the messaging page stopped closing it too. While creating, the context tabs are Identification (`communication-identification.svelte`: the contact, their open matters read through `readDirectoryEntityMatterParties` with a search past five, and File Here) and History (`communication-number-history.svelte`: the log's own search, narrowed to rows on the same stored number). Start An Intake moved into the header menu; the subtitle is the previewed number alone, in italics. The contact choice moved to `communication-contact.ts` so the form and the panel share it.

## Public

**Recording a call starts with the phone number.** Press Call or Text and Incoming or Outgoing, type the number, and write your notes straight underneath while you are still on the line. When it happened is filled in as now; press Change if it was earlier.

**The window looks the number up for you.** The new Identification side shows who the number belongs to and their open matters, with a search when there are many, and File Here puts the call on the right one. The History side lists every earlier call and text with that number.

**A second call no longer means losing the first.** Press Another Call to write down a new one; every call you are recording is listed down the left of the window, and saving one leaves the rest. Start An Intake is now in the More menu at the top right, and it only saves the call you are on.
