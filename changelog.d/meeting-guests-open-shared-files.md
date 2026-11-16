---
category: Added
audience: public
---

**A guest can open a file shared in a meeting's chat while they are in the room.** `GET /api/v1/guest/meeting/files?fileId=` (guest lane, grant) answers a five-minute signed address and the file's name, only for a guest whose stay is open and admitted in a meeting that has not ended, for a file a line of that meeting points at that is not taken back, still live on the meeting's matter, with a clean current version (flagged versions are never handed to a guest). Every other case is 404. The download is audited as `file.downloaded_by_meeting_guest` with the meeting, invitation and stay. Guest reads and the room's relay to a guest now keep `attachedFile`. The guest page draws the file as a button that opens a tab at the press and sends it to the address.

## Public

**Guests can open files shared in a meeting's chat.** While a guest is in the meeting, they can open any file somebody shared in its chat. They cannot reach anything else on the matter.
