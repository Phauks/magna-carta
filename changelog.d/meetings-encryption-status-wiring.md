---
category: Changed
audience: internal
---

**Meetings encryption state a screen can read.** The meeting client now works out whether a meeting is end-to-end encrypted, paused (and why), connecting or failed, the security code in its digit groups and the group's members, all from the verified key group rather than the server. A host can propose a pause into the group, and Start sends the host's encrypted choice, on by default. Nothing is on screen yet, and encryption stays behind the deployment switch, which is off.
