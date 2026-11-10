---
category: Added
audience: internal
---

**A member can connect their own Outlook account, with calendar access only.** The sign-in runs
through Microsoft with a proof key, the account's token is sealed under the firm key, and the
Connected Accounts page names the account that was connected. Nothing syncs yet. The feature is
dormant until a Microsoft application is registered for the deployment and its two secrets are set
(`docs/deploy-queue.md`), and the page stays out of the settings navigation until then.
