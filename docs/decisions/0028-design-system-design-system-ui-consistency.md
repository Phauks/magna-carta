---
number: 28
slug: design-system-design-system-ui-consistency
status: Superseded by ADR-0076
date:
area: Design system
---

**Design system (UI consistency):** four enforced layers — **DTCG tokens via Terrazzo → CSS vars**, **Tailwind v4** (`@theme`, token-bound), **shadcn-svelte** component library as the sole primitives (Lucide icons, no emojis), and **full enforcement** (lint blocks off-token values + Storybook/Histoire catalog + visual-regression CI). Drift prevented by construction, caught in CI. vanilla-extract rejected (maintenance); Panda CSS runner-up.
