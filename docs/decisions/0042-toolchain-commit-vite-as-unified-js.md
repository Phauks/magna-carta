---
number: 42
slug: toolchain-commit-vite-as-unified-js
status: Accepted
date:
area: Toolchain
---

**Commit to Vite+ as the unified JS/TS toolchain; Oxc for lint/format; Biome dropped.** Vite+ (VoidZero) is the single entry point for **dev server (`vp dev`), build/pack (`vp build` / `vp pack`, Rolldown), test (`vp test`, Vitest), the one-shot quality gate (`vp check` = Oxfmt + Oxlint + tsgolint), and the monorepo task runner (`vp run`)** — one toolchain, one config in `vite.config.ts`. Lint/format = **Oxlint + Oxfmt**; **Prettier** is the interim formatter until **Oxfmt is GA** (not yet released). Vite+ is **free at our tier** (individual/small-firm; tiered, source-available — paid only for startups/enterprises), and its underlying tools (Vite, Vitest, Rolldown, Oxc) are **MIT**, so every command has an OSS fallback. **Alpha maturity accepted** (public preview targeted early 2026), risk bounded by that fallback. Investigated against **Biome** (mature, GA lint+format) — **rejected** because it would fork the toolchain family and duplicate Oxc; using the OSS tools without the Vite+ CLI also rejected (loses the unified entry point + task runner the owner wants). Pairs with ADR-0041 (testing).
