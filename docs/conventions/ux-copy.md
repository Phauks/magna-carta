# UX copy: house style and glossary

How the words a person reads in the product are written: labels, hints, errors, empty states, hovers. The owner's earlier copy rulings live in [`design-corrections.md`](design-corrections.md) (title case, no em dashes, no self-explaining notes). This file adds to them and does not replace them. Language for developer and user documentation is a separate standard: [`documentation-style.md`](documentation-style.md).

`pnpm run lint:ux-copy` enforces the mechanical part (see _The lint_ below).

## Why this exists

A 2026-11-13 review of every user-facing string in `apps/web` and `packages/design-system` found copy that was easy to read word by word but long, indirect and over-explained. There were 274 runs of prose over 25 words, 172 em dashes, and one network failure line written by hand 163 times in about 40 wordings. Readability formulas rated the copy "easy", so a readability score will not catch this. The cause is sentence shape and explaining too much. Rulings ledgers and code comments are written in a discursive voice, and screens built after reading them copied that voice. Write copy in the voice below, not the voice of the comment beside it.

## Rules

1. **Say the result first, in the fewest words that keep it true.** Labels are 1 to 4 words. Hints and errors are 15 words or fewer. An empty state is one short sentence.
2. **An error says what happened, then what to do.** "Couldn't connect. Nothing was saved. Try again." Use one shared wording per kind of failure, not a new one per call site.
3. **An empty state names the absence.** "No calls or texts yet." Don't explain what the section is for.
4. **Things don't talk.** A row doesn't "say", a record doesn't "hold", a list doesn't "keep" or "owe". Use "has", "shows" or "needs", or name the person who acts.
5. **No "is where / is who / is what" sentences.** Write "Enter an email address", not "An email address is where the invitation goes".
6. **Speak to the reader as "you"**, not "the reader", "somebody", "whoever" or "a person who".
7. **Leave the machinery out.** No "platform", "server", "engine", "worker", "token", "queue", "corpus", "surfaced" or "posture" in what a lawyer reads. If the product has to be named, say "Magna Carta".
8. **One sentence, one idea.** No semicolons. Use a colon only before a list or a value. Swapping an em dash for a colon doesn't fix the sentence: split it.
9. **Use contractions in messages and hints** ("couldn't", "isn't", "don't"). Labels and legal statements stay formal. (Owner ruling, 2026-11-13.)
10. **No "Every X" openers, no "its own", no "rather than" asides.** Each one usually adds a contrast nobody asked about.
11. **Title Case for controls and headers, with short words lower case:** a, an, the, and, or, of, to, in, on, for, at, by, from, with, as. "Start an Intake", "Apply from Trust".
12. **One word per idea, from the glossary.** A new screen uses the glossary word even when a synonym reads better in that one sentence.

A Soon control's hover reads `Not built yet: <what is missing>.` in the reader's words ("recording payments"), never the internal dependency behind it. The badge stays the short "Soon". The rule lives in [`ui-design.md`](ui-design.md), and the sentence is built in one place, `packages/design-system/src/lib/components/maturity/soon-affordance.ts`.

## Glossary

| Use                                   | Meaning                                                  | Don't use                                                      |
| ------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------- |
| Delete                                | Gone from Magna Carta                                    | erase, discard, destroy                                        |
| Remove                                | Taken off a list or unlinked. The thing still exists.    | delete (for unlinking), drop, take off                         |
| Clear                                 | Empty a field, filter or selection                       | reset (for fields)                                             |
| Edit                                  | The control that opens a change                          | modify, update, amend (except "Amend Agreement", a legal term) |
| Bill                                  | A bill to a client (owner ruling, 2026-11-13)            | invoice (identifiers and wire names keep `invoice`)            |
| Upload                                | Send a file from your computer                           | import (for single files), add a file                          |
| Attach                                | Link a file already in Magna Carta to a record           | upload (for linking)                                           |
| Staff                                 | People who work at the firm (owner ruling, 2026-11-13)   | colleague, employee, user, firm member                         |
| Member                                | A staff account, in Settings > Members                   | user                                                           |
| Matter                                | The legal file                                           | case, engagement (except as a fee term)                        |
| Review set                            | A set of documents under discovery review                | corpus                                                         |
| Type                                  | The category a thing belongs to                          | kind, category, class                                          |
| Waiting / In progress / Done / Failed | The four states of background work                       | queued, pending, running, processing, working                  |
| Couldn't connect                      | The network or a service did not respond                 | nothing answered, did not answer, could not be reached         |
| Checksum                              | A file's fingerprint                                     | digest, hash                                                   |
| New / Add                             | "New" opens a blank record. "Add" puts something on one. | create                                                         |
| Filed                                 | Filed with a court, and nothing else (existing ruling)   | filed (for saving to a matter)                                 |

"Record" as a button verb ("Record Statement", "Record Communication") stays where the owner named it. Elsewhere, use "New" or "Add".

## The lint

`pnpm run lint:ux-copy` (`tooling/lint-ux-copy/`) scans the shipped source of `apps/web/src` and `packages/design-system/src` and skips tests, stories and the developer console. It flags patterns that break the rules above and that a line scan can spot reliably:

- an em dash inside a string or markup text (rule 8 and the standing ban)
- "Nothing answered" and its relatives (rule 2 and the glossary)
- "is where", "is who" and "is what" sentences (rule 5)
- "the platform" and "corpus" in copy (rule 7)
- the old Soon wording, "Waiting on" or "is not served yet" (the Soon rule)

The copy already in the product starts as a per-file baseline in `tooling/lint-ux-copy/baseline.json`, and the baseline only shrinks. A count that rises fails the lint. A count that falls is reported but doesn't fail, so fixing copy never turns a build red. Run `pnpm run lint:ux-copy --update` to write the lower number down, so the fix can't be quietly undone. New files start at zero.

The lint can't judge length, tone or whether a word is the right one. Those are a reviewer's job, done against this file.
