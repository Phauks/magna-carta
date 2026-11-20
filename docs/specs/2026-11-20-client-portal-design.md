# Client portal: design

Status: design, 2026-11-20. The first spec for the portal. It builds on the white paper's _Client portal_ section, ADR-0036 (one grant record per share), ADR-0304 (a portal client is its own kind of account), the identity spec ([`2026-08-13-unified-identity-design.md`](2026-08-13-unified-identity-design.md), section 5), the signing flow ([`2026-11-13-signing-flow-design.md`](2026-11-13-signing-flow-design.md)) and the payments design ([`2026-08-15-payments-design.md`](2026-08-15-payments-design.md)). The home screen is the owner's pick from the mockups in the project's `client-portal/` folder: **option B, To Do First** (2026-11-20).

## 1. What this settles

The white paper settled what a grant is. Nothing was built: every node in `roadmap.d/portal.md` is `not-started`, and the only artifact is the reserved `PortalGrantId` type. This spec settles what the first release contains, the order it is built in, the tables and routes, and the screens. Open owner questions are in section 11 with the default this build takes until the owner answers.

## 2. What the first release does

A client signs in at the portal and sees, on one page:

1. **To Do.** What the firm needs from them: documents to sign, bills to pay, files the firm asked them to upload. Each row has one button (Sign, Pay, Upload).
2. **Recent Documents.** Files the firm shared, newest first, with View and Download.
3. **Bills.** Balance due and recent bills. Pay opens the payment window the payments work provides.
4. **Your Team.** The responsible attorney on each matter and the firm's phone number.

A matter filter narrows all four when the client has more than one matter. Top-level pages: **Home**, **Documents**, **Bills**.

Not in the first release (each stays `not-started` on the roadmap): messages (the firm side has nowhere to show them yet), bug reporting from the portal, per-recipient watermarks, sharing with someone who is not in the Directory, and excluding single files inside a shared folder. The last three are deferred by the white paper itself.

## 3. Build order

Each step ships working and on its own pull request.

| Step | What                                                                                | Roadmap nodes                                       |
| ---- | ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1    | Portal accounts: `principal_kind`, `portal_membership`, the client invitation fixed | `portal.identity`                                   |
| 2    | Grants: `portal_grant`, the Share window in the File Manager, revoke and expiry     | `portal.grant-model`, `portal.scopes`, `.lifecycle` |
| 3    | The portal lane at the chokepoint and the grant resolver                            | `portal.enforcement`                                |
| 4    | Home, Documents (view, download) at 1440, 1024 and phone width                      | `portal.ui`, `.capabilities.view`, `.download`      |
| 5    | Upload requests and the staff review list                                           | `portal.capabilities.upload`                        |
| 6    | Bills and the Pay button (waits on the payments entry point)                        | `portal.invoices`                                   |
| 7    | Sign from the portal (`portal-authenticated` signers)                               | `portal.capabilities.esign`                         |

Steps 1 to 3 have no client-facing screen. Step 2 has one staff screen (the Share window), which gets its own mockups before it is built.

## 4. Identity (step 1)

ADR-0304 is Proposed and not built. The shipped invitation route writes a client exactly like a staff member: `apps/api-worker/src/http/routes/session/invitations.ts` inserts the `user` row with the inviting firm's `firm_id` for both invitation kinds, and both redemption routes provision a member row. A surface that forgets to check the kind therefore places a client **inside** the firm.

ADR-0304 was written before account-first joining (`docs/specs/2026-08-29-account-first-joining-design.md`), and two of its details no longer fit. An account now exists before anyone knows whether it will join as staff or as a client, so its kind cannot be fixed at creation. And `firm_id` is already NULL for that unattached account, so the CHECK `(principal_kind = 'portalClient') = (firm_id IS NULL)` would be false for it. Step 1 builds the ADR with those two corrections, recorded as an amendment (`docs/decisions/pending/principal-kind-has-an-account-state.md`):

- `user.principal_kind` is `account | firmMember | portalClient`, NOT NULL, default `account`. `account` may become either of the other two, once; the other two never change.
- A firm member always has a `firm_id`; a portal client never has one. `user` is a parent table with rows, so SQLite cannot gain a CHECK in place. The rules are triggers in the migration instead (`20261120T193642_portal-client-kind`): a `BEFORE` pair refuses a mismatch or a settled kind changing, and an `AFTER` pair makes an `account` that gains a firm a `firmMember` in the same statement, so the staff joining paths need not name the kind.
- `portal_membership(principal_id, firm_id, directory_entity_id, status, created_at, updated_at)` in the control-plane database, one row per firm, one account per Directory person per firm. `status` is `active | suspended`, and suspending is the firm's lever.
- A `clientOfFirm` invitation must name a Directory person (`directory_entity_id`); the issuing route checks the person exists and is not merged, and a trigger refuses a client invitation with none. Redeeming it, signed in or not, writes `principal_kind = 'portalClient'`, no firm, and the membership row, and provisions **no** member row in the firm database. A staff invitation is unchanged.
- The session carries the kind. `RouteMeta` gains `principals`, default `["account", "firmMember"]`. The chokepoint refuses an unlisted kind with the reserved 404 before it resolves a firm. No route lists `portalClient` yet, so a client reaches nothing until step 3, including the bootstrap.
- The community board no longer counts invitations (that subquery is gone); the hand-off route it signs in through keeps the default list, so a portal client is refused there too.

