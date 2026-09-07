# The Magnus interface — the assistant's two surfaces — design

**Date:** 2026-09-07
**Status:** Design proposed; build in progress on the same branch.
**Scope:** The member-facing interface for the assistant whose backend already ships — where a member
reaches it from, what each place is, how a conversation reads, and the disclosure a member accepts
before their first turn. **Excludes:** the firm-administrator enablement screen (the settings stream's,
against the two consent settings that already exist), token streaming, context grants, and anything the
assistant might do rather than say.
**Backend design:** [`2026-08-06-magnus-design.md`](2026-08-06-magnus-design.md) — the record, the two
consent gates, the path to an answer, and the transport. Nothing here re-decides any of it.
**Archetypes:** [`2026-06-12-page-archetypes.md`](2026-06-12-page-archetypes.md) — the sidebar
destination composes List / Index in its list-and-detail-split mode; the matter section is Record
Detail content.
**Standing rulings:** [`../conventions/design-corrections.md`](../conventions/design-corrections.md).

---

## 1. What is already decided, and what is left

Two places are reserved and both are stubs. The sidebar destination registry carries a `magnus` entry
at `/magnus`, announced and unshipped, described by the owner as "one sidebar entry, easy to find at
all times". The matter section registry carries a `magnus` slug at stage `soon`, placed last on the
strip and first in the fold order, on the owner's ruling that "the assistant is not one of the
matter's records — it is the way to ask about them".

So the question this design answers is not whether there are two places. It is **what makes them two
places rather than the same page rendered twice**, and the answer has to be a real difference or one
of them should not exist.

## 2. The difference, stated first

**The sidebar destination is a place. The matter section is a section of a record.**

That is the whole distinction, and everything below follows from it.

| | `/magnus` — the sidebar destination | `/matters/{id}/magnus` — the matter section |
| --- | --- | --- |
| What it is | The member's own workspace for the assistant | One matter's file of transcripts |
| Whose it is | The member's. Their conversations, across everything | The matter's. Kept on its record, subject to its retention |
| A new conversation | Starts on no matter, and can be attached to one | Starts on **this** matter; the link is not a choice the screen offers |
| What it lists | Every conversation this member has, newest first, each citing the matter it belongs to when it has one | Only the conversations linked to this matter |
| Its own chrome | A screen header, a conversation rail, a transcript | None. The matter's header and section strip are already the chrome |
| Where it goes back to | Nowhere — it is a top-level destination | The matter, through the strip it sits on |
| The question it answers | "What did I ask, and what do I want to ask now" | "What has been asked about this file" |

**Both compose one conversation surface.** The precedent is Tasks and it is exact: a task's list is one
component read through two routes, so a task looks and behaves the same in the member's own work list
and in the matter's Tasks section, and neither route knows the other exists. A conversation is the same
shape of fact. Building two transcripts would be building two places for a correction to have to be
made twice.

### 2.1 What the difference is NOT

**It is not a difference in what the assistant can see.** The matter link scopes the record, not the
prompt — the backend design is explicit that linking a conversation to a matter puts none of that
matter's content into anything the assistant is sent, and nothing in this interface may suggest
otherwise. A member standing in a matter's Magnus section and asking "what is the deadline on this"
will get an answer built from what they typed and nothing else. The section states this in one line,
once, above the composer, because the surrounding context is the whole reason a reader would assume the
opposite. This line is the interface's single most load-bearing sentence and it is not decoration:
it goes away when context grants ship, and not before.

**It is not a difference in capability.** The same composer, the same caps, the same disclosure, the
same failure labels, the same daily allowance. A member who can converse can converse in both places.

**It is not two records.** A conversation started in a matter appears in the member's own workspace
list too, citing its matter. One record, read from two directions.

## 3. The sidebar destination

Composes List / Index in its **list-and-detail-split** mode, which is the archetype's own answer for
master-detail triage.

