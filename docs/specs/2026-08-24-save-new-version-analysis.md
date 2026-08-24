# "Save New Version" — what it is, why it is wrong, and what replaces it

**Status:** analysis for owner decision. Nothing here is built.

The owner's objection, verbatim: _"I don't think I like the 'save new version' functionality, it is
somewhat confusing and it worries me. identify how to improve, necessity, and potential next steps or
replacement systems."_

The instinct is right, and the platform already contains the better mechanism. This is not a design
problem needing invention — it is one path out of three that was built without the safety the other
two have.

## Three paths already cut a version

| Path                                       | Entry                                      | Divergence-aware                 |
| ------------------------------------------ | ------------------------------------------ | -------------------------------- |
| `initiateUpload` → `commitVersion`         | **Save New Version**, and any plain upload | **No**                           |
| `initiateCheckin` → `commitCheckinVersion` | Check out a working copy, return it        | **Yes**                          |
| `commitEditedVersion`                      | The browser editor saving                  | Yes, through the editing session |

The check-in path records the **base version** the copy was taken from. On return it compares that
base against the file's current version:

- Base still current → clean fast-forward, the version commits and becomes current.
- Base has advanced → the bytes still commit (they passed the gate; nothing is refused), but the
  version is flagged `conflict_pending`, **current is not advanced**, the checkout enters
  `reconciling`, and a person resolves it. The conflicting copy is retained forever.
- Bytes unchanged → no version is cut at all. The round trip just releases the checkout.

`commitVersion` has none of this. It reads one thing about the existing file: whether the incoming
content hash equals the current version's hash, and if so it skips as a duplicate. There is no base,
no comparison, and no concept of divergence — `diverged` exists only on the check-in result type.

## The failure this allows

Two people open the same document at 9am, both work on it, both use **Save New Version**.

- Person A commits v4. Person B commits v5.
- v5 becomes current. A's work is not lost — v4 is immutable and still in the history — but nothing
  anywhere records that the two diverged, nobody is told, and the file simply reads as "v5, current".
- The next person to open it sees one document and no reason to look at v4.

Run the same scenario through check-out / check-in and B's return is refused the `current` slot, is
marked a conflicting copy against its stale base, and a human is asked to reconcile. Same bytes
stored either way. The difference is entirely whether the system knows a collision happened.

This is why the button is confusing. "Save New Version" reads like a save. It is really _replace what
everyone else sees_, performed blind.

## What it is actually for

Two real jobs are hiding inside one button:

1. **A document was edited outside the platform** — opened in Word, worked on, and is coming back.
   This is exactly the check-out round trip, done without checking out.
2. **A genuinely new revision arrived from elsewhere** — a signed copy back from a client, a
   conformed copy from the court. Nobody diverged; this is simply the next revision.

Job 1 is the dangerous one and already has a correct implementation. Job 2 is legitimate and needs no
divergence check, but it does need to state _where the revision came from_, which the current button
does not capture either.

## Recommendation

**Retire "Save New Version" as an upload-over affordance, and split the two jobs.**

1. **Editing outside the platform becomes Check Out → Check In.** Check Out mints a working copy and
   records the base; Check In returns it through the divergence-aware path. Both already exist; the
   file manager does not surface them. A checked-out file shows who holds it, which also solves the
   collision _before_ it happens rather than after.
2. **An arriving revision becomes "Add Revision"**, which is honest about being a new revision from
   outside rather than a "save", and which asks for its provenance (received from, on what date) —
   the fact a legal file actually needs and currently loses.
3. **Neither refuses the write.** This changes what is _recorded_, never whether bytes are stored.
   The owner's standing ruling holds: nothing is blocked.

## What this costs

The seams exist, so this is a surface change plus one field:

- The file manager gains Check Out / Check In actions and a "checked out by" state on the row. The
  service functions, the conflict state, and the reconciliation status are already built.
- "Add Revision" is `initiateUpload` as it stands, plus a provenance note on the version. That is a
  new nullable column and a form field, not a mechanism.
- `commitVersion` stays as it is. It is correct for a first upload and for an arriving revision; it
  was only ever wrong as the _editing_ path.

## Open question for the owner

Should a checked-out file be **read-only for everyone else** while it is out, or should others still
be able to add a revision alongside it? Read-only is the stronger guarantee and matches how a
physical file works. Permitting both is friendlier and leans on the conflict record to sort it out.
The platform can do either; the existing `edit_state` column already carries `checked_out`.