The migration converts any account made by redeeming a client invitation under the old code to a portal client with no firm. Those invitations named no Directory person, so no membership can be written for them and they reach nothing until the firm invites them again. The web app has no screen that issues a client invitation, so none are expected in production. A client invitation issued before the column existed is refused at redemption.

**Sign-in.** The default is the one-time email code the identity spec already designs. A grant whose assurance is `magic-link` admits the holder of a single-use emailed link for that grant only. `account-2fa` grants require a passkey or authenticator code. The session is challenged up to the strongest level among the grants a page reads. The sign-in page never answers differently for an address with grants at one firm, four, or none.

## 5. Grants (step 2)

### 5.1 Table (per-firm database)

```
portal_grant
  id                        PortalGrantId (pgr_)
  recipient_entity_id       Directory entity, NOT NULL
  scope                     'matter' | 'folder' | 'file'
  matter_id                 NOT NULL (every scope lives inside one matter)
  folder_id                 set for 'folder'
  file_id, file_version     set for 'file'; file_version null means "latest"
  capabilities              JSON array of 'view' | 'download' | 'upload' | 'sign' | 'bills'
  assurance                 'magic-link' | 'account' | 'account-2fa'
  expires_on                civil date, nullable
  status                    'active' | 'revoked' | 'expired'
  granted_by_member_id, granted_at, revoked_by_member_id, revoked_at
```

`folder` gains `portal_shareable` (boolean, default false). A matter grant covers the folders marked shareable **when the grant is read**, never folders created later unless someone marks them. Child folders of a shared folder stay private until marked. A file grant may pin a version so "the PDF I sent" never changes under the client.

`message` is left out of the capability list until messages have a home, rather than reserved and unusable.

### 5.2 The grant index (control plane)

A portal session has no firm (identity spec, 5.4). Each portal request names the grant it uses, and the firm comes from the grant. To find the firm without searching every firm database:

```
portal_grant_index(grant_id, firm_id, principal_id, status)
```

Written in the same request that writes `portal_grant`, and updated on revoke and expiry. The firm database row is the authority; the index only says where to look. A request is admitted only if the index row's principal is the caller, the membership for that firm is `active`, and the firm row is `active`, unexpired and names the membership's Directory entity.

### 5.3 Rules

- A grant never exposes more than the sharer can see. Checked when the grant is made and again on every portal read against the sharer's current matter access. If the sharer has lost access, the read is refused and the grant shows "Needs a new sharer" to staff.
- Revoking takes effect on the next request. Preview and download addresses are already short-lived.
- Expiry runs from a scheduled job that moves `active` to `expired` and also from the read path, so a missed job never extends access.
- Every grant event and every view, download and upload writes the matter's audit log: names and ids, never content.

### 5.4 Staff side

A **Share** button on a matter, folder or file in the File Manager opens the Share window: who (Directory search, people only), what they can do (View, Download, Upload, Sign as checkboxes), sign-in level, optional end date. A **Shared** badge shows on every shared folder and file so staff can see what is exposed. The matter's **Sharing** list shows active grants with Revoke. Mockups for this window come before it is built.

## 6. The portal lane (step 3)

`route-meta.ts` already reserves `surface: "portal"` and `resource: "portalShare"`; nothing uses them. Portal routes are:

- `surface: "portal"`, `principals: ["portalClient"]`, `permission: null`.
- Mounted under `/api/portal/v1/`.
- Admitted through a portal resolver that reads the grant index and the firm's grant row, stashes `{ principalId, firmId, grantId, capabilities }`, and **cannot read `member`**. A staff handler pointed at a portal route fails on its first line, as the guest lane already does.
- Rate-limited per principal.

The aggregated home is the one route that spans grants: it reads the caller's memberships, then each firm's active grants for that membership's entity, in parallel, and returns per-firm blocks. It never takes a firm id from the client.

## 7. Screens (steps 4 to 7)

### 7.1 Where it lives

The white paper reserves `portal.magnacarta.esq`. The portal is a route group in `apps/web` served on that host, with its own host-only session cookie, so a staff session and a portal session never share a cookie even for one person holding both accounts. The host is attached as a `custom_domain` route in config, as `community.magnacarta.esq` already is. In local development the same routes run under `/portal`.

