---
category: Added
audience: public
---

**Account · Security adds, removes and re-issues two-factor. It was the account surface's last Soon
seam.** The sign-in screen had verified a code since the auth backend shipped, and no screen could set
one up. `$lib/account/two-factor.ts` wraps the plugin's `enable` → `verifyTotp`, `disable` and
`generateBackupCodes`, and words each refusal by its code. The add panel is one `ActionDialog` whose
three steps (password, authenticator, recovery codes) turn over in place and end on `"done"`. It is
offered only while the session says two-factor is off: in the pinned plugin, `enable` on an enrolled
account replaces the working secret and marks it verified with no code asked for.
`apps/api-worker/test/account-two-factor.test.ts` pins that behaviour and three other facts the page
relies on (the session reporting the change at once, a refused removal leaving it on, and replaced
recovery codes retiring the old set).

- **`QrCode` in the design system** (`@magna-carta/design-system/qr-code`), over `uqr`: pure
  TypeScript, no dependencies, and it returns the module matrix rather than markup. It is drawn as one
  SVG path in the chrome token pair, the one pair that stays dark-on-light in dark mode. Checked by
  decoding the rendered screenshots in both modes with an independent reader.
- **The authenticator issuer is "Magna Carta".** Unset, the plugin fell back to the library's
  `appName`, so a member's phone would have filed the account under "Better Auth". The fix is
  `TOTP_ISSUER` on the plugin, not the instance-wide `appName`.
- `account-seams` now guards the other direction: no account page claims a Soon badge or a control
  waiting on a backend.

## Public

**Turn on two-step sign-in from your account.** On Security, add an authenticator app — Google
Authenticator, Microsoft Authenticator, 1Password or any other — by scanning a QR code or typing a
key. From then on, signing in asks for the six-digit code it shows as well as your password. You get
ten recovery codes for the day you cannot reach your phone; save them as a file or copy them into your
password manager. You can replace the codes (the old ones stop working at once) or turn two-step
sign-in off again, each with your password. Nothing changes about how you sign in until your app has
proved it has the code, so an attempt that goes wrong partway leaves your account exactly as it was.
