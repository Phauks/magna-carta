---
category: Changed
audience: internal
---

**The API Worker's queue consumers and Cron sweeps no longer pull the whole route tree into their
bundle. It was one import.**

`authForEnv` lived in `app.ts`, the composition root. The firm-provisioning consumer imported it —
and through `scheduled.ts`, so did every Cron sweep. Importing the composition root for real pulls in
every route module registered inside it and every package those routes touch, so a consumer that
wanted one auth factory carried the entire application.

**Counting imports hid it; counting runtime imports found it.** Of the 165 imports of `app.ts` across
this Worker, **162 are `import type { Bindings }`** — the env type, erased at build, costing nothing.
Exactly one value import existed outside the entry point and the routes. By the naive measure the two
halves shared 205 files and neither had anything of its own; with that single edge cut they are 186
request-side, 109 background-side, and 44 genuinely shared.

`authForEnv` and the per-env Workers logger now live in `auth-wiring.ts` and `logger-wiring.ts`,
beside the existing `firm-key-provider-wiring.ts` and `presigner-wiring.ts`. Nothing changes at
runtime — the same factories, the same per-isolate caching.

**`pnpm run lint:background-imports` keeps it cut.** It distinguishes a value import of `app.ts` from
a type-only one syntactically, carries a negative control so a recognizer that matched nothing could
not pass silently, and refuses to report success if its own walk finds fewer than a hundred files. It
lives in `tooling/` rather than the Worker's own suite because that suite runs in Miniflare, which has
no filesystem to scan. Verified to fail on the edge it was written for, and to pass once it is gone.

No split is proposed or implied. The API and the background work stay one Worker — the point is that
a Cron sweep should not carry the route tree just to send one email, and that nothing was stopping it
from happening again.
