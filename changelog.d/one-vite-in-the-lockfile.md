---
category: Fixed
audience: internal
---

**One Vite in the lockfile, held by a lint.** `pnpm dedupe` drops the upstream `vite@8.3.7` the content-disarm package's install pulled back in as a peer, which made `svelte-check` fail `apps/web/vite.config.ts` with "Excessive stack depth" on main. The new `lint:single-vite` (governance dimension) fails any branch whose `pnpm-lock.yaml` resolves an upstream `vite` beside the Vite+ core, and names `pnpm dedupe` as the fix.
