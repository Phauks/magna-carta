---
slug: what-magnus-reads-widens-one-disclosure-at-a-time
status: Proposed
area: Magnus
date: 2026-11-13
summary: "The three remaining steps of the Magnus page redesign each widen what Magnus reads or does: the right pane's Permissions, attaching many files, folders and uploads from a member's computer, and answers that cite their sources, with search across a large matter. Each step ships with its own bump of the disclosure, stating only what that step adds. Permissions are per conversation, and This Matter is the only one on by default. Magnus reads other conversations only when they are the reader's own. Search across a large matter starts with the keyword index, because the natural-language search stays behind its two open filter experiments. A cited answer is built only from passages Magnus was given, and every quote is checked word for word before it is shown."
---

**What Magnus can read grows one step at a time, and each step gets its own disclosure.**

**Context:** the owner approved the Magnus page redesign on 2026-11-09 (the board, and the rulings
in [`docs/conventions/magnus-rulings.md`](../../conventions/magnus-rulings.md)). Its first half is
built: folders and pins, the model picker, editing and removing a message, and finding within a
conversation. Its second half changes what Magnus can SEE and DO. `packages/magnus/src/disclosure.ts`
says the disclosure version is bumped whenever either changes, and each member accepts the new
statement before their next question. Version 2 covers what is live today: attached matter files
are sent with the question, and nothing else is read.

The three steps left are:

1. **The right pane.** Context (the files and artifacts in the conversation), Permissions (what
   Magnus may read: This Matter, Firm Records, This Client, Research Services, Firm Library) and
   Artifacts (documents Magnus writes, with versions).
2. **Attaching more.** Many files at once, whole folders that stay up to date, and files from the
   member's own computer.
3. **Cited answers.** Every claim carries a quote from its source on the owner's chosen Source Card,
   and on a matter too large to attach, Magnus searches the matter instead.

**Decision.**

1. **One disclosure version per step, bumped in the pull request that ships the step.** Each
   version states what that step adds and nothing that is not built yet. One bump covering all
   three would ask members to accept a statement that is untrue until the last step ships.
2. **Permissions are per conversation, and This Matter is the only one on by default.** It is
   what version 2 already allows (the matter's files, when attached). Firm Records, This Client,
   Research Services and Firm Library are off until a member turns them on for that conversation.
   Turning one on is audited by name. Research Services is not offered until a firm connects a
   legal-research provider, which is not built.
3. **"Other conversations on this matter" means the reader's own.** A transcript is read by its
   author and by a holder of the supervisory permission, and nobody else
   (`packages/magnus/CLAUDE.md`). Magnus reading a colleague's conversation would hand its words to
   someone who cannot open it.
4. **Uploads from a member's computer pass the malware check before Magnus reads them.** They go
   through the same ingest path as any uploaded file. The member chooses whether the file is kept
   with the conversation or filed in the matter's Uploads folder.
5. **Search across a large matter starts with the keyword index.** The natural-language feed is
   behind experiments E1 and E2
   ([`docs/research/2026-08-07-ai-search-filter-wall-experiment.md`](../../research/2026-08-07-ai-search-filter-wall-experiment.md)),
   which are still open and need a live Cloudflare account. If either fails, that feature does not
   ship in any form. The keyword index is live and already re-checks every hit against the reader's
   access, so Magnus searches it first and shows the member what it searched for.
6. **A cited answer is built only from passages Magnus was given, and every quote is checked word
   for word before it is shown.** A quote that is not found in its source is not shown as a quote:
   the claim is marked unverified. The Source Card's check line says "Verified Quote" only when this
   check passed.

**Consequences.** Members are asked to accept a new statement up to three times as the steps ship.
That is the cost of each statement being true on the day it is shown. Natural-language search across
a matter waits for the owner to run E1 and E2 on a live account. Until then, a question whose words
are not in the matter's files gets no answer from search, and Magnus says so instead of guessing.
