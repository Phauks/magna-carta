---
category: Changed
audience: public
---

**The meeting room's chat, Q&A, polls and roster are one side panel with four tabs, and the control bar is three groups.** `meeting-side-panel.svelte` holds the screen's snippets as tabs; the chat, polls and questions panels take `inline` to draw without their popover or dialog, and the room page derives each one's "open" (which drives the unseen counts) from the panel's tab. The band reads left to right as what this member sends, what they do in the room, and where they look and leave; the host's room acts sit behind a "..." (Host controls) menu. The guest page keeps its popover chat for now.

## Public

**Chat, Q&A, polls and the list of people are now one panel on the right of the meeting, with a tab for each.** It opens on Chat, a second press on the same control closes it, and someone's raised hand shows beside their name under People. The controls along the bottom are grouped: your microphone, camera and effects on the left; presenting, raising a hand, reactions and recording in the middle (with the host's options behind a "..." menu); and the panel's tabs and Leave on the right.
