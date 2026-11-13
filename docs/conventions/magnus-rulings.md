# Magnus — the owner's standing rulings

Every ruling the owner has issued on Magnus, cumulative, newest round last. **A ruling here is
settled.** It is not re-derived, re-proposed, or re-litigated by a later round, and a round that
silently reverts one is a regression, not a redesign.

The surface is the member's workspace at `apps/web/src/routes/(app)/magnus/` and the matter's own
Magnus section, which are one component (`apps/web/src/lib/magnus/magnus-surface.svelte`) over
`packages/magnus/` and `packages/inference/`.

Status values: `settled` (built and confirmed) · `regressed` (was settled, a later round undid it) ·
`open` (asked for, not yet built) · `superseded` (a later ruling replaced it, with the pointer).

## R1 — round one: the rail learns to sort, and the model becomes a choice

The owner's notes of 2026-09-11, staged, and built the same day. Every row below was built in one
pass; the research beneath each group is what the code said before it, kept because it is the
reasoning the build followed, and the notes block at the end records what was decided along the way.

### The rail

| #   | Ruling                                                                                                                                                                      | Status  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| R1  | **The rail sorts, and by more than one thing.** By name, by the matter the conversation is kept on, and by date — date being the default.                                   | settled |
| R2  | **The sort control is there in the empty state too.** A rail with nothing in it still shows how it would be ordered; the control is not conjured by the first conversation. | settled |
| R3  | **Renaming a conversation happens in line.** The name is edited where it is read, not by swapping the conversation's head row for a labelled field and two buttons.         | settled |

**What the code says today.** The rail is a `PagedList` read newest-first with no ordering choice at
all — the listing's order is the server's and the surface never asks for another. Sorting by name
and by matter both reach past the loaded page to be true, which is the same paging problem the
messaging correction names: an order applied to what happens to be loaded is not the order. The
matter each conversation is kept on is already carried (`matterId` on the row, resolved to a
citation through `matter-citations.svelte.ts`), so grouping by it needs no new read, only a listing
that can be asked for it.

Renaming today replaces the conversation's head row with a `Label`, an `Input`, "Save Name" and
"Cancel" — a mode the whole header enters. R3 puts the edit on the name itself.

### The conversation

| #   | Ruling                                                                                                                                                    | Status  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| C1  | **A conversation can be pointed at a matter.** Not only at the moment it is started — a conversation that turns out to belong to a matter is filed on it. | settled |
| C2  | **Files can be uploaded into a conversation.**                                                                                                            | settled |

**What the code says today.** A conversation carries `matterId` and it is set when the conversation
is STARTED (`start: { title, matterId }`); the listing filters by it, and the matter's own section
is that filter. Nothing re-files an existing conversation, so C1 is a write that does not exist yet
— and it has a real consequence to decide, because the matter a transcript is kept on is what
decides who can read it. Moving a conversation onto a matter widens or narrows its audience, which
makes C1 an access decision as much as a filing one.

C2 has no seam at all today: a turn is text, and `packages/magnus/src/limits.ts` refuses an
oversized request rather than shipping it. Files in a conversation means deciding what reaches the
model — the bytes, an extraction, or a citation — which is the question the conversation's own
disclosure (`magnus-disclosure.svelte`) exists to answer honestly.

### The model

| #   | Ruling                                                                                                                                              | Status  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| M1  | **The model is selectable.** Which model answers is a choice the firm makes and can see, rather than a value fixed behind the surface.              | settled |
| M2  | **The model list keeps itself current**, rather than being a list somebody has to remember to edit. Cloudflare's AI Gateway is the candidate route. | settled |

**What the code says today, and the tension to settle.**

- **It is a firm setting already, with no control over it.** `packages/magnus/src/settings.ts` is
  explicit that "Magnus declares NO model setting: it reads the firm's shipped
  `inference.primaryReasoningModel`", and that setting is real, defaulting to whichever catalog
  model fills the platform's reasoning tier. A firm that has chosen keeps its choice and nothing
  rewrites it. What is missing is the control: Settings · AI REPORTS the model through a read-only
  `modelFact` row, in the Versions page's definition-list voice, and offers no way to change it. So
  M1 is a control over a setting that exists, not a new axis.
- **"Not hardcoded" has two candidate meanings and they lead different places.** The stored firm
  value is not hardcoded; the CATALOG of models is — `packages/inference/src/catalog.ts`, a curated
  list of provider-prefixed, gateway-routable ids. M1 wants the first made settable; M2 is about the
  second.
