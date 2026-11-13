# Signing flow — sending a document for signature, signing it, and sealing it

Status: design, 2026-11-13. Builds on the seal (`packages/signing`, the `magna-carta-sign` Worker, `POST /api/v1/documents/seal`), the Certificate of Completion, and the meeting guest link (`docs/specs/2026-09-20-meetings-external-guests-design.md`), whose token, lane and refusal rules this reuses rather than re-inventing. The screens are the approved mockups in the project's `pdf-tools-and-signing/mockups/` (screens 5 to 9).

## 1. What this settles

The seal can already make a finished PDF tamper-evident and print a Certificate of Completion. Nothing yet lets a member **ask** somebody to sign, lets that person **sign**, or records what happened in between. This is that missing middle:

1. **Prepare** — in the PDF Editor, a member adds signers and places fields for each (Signature Fields tab).
2. **Send** — the member sets the order, how each signer proves who they are, the message and the expiry, and sends (Review and Send tab).
3. **Sign** — each signer opens their link (or the app, for a firm member), consents to sign electronically, adopts a signature, completes their fields and finishes. They may decline.
4. **Seal** — when the last signer finishes, the marks are drawn onto the pages, the document is sealed with the firm's certificate, and the signed copy is filed as a new version with the Certificate of Completion beside it.
5. **Follow** — the status panel on the document shows who has signed, who is next, the activity, and lets a member remind, correct or void.

## 2. Who can sign, and how they prove it

`AttributionLevel` in `packages/signing/src/esign.ts` already orders the ways. The first build offers three of the five:

| On screen             | Level                  | First build | Why not yet                                                                  |
| --------------------- | ---------------------- | ----------- | ---------------------------------------------------------------------------- |
| Emailed Link          | `email-link`           | yes         |                                                                              |
| Link and Email Code   | `access-code`          | yes         | The text-message variant waits on an SMS sender; email is the same code path |
| Signed In to the Firm | `firm-authenticated`   | yes         |                                                                              |
| ID Check              | `id-verified`          | no          | Needs an identity-verification provider behind a port                        |
| Client Portal Sign-In | `portal-authenticated` | no          | The client portal is not built                                               |

An option that cannot be used is not shown, rather than shown disabled: a choice the member cannot make is noise on the screen.

## 3. The model

### 3.1 States

A **request** (the certificate calls it the envelope) moves `draft -> sent -> completed`, or ends `declined`, `voided` or `expired`. Each **signer** moves `waiting -> notified -> opened -> signed`, or ends `declined`. "In order" notifies signer _n+1_ when signer _n_ signs; "all at once" notifies everyone on send. The request is `completed` when every signer has signed; it is then sealed, and sealing failing leaves it `completed` with the seal retried, never `sent` again.

These transitions live in `packages/signing` as pure functions (`requestAfter(event)`), tested on their own, so the routes only persist what the model decides.

### 3.2 Fields

A field belongs to one signer and sits on one page at a rect in PDF points `[left, bottom, right, top]`, the convention the redaction and visible-signature code already use. Kinds: `signature`, `initials`, `date-signed`, `full-name`, `text`, `checkbox`. `date-signed` and `full-name` fill themselves; the signer completes the others. Every field has `required`.

### 3.3 Tables (per-firm, additive)

```
signing_request
  id, file_id, file_version_number         -- the exact version sent; a later version does not change it
  document_hash_sha256                     -- of that version's bytes, recorded at send
  title, subject, message, signing_order ('in-order' | 'all-at-once')
  status ('draft' | 'sent' | 'completed' | 'declined' | 'voided' | 'expired')
  expires_at, remind_every_days (null = never)
  created_by_user_id, sent_at, completed_at, sealed_at
  signed_file_version_number, certificate_file_id   -- set by the seal
  created_at, updated_at

signing_signer
  id, request_id, position, name, email, attribution_level
  user_id (firm members only), status, notified_at, opened_at, signed_at, declined_at, decline_reason
  token_secret_hash, secret_version        -- outside signers only; SHA-256, never the secret
  access_code_hash, access_code_expires_at, access_code_attempts   -- 'access-code' only
  consent_disclosure_version, consented_at
  adoption ('typed' | 'drawn' | 'uploaded'), signature_object_key, initials_object_key  -- images in R2

signing_field
  id, request_id, signer_id, kind, page, rect_left, rect_bottom, rect_right, rect_top, required
  value_text (text/checkbox answers only; signatures are images in R2)

signing_event                              -- append-only; the certificate's audit log
  id, request_id, signer_id (null for the system), kind (SigningEventKind), at, actor,
  observed_ip, user_agent, detail
```

Observed IP and user agent are taken from the request on the server, never from the body. Personal-data registry: names, emails, IPs and the signature images are `retain-under-matter`, because who signed is part of what the record says happened.

## 4. The outside signer's link

Reused from the meeting guest link, section by section:

