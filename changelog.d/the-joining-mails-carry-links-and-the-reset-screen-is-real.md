---
category: Fixed
audience: public
---

**The registration and sign-in path now works end to end, and its failures identify themselves.**
The confirmation mail carries a link to `/register/confirm?token=` (origin from the request) plus
the typed code as fallback, instead of the bare token as its whole body; the password-reset mail
links straight at the new `/login/reset-password` screen (origin from the request, or
`APP_BASE_URL` on the request-less firm-provision consumer path — `password-reset-link.ts`), never
at the library's own redirect hop, which spent the token on a bare GET and stranded the visitor on
an error page. The reset screen itself replaces its holding card: request a link, set the new
password, both enumeration-safe. A server fault on any joining screen now surfaces its correlated
Error ID under the message (`joiningSupportErrorId` + `CredentialNotice`), per
`docs/conventions/error-logging.md`. Local development no longer 500s on a fresh database: a
dev-only middleware (`dev-control-plane-bootstrap.ts`, gated on the same fail-closed signal as the
dev seed route) brings the control-plane schema to head before the first API request, closing the
"no such table" failure `wrangler dev` hit because it never fires the migration cron. The
terms-of-service and privacy-policy confirmation rows on the registration form flow as sentences
again instead of scattering across the label's flex row.

## Public

**You can register a firm and sign in, end to end.** The confirmation email now contains a link you
can click — with the typed code kept as a fallback — and the password email opens a real screen
where you set your password. If something goes wrong on our side, the message now shows an Error ID
you can quote to support.
