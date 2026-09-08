# Settings surface completion — implementation plan

The settings area has its frame built and most of its rooms empty. The nav, the banding, the draft
and commit flow, the change ledger, the plate/row anatomy and the mode-purity invariant are all
real; what is missing is the wiring between a page and the thing it claims to configure. This plan
inventories exactly what is stubbed, states the order the gaps close in, and specifies the first
slice — firm members and their rights — in build-ready detail.

Related: [`docs/specs/2026-07-10-account-settings-surface-design.md`](2026-07-10-account-settings-surface-design.md)
holds the separate `/account` surface (a member's own identity and credentials). The boundary
between the two is owner-settled and this plan does not move it: `/settings/users` is the firm
administering its members ("us"); `/account` is a member administering themselves ("me").

## The inventory — what each section actually is today

Read this as three columns of truth: what the page renders, what the server can already answer, and
therefore what the gap is.

| Section                         | Page today                                           | Server today                                                                          | Gap                                            |
| ------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Theme, Accessibility            | Real, end to end (local preferences, cross-tab sync) | n/a — per-browser by design                                                           | none                                           |
| Text                            | Four `Soon` seams                                    | n/a                                                                                   | needs font tokens / a text-scale overlay first |
| Firm Profile                    | Live: the firm's name over `PUT /api/v1/firm/profile` | The session bootstrap already returns the display name, so the read was never missing | none — built                                   |
| **Users**                       | **Four `Soon` seams — nothing works**                | **Invite + roster exist. Role assignment, deactivation and grants do not**            | **the whole administration surface — slice 1** |
| Matter Numbering                | Real editor, audited writes                          | Real (`/api/v1/numbering-scheme`)                                                     | none                                           |
| Calendar                        | Real, server-backed                                  | Real (`/api/v1/calendar/settings`)                                                    | none                                           |
| Reports                         | Real, server-backed                                  | Real (`/api/v1/firm/reports/policy`)                                                  | none                                           |
| Event Types, Resources          | Real catalog pages                                   | Real (`/api/v1/calendar/*`)                                                           | none                                           |
| Matter Plans, Intake Procedures | Real                                                 | Real                                                                                  | none                                           |
| Billing                         | Two preview rows in local storage                    | Backend setting definitions exist; only a read route (`time-entries/rounding-policy`) | a firm time-settings write route               |
| File Safety & Scanning          | Three `Soon` seams                                   | **Complete** — `GET/PATCH /api/v1/firm/scan-policy` under `firm:manageScanPolicy`     | wiring only                                    |
| Downloads                       | Real, server-backed                                  | Real (`/api/v1/downloads/preferences`)                                                | none                                           |
| Beta Access                     | Two `Soon` seams                                     | `PUT /api/v1/firm/release-channel` exists; no read                                    | a channel read, then wiring                    |
| Versions                        | Partly real                                          | Partial                                                                               | remaining component endpoints                  |
| Developer                       | Real (development builds only)                       | n/a                                                                                   | none                                           |
| **Notifications**               | **No page at all — the nav group renders empty**     | **Complete** — per-member matrix and the firm policy, both routed                     | **the page, and only the page**                |
| Integrations                    | No page                                              | Credential storage server-side only                                                   | a whole surface                                |
| Documents & templates           | No page                                              | Document-type and narrative-template routes exist                                     | a surface over existing routes                 |
| Diagnostics                     | No page                                              | The setting does not exist either                                                     | design first                                   |

Two facts fall out of that table and set the order.

**The client-side permission check is a mock.** `apps/web/src/lib/settings/settings-permissions.ts`
returns true for the `billing` area and false for everything else, regardless of who is signed in.
Every firm page's posture — editable draft versus read-only — is therefore theatre. The pages that
matter (Calendar, Reports, Matter Numbering) already bypass it and read the session's real
permissions directly, which is the pattern the seam should collapse into. Until it does, every new
firm page has to choose between the mock and a hand-rolled session read.

**An invited member lands with no role.** `POST /api/v1/members` sends `roleName: null` to the
provisioning consumer, so a new member is mirrored into the firm holding nothing. There is no
endpoint that assigns a role afterwards, no endpoint that deactivates a member, and no surface for
either. The firm can create people it cannot then empower — which makes the Users gap the one that
blocks a firm from actually operating, not merely from configuring.

## The order, and why

1. **Firm members and rights** (slice 1). It is the only gap that blocks a firm from working at
   all, it is what the owner asked for first, and every other firm-settings page becomes honest the
   moment the permission model behind it is real.
2. **The real permission seam** (folded into slice 1). `canEditFirmSettings` reads the session's
   effective permissions instead of returning a constant. Small, and it converts every firm page's
   posture from demonstration to fact in one edit.
3. **File Safety & Scanning** (slice 2). The whole backend exists; this is wiring, and it is the
   cheapest proof that the registry-driven page composition works against a real server.
4. **Notifications** (slice 3). The largest missing surface with a complete backend behind it —
   the per-member routing matrix plus the firm floor. Two pages, one in each band.
5. **Beta Access** and **Firm Profile** (slice 4, built). Neither needed the read endpoint this
   inventory assumed: the session bootstrap already answers both the firm's release channel and its
   display name, so Beta Access was pure wiring and Firm Profile needed one write route
   (`PUT /api/v1/firm/profile` behind a new `firm:manageProfile`) and no read at all.
6. **Billing** (slice 5). Needs a firm time-settings write route before its two preview rows can
   stop being local storage.
7. **Documents & templates**, **Integrations**, **Diagnostics** (later). Each is a new surface
   rather than a gap in an existing one, and Diagnostics needs a design before it needs a page.

## Slice 1 — firm members and rights (built)

### What a firm must be able to do

- See its roster: who is here, what they hold, whether they have been set up.
- Add a person, and say what they are on the way in — an invitation that lands with no role is the
  bug the current invite has.
- Change what somebody holds when their job changes.
- Take somebody's access away without erasing them: a deactivated member remains the responsible
  attorney on their matters and the author of what they filed.
- See what a role actually means before granting it — the permission set, in the firm's language,
  not registry keys.

Deliberately **not** in this slice: authoring custom roles, and direct per-member grants. Both have
schema behind them already (`role`, `role_permission`, `direct_grant`) and neither is needed for a
firm to operate. They are the natural second slice, and the routes below are shaped so that adding
them does not reshape anything.

### Backend

All routes bind `resource: "firm"`, sit behind the chokepoint, and take `firm:manageMembers` unless
stated. Every write is audited; the assignment writes are idempotency-required, matching the invite.

| Route                                          | Permission           | Does                                                                                                                |
| ---------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/roles`                            | `firm:readMembers`   | The firm's roles, each with the permissions it carries and how many members hold it                                 |
| `PUT /api/v1/members/{userId}/roles`           | `firm:manageMembers` | Sets the roles a member holds, as a whole set — the diff is the server's job, not the caller's                      |
| `POST /api/v1/members/{userId}/deactivation`   | `firm:manageMembers` | Deactivates a member; their rows stay, their session stops resolving                                                |
| `DELETE /api/v1/members/{userId}/deactivation` | `firm:manageMembers` | Reactivates                                                                                                         |
| `POST /api/v1/members` (change)                | `firm:manageMembers` | Accepts an optional `roleNames`, passed through to the provisioning consumer, so a person arrives holding something |

Reading roles rides `firm:readMembers` rather than a key of its own: the roster read already
discloses which roles a member holds, so the names and their meaning disclose nothing further, and
a member who can see that Ms Okafor is an Attorney should be able to see what that means.

Two invariants the routes enforce, both because the alternative is a firm that locks itself out:

- **A firm keeps at least one active member holding `firm:manageMembers`.** The last such member
  cannot be deactivated, and cannot have that role taken off them. Refused as a 422 that says which
  rule was hit, never a silent no-op.
- **A member cannot change their own roles.** Self-demotion is an accident, not a use case, and
  self-promotion is the whole reason the permission exists. Refused as a 403.

Deactivation stops the member's access at the chokepoint. The per-firm roster read already treats
`status = 'deactivated'` correctly, and `selectMemberPermissionsStatement` already joins
`member.status = 'active'`, so a deactivated member resolves to an empty capability set without any
further change — the route only has to flip the column and audit it.

### Frontend

**`/settings/users` becomes the roster.** A table, not a form: display name, status, the roles held,
whether a professional profile has been written, and a per-row action menu (Change Roles,
Deactivate / Reactivate). Instant posture per act, through a dialog each, on the Rooms and Resources
precedent — a roster is a catalog of people, and the draft-and-footer anatomy is for a page of rows.
The section's `commitMode` moves from `draft` to `instant` to say so.

**`/settings/roles` is new, under Firm.** One page listing the five seeded roles, each expanding to
the permissions it carries, grouped by subsystem and written in the firm's language rather than as
`matters:renumber`. Read-only in this slice — it is the reference a person consults before granting,
and the surface custom roles later grow into.

**The permission seam becomes real.** `canEditFirmSettings(area)` maps each settings area to the
permission that actually governs it and asks the session, replacing the constant. The call sites do
not change.

### Test plan

- Route tests per endpoint: the happy path, the 403 for a member without `firm:manageMembers`, the
  403 for self-modification, and the 422 for the last administrator on both routes that can strand a
  firm.
- A data-access test that a deactivated member resolves to an empty permission set.
- A frontend test that the roster renders a member holding no roles as holding none, rather than as
  a blank cell that reads as missing data.
- The existing mode-purity fitness check must keep passing with Users moved to `instant`.

## The account surface — a name is parts, not a string

Raised by the owner while slice 1 was in build, and settled here because it is a decision about the
record rather than about a form.

`/account/profile` asked for one "Name". It now asks for the parts a name has — prefix, first,
middle, last, suffix — with the display name composed from them rather than typed beside them. The
reasoning is the platform's own: a Directory person is already `prefix / given / middle / family /
suffix` with a rendered display name over it, and a member's own name is what the firm's letterhead,
its pleading signature blocks and its generated documents print. A single string cannot be sorted by
surname, cannot address a letter, and cannot be split back into parts afterwards without guessing —
"Mary Anne van der Berg III" has no rule that recovers it.

The rows stay honest seams, because the store behind them does not exist yet: the control-plane
`user` row carries one `name`, and the per-firm `member` row mirrors it as `display_name`. What
changes when authentication ships is therefore settled in advance:

- the control-plane user row grows the five parts, and `name` becomes the rendered display name
  rather than the thing typed;
- the per-firm `member.display_name` stays a mirror of that rendering, so every screen that resolves
  a colleague's name keeps reading exactly one column;
- the parts flow into the merge-field catalogue beside the professional profile's title and
  admissions, which is what a signature block needs;
- the invitation collects them too, since that is where a member's name is first written.

Prefix and suffix are also no longer free text boxes. They are one control — the product's own
combobox with its add row — over a suggestion list in `packages/directory/src/honorifics.ts`, used by
the Directory's person forms and this surface alike. The lists constrain nothing: the stored columns
are free text and stay free text, because a closed list would refuse a person their own name. What
they prevent is the drift a name record cannot afford, where "Jr", "Jr.", "JR" and "junior" are one
suffix spelled four ways that read as four on a letter.

The security half of the account surface — password, two-factor, sessions — is unchanged and stays
seams. It is worth recording what is missing from it beyond wiring, so the design is not discovered
late: recovery codes and their regeneration, a "sign out everywhere" act distinct from ending one
session, and recent account activity (where and when this account signed in) are all part of a
credible security page and none of them has a row today.

## Slice 2 onward — sketch

**File Safety** wires three rows to `GET/PATCH /api/v1/firm/scan-policy` and drops the `Soon`
badges. **Notifications** takes two pages: the per-member matrix under My Settings (instant, over
`/api/v1/notifications/preferences`, rendering the locked switches the firm floor imposes and saying
who locked them) and the firm policy under Firm Settings (draft, over
`/api/v1/firm/notifications/policy`, under `firm:manageNotificationPolicy`). The rest follow the
table above.