- **Token** — the shared HMAC wire format with its own `typ`, `signing-request-signer`; a 256-bit secret whose SHA-256 is stored on `signing_signer`. A signature that does not verify gets the flat 404; a valid but expired, voided, declined or rotated one gets a sentence the signer can act on.
- **Lane** — a guest lane at the chokepoint, `guestLane: "signer"`, with no user id and no permissions stashed; rate limit keyed by signer.
- **Opening costs nothing** — `/sign/<token>` (outside the `(app)` group) reads a reduced summary and writes only the `viewed` event; a mail scanner that follows the link signs nothing. Signing is a POST.
- **Access code** — for `access-code`, the page asks for a six-digit code emailed separately on request, valid 10 minutes, five attempts, stored hashed. Passing it records `identity-verified`.
- **Correct** — changing a signer's email or name rotates their secret and resends, so the old link stops at once.

A firm member signs in the app from a notification, under their own session; no link is minted for them.

## 5. Signing

1. **Consent** — the disclosure (section 8) is shown before anything else; agreeing records `consented` with the disclosure version. The signer can withdraw until they finish, which declines.
2. **Adopt** — Type (in one of the signature typefaces), Draw or Upload. The adopted signature and initials are PNGs sent to the server and stored in R2 under the request, never in the database. The click on **Adopt and Sign** is the intent.
3. **Fields** — Next Field walks through the signer's required fields in page order; Finish is enabled when all are complete.
4. **Finish** — one POST carries the field values; the server checks each field belongs to this signer, records `signed` with the counts of signature and initials blocks (the certificate prints them), and advances the request.

## 6. Sealing

When the last signer finishes, a queue job (not the request handler):

1. Loads the sent version and checks its hash still equals `document_hash_sha256`; a mismatch stops and is reported, because the record must be what was sent.
2. Draws every signer's marks onto the pages with the engine's `placeMarks` (pages counted from 1, rects in points; images fitted to the rect; text in a standard font, Windows Latin only, so a name the font cannot draw is refused at send rather than at seal).
3. Seals through the existing `SealPort` with the certificate data the port already takes: `envelope` (id, title, sender, the firm as `contact`), every signer's intent, consent and attribution, and the persisted `events`.
4. Files the sealed PDF as a new version of the same file, and the certificate PDF beside it, then records `sealed`.
5. Emails each signer that it is complete, with a link to download the signed copy valid for 30 days.

## 7. Routes

Member routes (`esign:send` to prepare and send, `esign:view` to read; a new permission namespace beside `esign:seal`):

| Method | Path                                                          | Does                                     |
| ------ | ------------------------------------------------------------- | ---------------------------------------- |
| `POST` | `/api/v1/signing-requests`                                    | Create a draft for a file version        |
| `PUT`  | `/api/v1/signing-requests/{id}/draft`                         | Replace signers and fields while a draft |
| `POST` | `/api/v1/signing-requests/{id}/sending`                       | Send                                     |
| `GET`  | `/api/v1/signing-requests/{id}`                               | Status, signers and activity             |
| `GET`  | `/api/v1/files/{fileId}/signing-requests`                     | Requests on a file                       |
| `POST` | `/api/v1/signing-requests/{id}/reminders`                     | Remind unsigned signers now              |
| `POST` | `/api/v1/signing-requests/{id}/signers/{signerId}/correction` | Change a signer's name or email          |
| `POST` | `/api/v1/signing-requests/{id}/voiding`                       | Void, with a reason                      |

Signer routes (guest lane, no identifier in the path; the request is a fact of the token): `GET /api/v1/signer/request`, `GET /api/v1/signer/document`, `POST /api/v1/signer/access-code`, `POST /api/v1/signer/access-code/check`, `POST /api/v1/signer/consent`, `POST /api/v1/signer/adoption`, `POST /api/v1/signer/finish`, `POST /api/v1/signer/declining`.

## 8. The consent disclosure (draft for the owner)

> **Agreement to sign electronically.** {Firm name} has asked you to sign this document electronically. By choosing Agree, you agree to receive and sign it electronically, and that your electronic signature is as binding as a signature by hand. You may ask for a paper copy, or choose to sign on paper instead, by contacting {sender} at {email}; this may delay the document. You can withdraw this agreement at any time before you finish signing by choosing Decline to Sign. To view and sign, you need a current web browser and an email account. Keep a copy of the signed document for your records; you will be sent a link to download it.

Each wording is a versioned constant (`2026-11` first); the version is recorded with each consent, so the exact text a signer saw can be reproduced.

## 9. Build order

1. **Model** — states, fields, ordering and completion counts in `packages/signing`, tested pure.
2. **Prepare and send** — tables, member routes, the Signature Fields and Review and Send tabs, the status panel; firm-member signers sign in the app.
3. **Outside signers** — the token, the guest lane, `/sign/<token>`, consent, access code, adoption, finish, decline, mails.
4. **Seal on completion** — the queue job, place-marks, filing the signed version and certificate, completion mails, reminders on a schedule.

Each lands as its own pull request; until step 4 a completed request waits unsealed, and says so on the status panel.

## 10. Open questions for the owner

- The consent wording in section 8.
- How long an unsigned request lives by default (the mockup shows 30 days).
- Whether outside signers get the signed copy by emailed link (proposed) or as an attachment.
