---
category: Added
audience: public
---

**In/Out Log.** A front desk log for things dropped off for somebody and picked up later, separate from Custodian. A new `@magna-carta/in-out-log` package, five per-firm tables (`in_out_entry`, its recipients, its ID picture, and its number counter and allocation), seven routes under `/api/v1/in-out-entries` behind the new `inOutLog:read` and `inOutLog:manage` permissions, and the `/in-out-log` screen. Entries are numbered `IO-0001` onward from a new In/Out Log run on the numbering register. Move to Custodian opens Custodian's New Packet window prefilled from the entry and links the entry to the packet. Pick Up chooses the collector from the people it is To or Other (a member, a Directory person or a typed name), and can save a picture of the ID they showed (`in_out_identity_scan`, served on an audited `GET /api/v1/in-out-entries/{entryId}/identity-scan`).

## Public

**In/Out Log.** Record copies, papers and files left at the front desk for someone to pick up, see what is still waiting, record who picked it up and save a picture of their ID, and move anything that needs safekeeping into Custodian.