- **The gateway is already wired, and it does not answer the question M2 asks.**
  `packages/inference/src/gateway.ts` pins one Cloudflare AI Gateway per environment on every
  request through the AI binding's documented options. What the catalog carries beyond an id is the
  part a roster does not supply: each entry records retention and Zero-Data-Retention facts
  "re-checked against the Anthropic reference per release", with `verifiedOn` dates, a freshness
  pass (`model-pin-freshness.ts`) and a fitness gate against pin rot. The file states the stance
  plainly — "which model the platform runs is a decision, and the freshness pass exists to put that
  decision in front of someone rather than to make it for them" — and on a platform where the
  content is privileged, ZDR is the fact that cannot be inherited from a list. So M2's work is
  likely a gateway-fed roster that still cannot be selected from until its retention posture has
  been verified, rather than a catalog the gateway replaces.

### The screen

| #   | Ruling                                                                                                                                        | Status  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| G1  | **Magnus wants a much better interface, taken as a whole.** The rows above are the specific asks; the screen itself is what the round is for. | settled |

**What the code said before the round.** `magnus-surface.svelte` was 858 lines carrying both
presentations — the workspace's standing rail and the matter section's switcher — behind one `rail`
prop. That was the right place for the round to land, and it is also why the round was worth taking
whole: one screen improves two.

### Notes recorded this round (2026-09-11)

- **R1, the order is the server's, and each order is one SQL key.** `GET /api/v1/magnus/conversations`
  takes `sort=date|name|matter`. The name order puts named conversations by their lower-cased title
  and the unnamed ones after them by the instant they started (an unnamed conversation READS as that
  instant, so that is its name); the matter order groups by the matter's title, with conversations
  on no matter last. Within a group the order is newest first, which needed a mixed-direction keyset
  the shared composite predicate does not express, so `packages/magnus/src/statements.ts` spells its
  own. The cursor is the shared composite encoding, so the wire contract does not fork.
- **R2, the control stands in the empty state, and in the matter section too.** Inside a matter the
  matter order is not offered (every row would be in one group); date and name are. The matter
  section's switcher moved from a Select to the product's combobox (`choice-picker.svelte`), under
  the standing ruling that every closed choice is a combobox.
- **R3, the name is edited in the head row, not the rail row.** A rail row is one hit target (a
  button), and a field inside a button is not a thing; the head row is where the open conversation's
  name is read, and the field takes the name's own place at the same height. Blur commits, because a
  name somebody typed and clicked away from is a name they meant; an unchanged commit writes nothing.
- **C1 says "keep on a matter", never "file".** The standing ruling reserves "filed" for a court. The
  act is `PATCH .../matter` with `matterId | null`, allowed to anyone who can READ the conversation
  (author, or the supervision permission) onto a matter the firm still writes to; the dialog states
  that where a conversation is kept decides who may read it. Recorded as a decision of record in
  `docs/decisions/pending/keeping-a-conversation-on-a-matter-is-an-access-decision.md`.
- **C2 attaches by reference and re-reads on every question.** The platform has text extraction
  (`apps/api-worker/src/search/text-extraction.ts`), so an attachment's text IS sent — ahead of the
  question, under a heading naming the file, within `ATTACHMENT_TEXT_MAX_BYTES` (64 KiB) inside the
  window's own cap, cut and said when it does not fit. Nothing is copied: a stored extraction would be
  a second copy of privileged content outside the file's erasure path, so the cost paid is one
  extraction per question that carries files, bounded by a cap of ten files and a 25 MiB source
  limit. The row records `sent | cut | unreadable | pending` so the composer says per file what the
  model saw. Because what Magnus can see changed, the disclosure moved to version 2 and every member
  is re-prompted; the disclosure statement and the system prompt say the same thing. A cached
  extraction is a named seam for when its retention posture is decided.
- **M1 keeps the two postures legible.** "The platform's current model" deletes the firm's row (so
  the firm follows the tier and moves with it); a roster entry writes it (pinned until chosen again).
  The facts beneath the control describe the STAGED choice, so the page reads back what saving will
  do. The composer names the answering model, read from the same setting the consumer reads.
- **M2: nothing at runtime lists models, so the roster is the catalog and the page says so.** Read
  against the current Cloudflare documentation: the Workers AI binding exposes `run`, `gateway()`,
  `getLog`, `patchLog`, `getUrl` and no enumeration; the AI Gateway REST API exposes run,
  chat-completions, responses and messages and no roster. The page states each entry's verification
  dates and the catalog's version and effective date, and that the verification pass keeps it
  current. Recorded in `docs/decisions/pending/the-model-roster-is-the-catalog-and-the-firm-follows-or-pins.md`.
