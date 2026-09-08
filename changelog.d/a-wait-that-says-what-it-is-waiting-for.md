---
category: Fixed
audience: public
---

**A new firm no longer admits its owner before the member record that makes the workspace usable has landed, and the wait now names the steps it is on.** Activation flips the firm active and attaches the account to it in one control-plane batch; the member row every permission resolves through is written into the firm's OWN database afterwards, by the `member.provision` message that same batch queues. The welcome screen went in on the first fact, so a first sign-in could land in an app where every screen answered as though a role were missing — which is what the diagnostics panel's "Not in the database yet" row was reporting after the fact.

`GET /api/v1/me` gains two optional fields. `joining.build` reports how far provisioning has got, read from the firm row's own marks (`bucket_name`, `wrapped_firm_key`, `status`) and its outbox row rather than tracked anywhere, so a resumed build reports what it has actually done; `membership.state` distinguishes a mirror still landing from a member holding no role, which an empty permission list cannot. Both guards read the second — `(app)/+layout.ts` sends that person to `/welcome`, and `/welcome`'s own load keeps them there, so the two stay mirrors rather than a loop. The words for the five steps live in `apps/web/src/lib/auth/firm-build-progress.ts`, beside the screen, on the same split the database-health panel keeps: the wire carries facts, the browser decides sentences.

## Public

**A new firm no longer opens into a workspace that refuses every screen, and the wait to get there now names its steps.**

Creating a firm is several pieces of work — a record, encrypted document storage, an encryption key, the workspace itself, and adding you to it as its owner — and the last of them lands after the firm is already active. The app used to go in the moment the firm appeared, which is why a first sign-in could arrive at a workspace where every screen answered as though a permission were missing. It was a wait, not a permission, and nothing said so.

The joining screen now waits for that last step too, and shows which one it is on: each step is named, finished, in progress, or still to come. A build taking longer than usual says so, and work that has stopped and will not retry says that as well, instead of looking busy forever.
