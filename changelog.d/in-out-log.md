---
category: Added
audience: public
---

**In/Out Log.** A front desk log for things dropped off for somebody and picked up later, separate from Custodian. A new `@magna-carta/in-out-log` package, four per-firm tables (`in_out_entry`, its recipients, and its number counter and allocation), six routes under `/api/v1/in-out-entries` behind the new `inOutLog:read` and `inOutLog:manage` permissions, and the `/in-out-log` screen. Entries are numbered `IO-0001` onward from a new In/Out Log run on the numbering register. Move to Custodian opens Custodian's New Packet window prefilled from the entry and links the entry to the packet.

## Public

**In/Out Log.** Record copies, papers and files left at the front desk for someone to pick up, see what is still waiting, record who picked it up, and move anything that needs safekeeping into Custodian.