- **G1, what changed in the screen.** `magnus-surface.svelte` now composes `magnus-rail.svelte` (the
  order control, the rows, the empty line, load-more), `magnus-transcript.svelte` (the turns with
  their loading, empty and failed states), `magnus-composer.svelte` (the field, the composed
  disclosure line naming the model, the attachment rows with per-file outcomes, the Attach control
  refused with its reason when nothing can be attached), `conversation-name.svelte` (R3), and two
  dialogs (`move-conversation-dialog.svelte`, `attach-file-dialog.svelte`). The surface keeps the
  shared state and the acts; the workspace's two sides are the design system's `NavigationLayout`
  (`navigationLabel="Conversations"`, `navigationWidth="narrow"`, `contentScrolls={false}` because
  the transcript owns its scroller with the composer pinned beneath it), with the screen's header
  riding inside the content column since the layout takes the whole canvas. States shipped:
  loading (fixtures for rail and transcript), empty (the record's own words, with the order control
  present), failed (notices with Retry for the availability read, the listing, the conversation read,
  a rename, a move, an attach, a detach), dense (paged rail, paged transcript). The head-row acts wear
  the design system's Tooltip rather than native titles. Unverified in a browser this round: the
  owner should look at the workspace rail and the composer's attachment rows first.

## R2 — round two: a page several people work in, and answers that cite

The owner's notes of 2026-11-09, given over a sequence of reviewed boards ("Round 2: A with the
refined pane" was the one approved, with "good enough to start, get this built and then figure out
how to make it look better"). Numbered `R2.n` so they never collide with round one's rows. Rows
marked `settled` are built in the first pull request of the round; every `open` row is approved and
not yet built. The board's citation block quotes are approved in principle and the owner has said
they still need to look better, so their styling is expected to change.

### The conversation

| #    | Ruling                                                                                                                                                                                                                                            | Status  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| R2.1 | **Members on the right, Magnus on the left.** Several members can work in one conversation, so who asked what is attributed on every turn; Magnus answers on the left. Supersedes "no alignment carrying meaning" for this surface only.          | settled |
| R2.2 | **Real names, never "You".** A member's turn carries their name and initials; the reader's own turns are named the same way.                                                                                                                      | settled |
| R2.3 | **Magnus wears the product's M.** The blackletter letter of the brand mark, gold on the chrome ink, is its mark in the conversation.                                                                                                              | settled |
| R2.4 | **Copy on every message**, members' and Magnus's alike.                                                                                                                                                                                           | settled |
| R2.5 | **Edit and delete one's own message.** Editing re-asks from that point; deleting leaves a marker that something was removed. Built as hide-but-keep: neither act erases, because a transcript is erased only whole (`packages/magnus/CLAUDE.md`). | settled |
| R2.6 | **Search within a conversation and within an artifact.**                                                                                                                                                                                          | open    |

### Citations

| #    | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Status |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| R2.7 | **Every claim cites its source**, in the conversation directly under the claim, never in the side pane and never as a chip alone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | open   |
| R2.8 | **Citations are source cards, styled by source type** (the owner chose "The Source Card", option D of four, on 2026-11-09): a coloured tab naming the type and the source number, the source name and location with Open and Copy, the quote in the display serif, a footer strip with the check and when it was read. Built as the design system's `SourceQuote`; Magnus answers do not use it yet, because they are plain text with no source structure. Hues: a statute (gilt rule, section title), a case (blue rule, italic case name, citator result), a matter file (grey rule, page or clause, "Verified Quote" when the quote matches the file). | open   |
| R2.9 | **An exact quote is preferred over any restatement.** Magnus's own words are a short lead-in or a paragraph labelled "Analysis"; each answer ends with a numbered list of its sources.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | open   |

### The page

| #     | Ruling                                                                                                                                                                                                                                                | Status  |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| R2.10 | **The matter sits beneath the title, small.**                                                                                                                                                                                                         | settled |
| R2.11 | **One "..." menu for the conversation's acts**: the shared Copy Link and Open in New Tab, then Share, Pin, Rename, Move to a Folder, Save to a Different Matter (which warns), Download Transcript (optionally with its artifacts as a .zip), Delete. | open    |
| R2.12 | **The rail**: a split New control, search, sort by date, name or matter number, folders, sections that fold (a closed caret points right), and a Pinned section that duplicates its items rather than moving them out of their folders.               | open    |
| R2.13 | **A new conversation is saved to "General"** unless the member chooses a folder or matter.                                                                                                                                                            | open    |
| R2.14 | **The composer** offers templates, the model and effort level from the catalog (current generation only, every effort level the model supports), and the context and allowance in a popup.                                                            | open    |

### The right-hand pane

