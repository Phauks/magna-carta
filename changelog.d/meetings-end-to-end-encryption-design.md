---
category: Added
audience: internal
---

**End-to-end encrypted meetings are designed.** `docs/specs/2026-11-09-meetings-end-to-end-encryption-design.md` uses MLS for group keys, so an encrypted meeting keeps the room's 300 participants, and SFrame per frame. It keeps recording by recording in the host's browser, and keeps dial-in behind a warning banner. It compares the result with Zoom's and Google Meet's encrypted modes. Four experiments run before any code. The `meetings.end-to-end-encryption` ledger node moves to `designed`, on by default with the host able to switch it off at Start.
