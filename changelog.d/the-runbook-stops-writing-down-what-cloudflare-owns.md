---
category: Changed
audience: internal
---

The operations runbook and the owner action queue no longer record any current value of Cloudflare account state — connected Workers, production branches, root directories, build commands, Build Watch Paths, build caching, hostnames and routes, deploy dates, build outcomes. Each is replaced by the runnable command that returns it.

The reason is a count. `operations.md` wrote those values down and disagreed with the live configuration four separate times: a connected-Worker roster short by five; the edit Worker's root directory, deploy command and branch, all three true when written and all three false when next read; two Build Watch Paths matching no file, which suppresses rebuilds silently rather than failing; and a conclusion drawn from `apps/api-worker/wrangler.jsonc` that no custom domain was attached to the app Worker, when the account has an active zone bound to it as one. Each was corrected. Each correction decayed the moment somebody used the dashboard, which leaves no commit behind.

A drift-detecting check was considered and rejected: it needs a committed copy of the truth to diff against, which is the same snapshot in a format that compares, and it cannot run in the gate of record because that gate has no Cloudflare credentials and must not require network.

What stays is what no API returns — the decisions and why, the operator procedures, the failure modes that have each cost a deploy, and the invariants. `operations.md` now opens with the rule and the four drifts as its evidence, so the next person tempted to paste today's values back in reads the reason first.

Falsified along the way, and corrected: the fleet-wide production-branch reconciliation and the missing `packages/build-identity/*` watch paths were both carried as open owner items and are not; `magna-carta` is reachable at a custom domain, not only at `workers.dev`; and it does have Build Watch Paths rather than rebuilding on every push.
