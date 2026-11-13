---
category: Added
audience: public
---

**A member can edit or remove their own Magnus message.** An edit
(`PATCH /api/v1/magnus/conversations/{conversationId}/turns/{turnId}`) sets aside the message and every
turn after it and asks again, passing the same checks as a new question; a removal (`DELETE` on the
same path) hides the message and its answer behind a marker. Neither erases: three nullable columns on
`magnus_turn` (`removed_at`, `superseded_at`, `replaces_turn_id`) record what happened, the model no
longer reads either kind of turn, and the words are erased only when the whole conversation is
deleted. Both are refused (409 `magnus-turn-unchangeable`) while an answer is being written.

## Public

You can now edit a question you asked Magnus and ask again, or remove a question and its answer from
the conversation. Removed messages stay on your firm's record until the whole conversation is
deleted.
