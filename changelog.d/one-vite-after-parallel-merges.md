---
category: Fixed
audience: internal
---

**The lockfile's last two upstream Vite references are gone.** Two importers that landed in parallel with the single-Vite fix still named `vite@8.3.7` in their Vitest resolution; `pnpm dedupe` points them at the Vite+ core, and `lint:single-vite` now passes on `main`.
