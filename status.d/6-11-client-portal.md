---
slice: 6·11 — Client portal
group: phase-6
order: 11
research: n/a
spec: done by="Claude"
plan: todo
built: in-progress by="Claude"
ui: todo
load-profile: todo
tested: todo
branch: claude/project-thread-mg0nu9
active-work:
next: Step 2, grants and the Share window (mockups first); owner questions 1 to 5 in the spec run on their defaults until answered
link-spec: docs/specs/2026-11-20-client-portal-design.md
link-plan:
adrs: ADR-0036, ADR-0304
blocked-by:
---

**Design written; the owner picked the To Do First home (option B) on 2026-11-20.** The first release is Home, Documents, Upload requests, Bills with Pay and Sign, built in seven steps. Step 1 makes ADR-0304 true: today the client invitation writes a portal client with the inviting firm's id, so a surface that forgets the kind places the client inside the firm. Grants live in the firm database with a control-plane index that only says which firm to read, because a portal session carries no firm. Pay waits on the payments entry point being built in parallel; messages wait on a firm-side home. Step 1 is built: `user.principal_kind` with an `account` state the ADR did not foresee (account-first joining makes an account before its kind is known), portal membership, client invitations that name a Directory person and provision no member row, and a chokepoint gate that refuses a portal client on every route that does not list the kind.
