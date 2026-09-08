# The load manifest and the exception report

_Both documents are produced automatically when a load finishes, and both are kept for good. You
download them from the review set's Loads screen, where each load offers its manifest and its report
in two forms: printable, which is the one to attach to a letter, and machine-readable. This guide is
about what they say and how to read them._

## What they do

Every time you put material into a review set, the platform writes two documents about that load and
keeps them.

**The manifest** says what arrived: every document, where it came from, whose records it was, how big
it was, and its digests. It is the answer to "what exactly did you load, and how do we know it is what
we sent you".

**The exception report** says what could not be read, and why, one document at a time. It is the
answer to "you produced 12,000 documents out of 12,340 — what happened to the other 340".

The second one is the reason to care. A discovery production is a claim: _we produced everything we
could read._ Without a report, that claim is your word. With one, it is a document that names every
item the claim excludes and gives the reason for each — which is a much better position to be in, and
a much better thing to hand over voluntarily than to be asked for later.

## When they are written

When the last document in a load reaches an ending. Not before, and there is a reason for that: the
platform will not write a report about a load whose documents are still being read. Every document in
a load ends in exactly one of two states — **read**, or **excepted with a named reason** — and the
load only finishes when those two numbers add up to the number that arrived. If they do not add up,
the load stays open and nothing is written. A report that does not add up is not a report.

Once written, neither document is ever rewritten. If you re-process the set later — a new engine, a
better reader — that produces a new record of the re-processing. The manifest describes what the
other side handed you, and that does not change.

## Where to find them

Open the matter, go to **Discovery**, and open the review set. On **Loads** each delivery has its own
panel with four buttons: the manifest and the exception report, each in a printable form and a
machine-readable one. The printable form is the one you would attach to a letter — it opens for
anybody, with no account and no software.

The buttons stay unavailable until the load has finished, and that is deliberate rather than a delay:
the platform will not produce a report about a load whose documents are still being read.

Taking a copy is recorded in your firm's audit log — which load, which document, which form. The
contents are not.

## Reading the exception report

Both documents come in two forms at the same place: one for machines and one for people. The
printable one opens in anything and needs no account, which is the point — it is meant to be handed
over.

The printable report opens with the load, the counts, and a line that either says **yes** or shouts
**NO**:

```
RECONCILIATION
  Loaded      12340
  Processed   12000
  Excepted    340
  Loaded equals processed plus excepted: yes
```

Then a tally by reason, then one line per item. Read the tally first — it usually tells you the whole
story in five lines.

### The reasons, and what to do about each

Each reason is a genuinely different situation, which is why they are kept apart rather than lumped
into "failed". Several of them are things you can fix.

| Reason                        | What it means                                                      | What to do                                                                  |
| ----------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `password-protected`          | Locked with a password a person set                                | **Ask for the password.** This is the most commonly recoverable one         |
| `encrypted`                   | The content itself is encrypted; there is no password to type      | Ask the producing party for a decrypted copy                                |
| `encrypted-container-entry`   | A folder opened, but some items inside it were locked              | Ask for those items, or for the password to the folder                      |
| `corrupt`                     | The file is damaged past reading                                   | Ask for a re-send; a fresh copy often works                                 |
| `unsupported-format`          | Read as a real file, of a kind nothing here reads                  | The report names the format; ask for it in a common one                     |
| `no-text-extracted`           | Read successfully, and it contains no text at all                  | Usually a blank page or a picture with no words. See the note below         |
| `oversize`                    | Past a size limit                                                  | Ask for it split, or handled separately                                     |
| `extraction-timeout`          | Took too long to read                                              | Usually a re-run; raise it if it repeats                                    |
| `recognition-failed`          | A scanned page could not be read by the text recognizer            | Often a poor scan. Ask for a better one                                     |
| `conversion-failed`           | An older file format could not be converted before reading         | Ask for it saved in a current format                                        |
| `container-not-expanded`      | A folder inside a folder inside a folder — too deep to open safely | Ask for its contents sent flat                                              |
| `container-guard-tripped`     | A folder was refused because opening it was unsafe                 | Ask for its contents sent as ordinary files                                 |
| `malware-flagged`             | The scanner flagged it                                             | **It is kept, listed, and never opened.** Raise it with the producing party |
| `source-bytes-missing`        | The file is no longer where it was loaded from                     | Raise internally — something was removed that should not have been          |
| `load-file-metadata-mismatch` | An accompanying index disagreed with the files themselves          | The files win. Point out the discrepancy                                    |

