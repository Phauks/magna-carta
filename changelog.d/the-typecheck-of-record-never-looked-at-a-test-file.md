---
category: Fixed
audience: internal
---

**The typecheck of record covers `src/` and nothing else — 837 test files across all 71 graph members
are checked by no pass in the gate. Three real type errors that had been sitting in
`@magna-carta/notifications` are fixed; the gap itself is now written down instead of implied.**

**The report that started it held exactly.** On a clean `origin/main`,
`tsc -b packages/notifications` reports three errors and `tsc -b tsconfig.build.json` reports none:

```
test/delivery-end-to-end.test.ts(387,26): error TS2345: Argument of type 'SqlStatement[]' is not
  assignable to parameter of type 'NodeSqlStatement[]'.
  Property 'bindings' is missing in type 'SqlStatement' but required in type 'NodeSqlStatement'.
test/read-bounds.test.ts(122,28): error TS2339: Property 'bindings' does not exist on type 'SqlStatement'.
test/read-bounds.test.ts(141,26): error TS2339: Property 'bindings' does not exist on type 'SqlStatement'.
```

Both sites ask a builder-returned statement for `bindings`, which only the node-sqlite adapter's
`NodeSqlStatement` has — the builders deliberately type their return as the narrower D1-shaped
`SqlStatement`. The code was right about the runtime and wrong about the type, so the fix is the
narrowing helper `packages/fixtures/src/load-profile/*-measurements.ts` already spells out five times
over, not a change to either interface. Nothing about what the tests assert moved.

**The two commands disagree because they read different files, and that is the finding.** Each
generated `tsconfig.build.json` sets `include: ["src/**/*.ts"]`; `tsc -b <package>` reads the
package's own `tsconfig.json`, which lists `test/**/*.ts`. This is not one package's mistake —
**all 71 graph members** have a `test/` directory, **all 71** list it in their own `tsconfig.json`,
and the generated build config **replaces** that `include` rather than extending it. So `vp run typecheck`
— the gate's only type pass since `vp check` went to `typeCheck: false` — sees 1,078 source files and
none of the 837 test files beside them. Vitest strips types rather than checking them, so `pnpm test`
never notices either. A type error in a test file could sit on `main` forever with every gate green.

**The backlog behind the gap was measured, not guessed.** Type-checking every member against its own
`tsconfig.json` — the config that does include `test/` — surfaces **52 further errors across 16 of
the 71 members**, every one of them in a test file, on top of the three fixed here. They are ordinary
drift, not exotica: `TS2345` argument mismatches (18, mostly a raw `string` where a branded id is
wanted, or a hand-rolled database double missing a method the real interface has), `TS2532`/`TS18048`
possibly-undefined (11), `TS2352`/`TS2353` bad casts and object literals (11), and three `TS2307`
missing-module errors where a worker test project was never wired for `cloudflare:test` at all. The
heaviest are `@magna-carta/magnus` (10), `@magna-carta/email` (7), and `@magna-carta/conflicts` and
`@magna-carta/document-assembly` (5 each).

**That count is a floor, not a total.** `apps/worker` holds 240 of the 837 test files — 29 percent of
the corpus — and its type-check did not finish inside 18 minutes, so it is excluded from the 52
outright. Whatever it holds is additional.

**The graph is not widened here, on purpose.** The member projects are `composite` +
`emitDeclarationOnly` with `rootDir: "src"`, so test files cannot simply join `include` — a file
outside `rootDir` cannot take part in that emit. Closing this properly means a second, non-emitting
test project per package, and burning down at least 55 errors before it can gate anything. Turning
that on across the repository in one commit is a decision with a cost attached, so it is filed as a
recommendation with numbers rather than made unilaterally.

What did change is that the gap is now stated where people look for it: the src-only boundary and its
consequence are written into `docs/conventions/build-performance.md`, and the comment in
`tooling/tsconfig-refs/index.mjs` that claimed "tests stay with `vp check`" — the sentence that made
this invisible, since `vp check` has not type-checked anything since `typeCheck` went off — now says
plainly that nothing checks them and gives the per-package command that does.
