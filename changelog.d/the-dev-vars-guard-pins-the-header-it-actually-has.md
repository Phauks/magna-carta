---
category: Fixed
audience: internal
---

**The `.dev.vars` placeholder guard was red on `main`, and with it the standing merge bar.**

`apps/api-worker/test/dev-vars.test.ts` pins the tracked `.dev.vars` byte-for-byte against a literal in the test. The two had disagreed since the header comment in `.dev.vars` was rewritten without the literal being updated in the same commit — which that test's own docstring asks for. Every key and value matched; the difference was one sentence of prose about which firm-provisioning adapter runs locally. So `pnpm test` failed for every branch, on a file most branches never touch, and the failure said nothing about the branch that ran it.

The literal now carries the file's current header word for word, and the test says out loud why the prose is pinned at all: a byte-for-byte guard cannot tell a rewritten explanation from an inserted credential, so it refuses both and a person decides which it was. That is the guard working, not a flaw in it — the cost is exactly this, and it is the right trade for a file whose whole job is to never hold a real secret.
