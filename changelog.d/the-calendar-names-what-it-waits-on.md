---
category: Changed
audience: internal
---

**The matter calendar's Soon line names its real dependency.** It said recording waited on the
participant picker; the picker exists now, and what recording waits on is the event and deadline
forms, which the calendar stream builds. When it does, `participantKind: "entity"` is an
`EntityPicker` pick and an event opened in a record window shows its people on `RecordParties`; a
judge stays an `external` participant by default, as the calendar design rules.
