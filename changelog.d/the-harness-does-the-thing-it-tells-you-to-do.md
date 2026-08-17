---
category: Changed
audience: internal
---

**Three harness defects that all punished the honest path: retiring a stream note left a dangling
pointer, ending a test run left the runners alive, and a docs-only diff had to build three Rust
crates to be gated. All measured, all now one command or one condition.**

**Retiring an active-work note is one operation — `vp run retire-note <branch>`.** The worktree
lifecycle read as three parts (remove the worktree, delete the branch, delete
`docs/active-work/<branch>.md`) and had a fourth nobody had written down: any `status.d/` fragment
carrying `active-work: docs/active-work/<branch>.md` is then dangling, and `pnpm run lint:status`
fails with "active-work points at a missing file". It bit five times in one session — twice caught by
the lint after the fact, twice pre-empted by remembering to grep, once missed again by somebody who
already knew. The fourth part is invisible from where the deletion happens: nothing in
`docs/active-work/` knows who references it. So the command clears every pointer naming the note,
re-renders `STATUS.md`/`STATUS.json`, deletes the note, and removes the worktree and branch — the
pointer cannot outlive the note because the same command removes both. It refuses a branch that has
not landed (`--force` overrides, `--dry-run` previews, `--keep-workspace` does the paperwork only),
and it runs `lint:status` itself before reporting success. `vp run worktrees` already knew which
notes were dead; it now names each one's dependent fragments and this command in the same breath, and
the lint's own failure line names the repair instead of offering generic advice that cannot fix it.

**Ending a test run now ends the runners.** `pnpm test` killed its direct child, which is `vp` — two
levels above the work. Under it sit the Vitest CLI, the esbuild services and the workerd instances the
Miniflare suites stand up; signalling only `vp` orphans the rest. Measured interrupting
`pnpm test apps/worker`: the guard exited after 17 s and **released the single-flight lock with nine
runner processes still alive**, which stayed up a further **44 s**. The next run then claims the lock
correctly — its holder really has gone — and starts into a machine that is not idle, which is the
contention the lock exists to prevent arriving through the one door it does not watch, and which
presents as timeouts in files neither run touched. The runner now leads its own process group;
teardown is SIGTERM, a grace window, SIGKILL for the remainder, and the lock is released only once
the group is confirmed empty. The wait is bounded — a survivor is reported and the lock freed anyway,
because a lock held until an unkillable runner dies is the 0%-CPU holder the guard exists to
eliminate. Same target after: **zero survivors**. Detaching is gated on stdin not being a terminal,
which is the exact shape of the `SIGTTIN` hazard that would otherwise wedge `vp test --watch`, and
where the gate declines the kernel already signals the whole foreground group on Ctrl-C.

**A docs-only diff no longer has to bootstrap.** `check:scoped` ran its type-check unconditionally,
and `tsc -b` builds the whole project-reference graph — so the generated wasm artefacts were needed
whatever the diff was, and a branch touching only `docs/` and the ledger fragments had to build three
Rust crates (~80–100 s cold) before a gate that would not read a line of its own diff. The response
that produced was `git push --no-verify`, which is the real cost: a gate that makes bypassing it the
rational choice trains people to bypass it. The type-check is now scoped like every other conditional
step, and the artefact prerequisite scopes with it — skipping the artefact check _alone_ would have
been the bug, trading one message that names its own repair for twelve `TS2307`s that do not.
`tooling/check-scoped/typecheck-scope.mjs` enumerates what provably cannot be an input to `tsc -b`
(prose anywhere, the `docs/` tree, the rendered `STATUS.json`) and runs the check unless every changed
path is one of those, so a new extension or directory nobody anticipated takes the check. Measured in
a fresh, un-bootstrapped worktree: a docs-only diff passes in **2.4 s**; adding one `.ts` file to the
same diff correctly demands the artefacts and then type-checks, naming the path that made it run.
