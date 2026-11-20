# @magna-carta/sharing — CLAUDE.md

**Purpose.** Who outside the firm can see a matter's files and folders, and what each person can do:
the share records, the writes that create, change and stop them, and the read-time checks the client
portal answers access questions with. It does not authenticate anyone and renders nothing.

**White paper:** _Client portal_ (the unified grant). **Spec:**
[`docs/specs/2026-11-20-file-and-folder-sharing-design.md`](../../docs/specs/2026-11-20-file-and-folder-sharing-design.md).

## Key files / entry points

- `src/types.ts` — scopes, roles, sign-in levels, capabilities, `roleAllows`, `ShareRecord`
- `src/share-statements.ts` — the `share` table's SQL: the open-share condition, the sharer-can-share
  condition, insert/update/revoke
- `src/share-service.ts` — `shareItems`, `changeShare`, `revokeShare`: validation, upsert, audit
- `src/share-reads.ts` — `listMatterShares`, the staff list with names and dormant state
- `src/share-access.ts` — the portal's reads: `listSharedItems`, `listSharedFolderFiles`,
  `readFileAccess`, `canAccess`, `canAddFiles`, and `shareReadContext`

## Local conventions

- A share names a Directory person, never a typed address. A firm member is refused as a recipient.
- One active share per person per target: sharing again changes the existing one.
- Changing a share makes the actor its sharer; that is how a share whose sharer left is repaired.

## Invariants that apply here

- **Read-time, not write-time.** A share opens only while it is active, before its end date, its
  sharer is an active member who still holds `files:share`, the matter is visible, and the recipient
  is a live Directory person. Every portal read re-checks all of it in SQL (`openShareCondition`).
  Nothing is cached, so a revoked or ended share stops at once.
- **Folder scope is one level.** A folder share covers the files directly inside it, live; never its
  subfolders. Matter scope covers the files in no folder. The web index
  (`apps/web/src/lib/file-manager/sharing-index.ts`) encodes the same rule and must not drift.
- **Revoked rows are never deleted.** They are the audit trail beside the domain audit events.
- Firm-scoped data access only (golden rule 3): every statement runs on the firm's own database.

## Gotchas

- **SQLite numbered parameters.** `openShareCondition` uses `?1` (today) and `?2` (now). A plain `?`
  takes the largest number assigned so far plus one, so the explicit numbers must appear in the text
  before any fragment that uses plain `?`, such as the visible-matter predicate.
- **End dates are read in `Etc/GMT+12`**, the last zone on earth to reach a date, so a share ending
  on the 31st is open everywhere until the 31st is over everywhere.