**`no-text-extracted` deserves a note**, because it is the one people misread. A document that
contains no text is listed here rather than being indexed as empty. If it were indexed as empty, a
search would silently answer "this document does not mention the contract" about a document nobody
had actually read — the single worst thing a discovery search can do. So it is named instead. It is
in the set, a reviewer can open and look at it, and searching will not find words in it because there
are none to find.

### Two things the report will show you that are not failures

**A document can be listed and still say `processed`.** The commonest case is a folder that opened
fine and had two locked items inside it: the folder was handled, and the two items still owe you a
sentence. The state is printed on every line so you can tell.

**A document that is still being read is not in the report at all.** "We have not got to it yet" is
never recorded as "we could not read it" — the load simply does not finish until it has been reached.
That matters more than it sounds: a number in a report you have already handed over must not change
later because something finished.

## Reading the manifest

The manifest lists every document that arrived, with:

- what it was called and where it sat in the production
- the Custodian of Record it belongs to
- its family — a message and its attachments, or a folder and its contents, stay together
- its size and its **digests**: SHA-256, and MD5 and SHA-1 alongside it. The last two are there
  because e-discovery tooling and load-file specifications still ask for them; SHA-256 is the one to
  compare on. See [file hash and integrity](file-hash-integrity.md)
- what happened to it, and which reader read it
- whether it is a **duplicate copy suppressed from review**, and which copy stands for it

It also states what you were told to expect against what actually turned up. If a production's cover
letter claimed 500 documents and 498 arrived, the manifest says so. It does not quietly adjust the
number.

## Duplicates, and why nothing disappears

If the same document turns up three times — one email chain, three people's mailboxes — a reviewer
reads it once. The other two copies are **not deleted**. They stay in the set, each attributed to the
person whose files it came from, each pointing at the copy that was read.

That matters because "which of your people held this document" is a question you will be asked, and
sometimes asked under oath. A system that answered it with "we deduplicated that" would be a system
that had destroyed the answer. Here the copies are still there, they are still counted, and the
manifest marks each one.

Documents are matched as duplicates only when they are **byte-for-byte the same file**, or — for email
— the same message. Nothing is ever suppressed because it merely resembles something else.

## Tips and edge cases

- **Hand over the printable report, not the machine one.** Both say the same things; only one of them
  reads like a document.
- **Work the tally, not the list.** Five `password-protected` items and 300 `no-text-extracted` items
  are two completely different conversations, and the tally tells you which one you are having.
- **Ask early.** Almost everything on the recoverable half of the table is fixed by one email to the
  producing party, and it is much easier to send that email before a deadline than after.
- **A load per delivery.** If a party produces material three times, that is three loads and three
  reports, each with its own date and its own counts. That is a clearer story than one load whose
  edges nobody can describe.
- **Both documents outlive the review set.** Closing a review set frees up the working copies the
  platform made while reading — it never touches the manifest or the report, which are records.

## Related features

- [Review sets and loading](review-sets-and-loading.md) — creating a set, saying whose records these
  are, and getting material in.
- [Reading the documents in a review set](reading-the-documents-in-a-review-set.md) — what happens to
  each document after it is loaded.
- [File hash and integrity](file-hash-integrity.md) — what the digests in the manifest are and how to
  check one.
- [Coding documents in review](coding-documents-in-review.md) — deciding what each document is.
