---
category: Added
audience: internal
---

**The assistant's interface is designed, and the list endpoint can finally be asked for one matter's
conversations.**

Two places were reserved for Magnus and both were stubs: an announced sidebar destination at
`/magnus`, and a `soon` section on the matter strip. The reservation said where, and never what makes
them two places rather than the same page rendered twice. That is now written down in
[`docs/specs/2026-09-07-magnus-interface-design.md`](docs/specs/2026-09-07-magnus-interface-design.md),
and the answer is short: **the sidebar destination is a place, the matter section is a section of a
record.** The first is the member's own workspace across everything, where a new conversation starts
on no matter; the second is one matter's file of transcripts, where a new conversation starts on that
matter and the screen offers no picker. Both compose one conversation surface, on the Tasks precedent
— one component, two routes, neither knowing the other exists.

The difference is deliberately **not** a difference in what the assistant can see. The matter link
scopes the record and not the prompt, so a conversation filed on a matter puts none of that matter's
content into anything the assistant is sent. Standing inside a matter is exactly the context that
makes a reader assume the opposite, so the section states it in one line above the composer, and that
line goes away when context grants ship and not before.

`GET /api/v1/magnus/conversations` takes an optional `matterId`. Without it the matter's own surface
could not ask for its own conversations — the column has been there, indexed and populated, since the
record was built, and nothing could filter on it. It narrows; it never becomes a default, and absent
still means every conversation the other conditions allow rather than the ones on no matter.
