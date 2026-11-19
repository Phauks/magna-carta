# UX copy: house style and glossary

The words a person reads in Magna Carta: labels, buttons, tabs, hints, errors, empty states, hovers. The owner's earlier copy rulings live in [`design-corrections.md`](design-corrections.md) (title case, no em dashes, no self-explaining notes); this file adds to them. Documentation language: [`documentation-style.md`](documentation-style.md).

`pnpm run lint:ux-copy` checks the mechanical part (see _The lint_).

## Names come first

The owner's top rule for copy (2026-11-16): **call a thing what people already call it.**

- **Use the word familiar software uses.** Before naming a button, tab or heading, ask what QuickBooks, Outlook, Google Docs or Word calls it, and use that word.
- **One or two words.** Shorter is better.
- **Name the thing, not how it works.** A label is not a description. Put any explanation in a hint below, or leave it out.
- **No acronyms or abbreviations** unless the reader says them out loud every day (PDF, IOLTA). Spell everything else out.
- **Don't invent a name.** If you are combining words to describe a feature, there is almost always a plain word for it already.

| Write      | Not                                      |
| ---------- | ---------------------------------------- |
| Save       | Save Point, Save Changes Now             |
| History    | Every Change, Change Log, Activity Trail |
| Undo       | Revert Last Action                       |
| Notes      | Commentary, Remarks Thread               |
| Files      | Attached Documents, Supporting Material  |
| Difference | Unexplained Amount, Variance Remaining   |
| Restore    | Roll Back to Restore Point               |
| Search     | Find Records                             |
| Settings   | Preferences and Configuration            |
| Print      | Generate Printable Output                |

## Rules

1. **Result first, fewest words.** Labels are 1 or 2 words, 4 at most. Hints and errors are 15 words or fewer. An empty state is one short sentence.
2. **An error says what happened, then what to do.** "Couldn't connect. Nothing was saved. Try again." One shared wording per kind of failure.
3. **An empty state names the absence.** "No calls or texts yet." Don't explain what the section is for.
4. **Things don't talk.** A row doesn't "say", a record doesn't "hold". Use "has", "shows" or "needs", or name the person who acts.
5. **No "is where / is who / is what" sentences.** "Enter an email address", not "An email address is where the invitation goes".
6. **Say "you"**, not "the reader", "somebody" or "a person who".
7. **Leave the machinery out.** No "platform", "server", "engine", "worker", "token", "queue", "corpus", "surfaced" or "posture". If the product needs naming, say "Magna Carta".
8. **One sentence, one idea.** No semicolons. A colon only before a list or a value. Don't swap an em dash for a colon: split the sentence.
9. **Contractions in messages and hints** ("couldn't", "don't"). Labels and legal statements stay formal. (Owner ruling, 2026-11-13.)
10. **No "Every X" openers, no "its own", no "rather than" asides.**
11. **Title Case for controls and headers,** with short words lower case: a, an, the, and, or, of, to, in, on, for, at, by, from, with, as.
12. **One word per idea, from the glossary below,** even when a synonym reads better in one sentence.

A Soon control's hover reads `Not built yet: <what is missing>.` in plain words, never the internal dependency. The badge stays "Soon". The rule lives in [`ui-design.md`](ui-design.md); the sentence is built in `packages/design-system/src/lib/components/maturity/soon-affordance.ts`.

## Why copy drifts

Code comments and rulings ledgers are written to explain, at length. A screen built right after reading them picks up that voice, and labels turn into descriptions. Write copy from this file, not from the comment beside it.

## Glossary

| Use                                   | Meaning                                                  | Don't use                                                      |
| ------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------- |
| Delete                                | Gone from Magna Carta                                    | erase, discard, destroy                                        |
| Remove                                | Taken off a list or unlinked. The thing still exists.    | delete (for unlinking), drop, take off                         |
| Clear                                 | Empty a field, filter or selection                       | reset (for fields)                                             |
| Edit                                  | The control that opens a change                          | modify, update, amend (except "Amend Agreement", a legal term) |
| Save                                  | Keep what you did                                        | commit, persist, save point                                    |
| History                               | The list of past changes                                 | every change, audit trail, change log                          |
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

`pnpm run lint:ux-copy` (`tooling/lint-ux-copy/`) scans `apps/web/src` and `packages/design-system/src`, skipping tests, stories and the developer console. It flags:

- an em dash in a string or markup text
- "Nothing answered" and its relatives
- "is where", "is who" and "is what" sentences
- "the platform" and "corpus"
- the old Soon wording, "Waiting on" or "is not served yet"

Existing copy is a baseline in `tooling/lint-ux-copy/baseline.json` that only shrinks. The lint fails when a rule's app-wide total rises and names the files that grew. A falling count is reported, not failed. Run `pnpm run lint:ux-copy --update` to lock in the lower number.

The lint can't judge length, tone or whether a name is the familiar one. A reviewer checks those against this file.
