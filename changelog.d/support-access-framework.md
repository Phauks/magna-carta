---
category: Added
---

Support access framework — the backend rails for help-desk access to a firm's instance (backend +
API; UI follows). Access is pull-not-push: a firm member's request mints a time-boxed, audited grant,
and a named platform-staff member redeems it for a short-lived session — help desk can never let
themselves in. Two scopes ride the existing request chokepoint as an alternate, expiring principal: a
**diagnostic** scope that sees only non-privileged system state (status, schema version, storage,
member counts) and carries no decryption capability at all, and a **privileged** scope, hard-limited
to exactly what the requesting member can already see themselves (with an optional firm setting to
require an administrator's co-sign). The firm's owners are notified of every session and can revoke it
at any time; every request, grant, and redemption is recorded in a firm-visible audit trail attributed
to the named staff member. The firm's encryption key is never handed out — decryption stays on our
servers and a session simply stops working the moment its grant expires or is revoked.
