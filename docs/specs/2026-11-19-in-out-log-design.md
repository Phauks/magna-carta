# In/Out Log

**Date:** 2026-11-19
**Scope:** Owner request of 2026-11-19: a lightweight front desk log for things people drop off and
pick up that are not held in custody, such as copies of papers and physical files handed back.
**Status:** Built. The screen follows the owner's pick from the mockups in the project files
(`front-desk-log/`): option A, a separate log with a Move to Custodian action, laid out as a list with
tabs.
**Builds on:** the numbering register (`packages/sequence-numbering`), Custodian's New Packet path
(`packages/custodian`, `apps/web/src/lib/custodian/new-packet-dialog.svelte`), the Directory, and the
visible-matter predicate (`packages/calendar/src/visibility.ts`).

---

## 1. Why a separate log

Custodian holds a client's originals. It requires a Directory owner, draws a custody number, records
every movement on an append-only ledger and gates a release. That weight is right for a will and wrong
for a set of copies left for a lawyer. The owner ruled that copies and returned files must not cost
that, and that an item in the log can be moved into Custodian when it turns out to need it. The
item does not have to be an original to go to Custodian.

So the log is its own record, `in_out_entry`, and nothing in it writes a custody row.

## 2. Words

Owner's rulings, 2026-11-19: the feature is **In/Out Log**; the acts are **Drop Off** and **Pick Up**;
the people who may collect are **To**; the two tabs are **Waiting for Pickup** and **Log**. "Check out"
and "return" already mean lending a packet in Custodian, so this log never uses them.

## 3. The record

- `in_out_entry`: the number (`IO-0001`, from the firm's In/Out Log run on the numbering register),
  what it is, who it is from, an optional matter, where it is kept, notes, and status. Status is
  `waiting`, `picked_up` or `moved_to_custodian`, and it only moves forward.
- `in_out_entry_recipient`: the people it is To, in the order listed. Anybody listed may collect.
- A person is one of three kinds: a member, a Directory person or organization, or a typed name (a
  courier). The name is stored for every kind, because a log records who it was at the time.
- Pick Up records who collected it (one of the To people, or somebody else as a member, a Directory
  person or a typed name), whether their identity was checked (yes or no; no document number is ever
  transcribed), and who handed it over (the member signed in).
- A picture of the ID may be saved with the pick up, only where the ID was checked (owner,
  2026-11-20). The browser re-encodes it to a JPEG at most 1600 pixels on its longest side, which drops
  the camera's metadata. The bytes go to the firm's bucket under `in-out-identity-scan/`, keyed by the
  entry and their hash, before the batch; the `in_out_identity_scan` row commits in the pick up's own
  batch, and a refused batch removes the object again. Viewing it takes `inOutLog:manage` and is
  audited before the bytes are served.
- Move to Custodian is two writes: Custodian's own New Packet route logs the packet under
  `custody:manage`, prefilled from the entry, then the entry is linked to the packet.
- Delete is for a mistake, and only while waiting. The number is not given back.

Each transition overwrites the entry's own columns and writes an audit row beside it; the audit row
carries identifiers and the number, never the description or a name.

## 4. Permissions

`inOutLog:read` for every seeded role; `inOutLog:manage` for Owner/Admin, Attorney, Paralegal and
Billing. Both bind the firm, because an entry's matter is optional. An entry on a matter is visible
exactly when the matter is.

## 5. The screen

`/in-out-log`, in the Workspace group beside Custodian. Drop Off opens a window with From, What,
Matter, To (several people), Kept at and Notes, and shows the draft number before saving. Each waiting
row carries Pick Up and a menu with Move to Custodian and Delete. Search covers the number, what it
is, who it is from, who it is to, and the matter.

## 6. Not built yet

- Notifying the people it is To when something is dropped off. It needs a notification type; the
  Drop Off window does not offer it until it exists.
- The entry on a matter's own page and on a person's Directory record.
- Visitors. The log records things, not people signing in.
