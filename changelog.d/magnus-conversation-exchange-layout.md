---
category: Changed
audience: public
---

**The Magnus transcript is laid out as an exchange.** The design-system Conversation component gains
a second arrangement (`arrangement="exchange"` on `Conversation.Transcript`, with new `TurnMark`,
`TurnContent` and `TurnActions` parts); the default `record` arrangement and the meetings chat are
unchanged. `magnus-transcript.svelte` uses it: member turns on the right under the conversation
creator's real name and initials (the session read for the signed-in member, the firm roster for
anyone else), Magnus on the left behind the blackletter M, a time on every turn and a Copy control.
The conversation head names the matter it is kept on beneath the title, with its number, read
through `matter-citations.svelte.ts`. First piece of the owner's round two in
`docs/conventions/magnus-rulings.md`.

## Public

Magnus conversations are easier to follow. Questions sit on the right under the asker's name and
initials, Magnus answers on the left beside its gold M, every message shows when it was sent and has
a copy button, and the matter a conversation is kept on is named in small print under its title.
