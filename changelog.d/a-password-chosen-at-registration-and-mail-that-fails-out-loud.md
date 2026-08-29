---
category: Fixed
audience: public
---

**A password is chosen at registration, and the credential is committed with the account.** Every joining path — `registrations.confirm`, the firm-provision consumer's owner adoption, `members.invite`, invitation redemption — created a `user` row with no credential `account` row, on the theory that the mailed password-reset link would bring one into being. It does: Better Auth's reset endpoint inserts a credential account when `findAccounts` turns up none (verified against the installed 1.6.22, `api/routes/password.mjs`). But it only does so if the mail arrives and somebody acts on it, so a deployment with no `EMAIL_FROM` — which resolves the logging adapter and delivers nothing — produced accounts nobody could ever sign in to. The only symptom was the library logging `Credential account not found` from `api/routes/sign-in.mjs`.

`StartRegistrationRequest` now carries `password` (optional at the schema layer, bounded by Better Auth's own configured 8–128; required by the two doors that create something, refused as a field-level 422 naming the rule). It is hashed in that request with the library's own hasher and stored on `registration.credential_hash` — a new nullable column, so a registration in flight across the deploy still completes the account-less way it started. Confirming inserts the `user` row, its credential `account` row and the verified-email flag in ONE batch; the founding door passes the same verifier through `provisionFirm`, which commits it with the owner. `ConfirmRegistrationResponse` gains `next: signIn | checkEmail`. `joining-credentials.ts` is the one home for the hash and the account statement.

Redemption deliberately still mails its link: the code, surname and date of birth prove no mailbox, and that link is the only thing standing between somebody who guessed all three and another person's account.

**And an unguarded send no longer escapes as a 500.** `registrations.start` answers a retryable `503` (`mail-undeliverable`, Error ID, retry window) and keeps the row it committed — both branches identically, so a mail outage cannot become the account-existence oracle the endpoint is built to deny. The reset-based paths could not be guarded at the call site at all: Better Auth's `runInBackgroundOrAwait` awaits the send and swallows what it throws into its own logger, so `api.requestPasswordReset` resolves whether or not a mail left. The guard therefore sits on the PORT `app.ts` hands the library, where the failure is counted (`email.delivery_failed`, dimensions `surface` + `messageClass`) and correlated. No send path anywhere logs a body. `createAuth` also reads `baseURL` from `APP_BASE_URL` when set, silencing the library's cold-start warning.

## Public

**Registering now asks for your password, and the account you confirm is one you can sign in to straight away.**

Before this, creating an account sent a second email carrying a link that set the password. If that email did not arrive, the account existed and there was no way into it — sign-in simply refused, with nothing on screen explaining why.

You now choose the password on the registration form. It is scrambled the moment you send it, never stored or written to a log in readable form, and it is attached to your account at the moment the account is created — when you open the link in the confirmation email, which is still how we know the address is yours. One email instead of two, and the screen at the end says your account is ready and offers Sign In.

Password reset goes back to meaning what it says: replacing a password you already have.

If you were invited to a firm, redeeming your invitation still sends you a link to set your password. That link is deliberate — the code, surname and date of birth you type are not proof that the mailbox is yours, and the emailed link is.

**If a confirmation email cannot be sent, we now say so.** You get a message telling you nothing was lost and to try again in a moment — with an ID to quote to support if it keeps happening — instead of being sent to an inbox where nothing would ever arrive.
