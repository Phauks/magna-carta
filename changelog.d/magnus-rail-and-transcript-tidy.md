---
category: Changed
audience: public
---

**Magnus layout and message removal.** NavigationLayout gains a `wide` width (`size.record-aside` with the narrow gutter), used by the Magnus rail; the transcript and composer widen to `max-w-5xl`. A change of order or a search re-reads the list without resetting it, so the surface no longer drops into its loading state. Find in Conversation moves into the head row. Turn actions show on hover, focus-within and coarse pointers. `removeTurn` stamps only the member's message; `buildConversationWindow` leaves out an answer whose question was removed.

## Public

**The Magnus page uses its space better.** The conversation list is wider and the conversation itself spreads across more of the page. Changing the list's order or searching it no longer blanks the page while the new list loads. Find in Conversation opens in the conversation's top row instead of pushing the messages down. Copy, Edit and Remove show when the pointer is over a message or focus is inside it, and always on a touch screen. Removing your message now keeps Magnus's answer readable, though Magnus no longer reads either one.