All UI is built from `@magna-carta/design-system`. The approved mockups are the target: `client-portal/option-b-1440.png`, `-1024.png`, `-phone.png`. No horizontal scroll at any width.

### 7.2 Home

As in section 2. To Do rows come from three sources, newest first:

| Row                   | Source                                                                                                                | Button |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- | ------ |
| Sign &lt;document&gt; | `signing_signer` rows with `attribution_level = 'portal-authenticated'` for the entity, status `notified` or `opened` | Sign   |
| Pay Bill &lt;n&gt;    | Unpaid bills on matters the client holds a grant with a bills view on                                                 | Pay    |
| Upload &lt;what&gt;   | Open upload requests (section 7.4)                                                                                    | Upload |

Empty state: "Nothing to do right now."

### 7.3 Documents

A table of everything shared, folders first, with Name, Matter, Shared and Size, a search box, the matter filter, and Upload when any grant allows it. Phone width keeps Name and the download button. View opens the existing inline viewer behind portal auth. Download uses the existing streaming zip engine for folders.

### 7.4 Upload requests

Staff ask for a file from the matter ("Upload photos of the damage"); that is a small record, `portal_upload_request(id, matter_id, grant_id, title, requested_by_member_id, requested_at, status)`. The client may also upload without a request where the grant allows it.

Uploaded bytes take the existing direct-to-R2 path and ingest checks. They land in a holding area, not in the matter's folders, and appear to staff in an **Uploads** list on the matter (and a count on Notifications). Staff **Accept** (choose a folder) or **Decline** (with a reason the client sees). Until accepted, the client sees the file as "Waiting for review" and nothing in the matter changes.

### 7.5 Bills

The client sees bills only on a matter where a grant includes bills. Bills are read through `readInvoiceDetail` and `readClientUnpaidInvoicesAsOf` in `packages/billing/src/queries.ts`; paid status is the sum of invoice applications, so a payment recorded by hand (`POST /api/v1/billing/invoices/{invoiceId}/payments`) already shows.

**Pay** calls the payments entry point the payments work is building (planned shape `startInvoicePayment(firm, invoiceId, card | bank)` returning a checkout token for Helcim's embedded payment window). Under the PCI rule in `docs/decisions/0181-pci-saq-a-hosted-payment-modal.md`, the page that opens the window loads **no third-party script** except the processor's own. Until the entry point exists, Pay is shown with the "Soon" badge.

The retainer balance (trust held for the client on the matter) is shown read-only on the Bills card if the owner agrees (section 11, question 3), from `readTrustAvailableBalance` in `packages/trust/src/holds.ts`.

### 7.6 Sign

A portal sign-in is the `portal-authenticated` attribution level the signing flow lists as waiting on the portal. Staff choose "Client Portal Sign-In" when sending; the signer must have an active membership for the firm. Sign on the To Do row opens the existing signing page, admitted by the portal session instead of the emailed link, and the Certificate of Completion records the portal sign-in.

## 8. Notifications

New notification types in the existing registry: `portal.documentShared` and `portal.signatureRequested` (to the client, by email), `portal.uploadReceived` (to staff, in-app), `portal.billIssued` (to the client, when a bill on a granted matter is sent). The client's email links go to the portal home, never to a file directly.

## 9. Words on screen

From the glossary in `docs/conventions/ux-copy.md`: Bill (not invoice), Upload, Matter, Documents, Sign, Pay, Share, Revoke. Staff-side labels: Share, Shared, Sharing, Uploads, Accept, Decline.

## 10. Testing

- The fail-closed property: a test per portal route that a `firmMember` session is refused as absent, and a test that a portal session on every `surface: "app"` route is refused.
- Cross-firm: a principal with memberships at two firms cannot read firm B's grant by naming it while holding only firm A's.
- Revoke, expiry and sharer-lost-access each refuse on the next request.
- Upload never reaches a matter folder without Accept.
- Screens: screenshots at 1440, 1024 and 390 beside the approved board before merge.

## 11. Open owner questions

The build takes the default in the right-hand column until the owner answers.

| #   | Question                                                                   | Default this build takes                                  |
| --- | -------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | How does a client sign in?                                                 | One-time email code; a single-use link for one-off shares |
| 2   | What is in the first release?                                              | Documents, Upload, Bills with Pay, Sign. Messages later   |
| 3   | Do clients see their retainer balance?                                     | Yes, read-only, on the Bills card                         |
| 4   | Does a client see every bill on a granted matter, or only ones staff send? | Only bills with status sent or later; drafts never        |
| 5   | Is the firm's logo shown on the portal?                                    | Firm name and initial now; logo upload later in Settings  |
