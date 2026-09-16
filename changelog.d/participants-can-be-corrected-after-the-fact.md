---
category: Fixed
audience: internal
---

**Who is at a setting can be changed after it is recorded.** The owner: "in the modal it doesn't allow me to set new participants."

The entry window's Edit deliberately never re-sent participants — "a window that did not touch who is at a setting cannot change it" — which was a safety property while the window had no participant control, and became the reason there was no way to add somebody to a setting already recorded. The contract never had this limit: supplying participants replaces the list, omitting them leaves it alone.

The Participants tab now renders the same `ParticipantPicker` the record forms use while the window is editing, over the draft's own list, and the change rides the window's own Save rather than landing as you type — the pane says so above the field.

The invariant survives in the half that mattered. The window SAYS whether the pane was touched rather than the projection comparing lists: a draft's participants carry local keys and display names the server never sent, so any comparison would report a change on every open. A correction that never opens the tab still sends no participants at all. An edited list is sent whole, **empty included** — taking the last person off a setting is a real correction, and dropping an empty list would make it the one edit that silently does nothing.

Adding people by role, by matter, or by a firm-defined tag — the rest of the owner's ask — needs storage and a settings surface, and is specified in `docs/specs/2026-09-15-calendar-places-people-and-recurrence-design.md`.