| #     | Ruling                                                                                                                                                                                                                                                                                                                                                | Status |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| R2.15 | **Context**: shared files and artifacts as one kind of card with View and Download and their metadata.                                                                                                                                                                                                                                                | open   |
| R2.16 | **Permissions, grouped**: This Matter (with its number; documents down to folders and files, notes, time and fees, trust, tasks, details, and other conversations in this matter), Firm Records (calendar, parties, directory), This Client (each matter), Research Services (Westlaw, Lexis, PACER), Firm Library. Each is Allow, Ask, Off or Mixed. | open   |
| R2.17 | **Artifacts** keep versions, download, and open in the firm's document editor once saved to Matter Files.                                                                                                                                                                                                                                             | open   |

### Finding and attaching matter content

| #     | Ruling                                                                                                                                                                                                                                                                                                                                                   | Status |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| R2.18 | **Attach from a matter or from this computer.** From a matter: a folder tree with ticked files and whole folders that stay up to date as files are added, with sizes. From the computer: a malware check, then kept with the conversation or filed in the matter's Uploads folder. Built from the design system's ActionDialog, FolderTree and Checkbox. | open   |
| R2.19 | **A large matter is searched, never stuffed.** Magnus searches the matter's index (keyword and passage search, re-authorised per hit) and shows what it searched.                                                                                                                                                                                        | open   |
| R2.20 | **Per-matter reading priorities and skip rules** (document-type order; skip images, duplicates and superseded versions).                                                                                                                                                                                                                                 | open   |
| R2.21 | **Westlaw and Lexis are a firm integration plus a per-conversation permission**, not a plugin a member installs.                                                                                                                                                                                                                                         | open   |

### Notes recorded this round (2026-11-09)

- **R2.11 is still open, with the conversation's menu built with its live acts.** Copy Link, Open in New
  Tab, Rename, Save to a Different Matter (the existing move dialog, which warns that the matter
  decides who can read it), Download Transcript (the whole conversation as Markdown, read across
  every page) and Delete (`apps/web/src/lib/magnus/conversation-menu.svelte`). It is a menu on the
  conversation's head row, not items in the screen header's page menu, because the page's address is
  the whole workspace and only the head row knows which conversation is open; the address now names
  it as `?conversation=<id>`, so the link opens it directly. Pin and Move to a Folder are built with
  the shelf (R2.12, below). Share waits for its table, and Download Transcript gains the artifacts
  `.zip` when artifacts exist.

- **R2.12 is still open, with folders, pins and sections built.** The rail is Pinned, then the
  member's folders, then General, each a section that folds with the caret pointing right while
  closed (`apps/web/src/lib/magnus/magnus-rail.svelte`). Each section is its own read of the server's
  listing in the chosen order (`?folder=<id>`, `?folder=general`, `?pinned=true`), so no section is
  a page sorted on the client (R1); a folder is read when it is first opened. A folder and a pin are
  the READER's, not the conversation's: two tables keyed by the member (`magnus_folder`,
  `magnus_conversation_shelf`), so a supervisor reading a conversation keeps it in their own folder
  or none, and a folder decides nothing about who can read what. A folder's name is never audited,
  like a conversation's title. A search reads the whole record as one list. Still open in R2.12: the
  split New control, and sort by matter number (the matter order sorts by the matter's title).
- **R2.13 holds by construction, and is still open for choosing a folder at the start.** A
  conversation in no folder is in General, so a new one is in General without a row. Choosing a
  folder or matter in the New control comes with the split New control.
- **R2.14 is still open, with the model and effort picker built.** The composer's model control
  (`apps/web/src/lib/magnus/model-picker.svelte`) offers the roster the firm chooses from on its AI
  settings screen, the firm's own model marked and used by default, and every effort level the
  chosen model takes, read from the catalog through the availability read. A choice is checked on
  submission (refused by name when off the roster) and again when the answer runs (falling back to
  the firm's model), and the effort is recorded on the answer beside the model
  (`magnus_turn.effort`). Still open in R2.14: templates, and the context and allowance popup.

- **R2.1 changes the design-system component, not only the page.** The Conversation component was
  written as a record with no alignment carrying meaning, and the meetings chat still reads that way.
  So the change is a second arrangement (`arrangement="exchange"` on `Conversation.Transcript`, with
  `TurnMark`, `TurnContent` and `TurnActions` parts) rather than a new default; `record` stays the
  default.
- **R2.2 names the conversation's creator.** The record keeps one author per conversation
  (`createdBy`), not one per turn, so every member turn is named after the creator today. Several
  members asking in one conversation needs a per-turn author on `magnus_turn`, which comes with the
  sharing work (R2.11).
- **Still to settle before the open rows that change what Magnus reads** (R2.16 to R2.21): the member
  disclosure has to move to a new version, with a decision record, because Magnus reading the matter
  is a change in what it can see; retrieval waits on the
  ethical-wall filter experiment.