- **The rail** is the member's conversations, newest first, each row its title or — for a conversation
  the member never named — its start instant, with the matter it belongs to as a citation beneath.
  Nothing generates a title; the backend is explicit that the title is member-supplied only, so an
  unnamed conversation displays by its start instant rather than by a machine's guess at what it was
  about.
- **The detail** is the transcript and the composer.
- **New conversation** is the screen's primary action, in the header, and it starts on no matter.
- **The full state set** the archetype requires: no conversations yet (the member has never asked
  anything), the read failed, the read is in flight, and the dense case.

## 4. The matter section

Record Detail content, inside the matter's own shell. It draws no header of its own and no way back —
the matter's masthead and section strip are both already on screen, and a second header inside a
section is the correction the shared screen header exists to prevent.

- The transcript for this matter's conversation, with the rail reduced to a **switcher** rather than a
  standing column: a matter usually has few conversations, and spending a third of a section's width
  on a list of two is the kind of furniture the owner has ruled against repeatedly.
- The one line about what the assistant can see, above the composer.
- **The matter's `+New` control keeps declining with a line.** The registry's `createWaitingOn` says
  "Magnus is a way to ask about the matter, not a record it keeps", and that stays true now the section
  is built: the matter's New control makes the matter's records, and a conversation is not one. Starting
  a conversation is a gesture inside the surface, where the composer is.

## 5. What both surfaces have to hold

These are the states the backend can actually produce, and a surface that renders only the happy path
is not done.

**Before a member can type at all**, the availability read answers one of four things, and each gets
its own honest screen rather than a disabled box with no explanation:

- **open** — the composer, and the remaining daily allowance when it is worth saying.
- **firm-ineligible** — the firm has not consented to third-party model processing. This is a firm
  decision, not the member's, so the screen names who can change it rather than offering a control the
  reader cannot use.
- **feature-disabled** — the firm has not turned the assistant on. Same shape.
- **acknowledgement-required** — the member has not accepted the current disclosure, or the version
  moved. The disclosure is shown and accepted here, and only here.

**The member disclosure** states, in plain language: what a member types is sent to a third-party model
provider through the platform's gateway; the assistant can see only what the member types in that
conversation — no matter files, no calendar, no directory, no documents; it can do nothing but answer;
transcripts are kept as firm records, readable inside the firm and never by clients; and the sentence
that belongs where the person typing will read it — **the assistant can be wrong, its output is not
legal advice, and the member is responsible for verifying anything they rely on.**

**A turn in flight** is the pending answer the backend already records. The surface **polls the turn**,
which the backend documents as returning byte-identical state to what the events socket pushes. The
socket is the better transport and it is not what this interface starts on: it lands with token
streaming, where a frame carries something a poll cannot — a partial answer — and until then it would
be a second transport for the same screen. Because the two return the same state, moving to it changes
the transport and not the surface.

**A settled failure** carries one of the closed labels and each one is said in words a member can act
on: the model was unavailable, the firm's gates closed while the question was queued, the firm's daily
allowance is spent, the message was too large, or it was cancelled. None of them is "something went
wrong".

**A truncated context** is stated on the answer that was built from a partial conversation, because the
member is the only one who can tell whether the dropped part mattered.

## 6. The design-system addition

A conversation surface does not exist in the design system, and the feature ledger has named it as this
interface's gate for as long as the interface has been unbuilt. It lands as `Conversation`: a
transcript, a turn with its speaker, its body, its meta line and its pending and failed states, and a
composer.

It reads as a **record, not a chat window.** No bubbles, no avatars, no coloured alignment: a turn is a
speaker label over a body, hairline-separated, in the same register the rest of the platform reads its
records in. The member's turn and the assistant's are told apart by the label and by weight, not by
being pushed to opposite sides of the canvas. Identity stays at the edges, as it does everywhere else —
the transcript is a work surface.

## 7. One backend change

The list endpoint filters by the caller and by nothing else, so the matter section cannot ask for its
own conversations. It gains an optional matter filter — the column is already there, indexed and
populated. Nothing else about the surface required a backend change, which is the design working.
