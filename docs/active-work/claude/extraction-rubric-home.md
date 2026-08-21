---
worktree: /home/user/magna-carta/.claude/worktrees/extraction-rubric-home
area: docs — move the Worker-extraction rubric into the file ADR-0167 says it lives in
status: review
touches: docs/conventions/operations.md, docs/conventions/README.md, changelog.d
---

Documentation only, no product code. ADR-0167 says the five-property extraction rubric and the
worker template "are the living standard in `docs/conventions/operations.md`" and that specs and code
should cite that path — but the rubric was never written there, so the Worker-boundary question was
re-derived from scratch at least once. This stream writes it into `operations.md` as § 18, with the
current fleet as worked examples, and adds a pointer to it from § 11.

Nothing under `apps/`, `packages/`, or `docs/specs/` is touched, and the Decision-Log register is not
edited (it is a build output). If you are working on the split of the API surface from background
orchestration: § 18's compute-vs-coordination seam paragraph carries a short note saying that clause
is under active revision by a decision in flight. It names no ADR number and states no outcome, so it
is safe to supersede — replace the block quote, not the rubric around it.
