---
category: Fixed
audience: internal
---

**Four tests that were red on main pass again.** The role-seed expectations in `me.test.ts`, `auth-provisioning-e2e.test.ts` and `node-sqlite.test.ts` now include the `exhibits:manage` and `exhibits:issue` grants the exhibits migration seeds for the practising roles. `history-stack.test.ts` again expects `irreversibleAnnouncement` to compose the sentences it is given, after a copy pass had rewritten the expected output without changing the input.
