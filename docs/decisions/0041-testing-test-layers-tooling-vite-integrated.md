---
number: 41
slug: testing-test-layers-tooling-vite-integrated
status: Accepted
date:
area: Testing
---

**Test layers & tooling.** **Vite+ integrated testing** (the Vite+ toolchain's runner, Vite-native) is the **unit + Svelte component (behavior)** layer — components test against the same SvelteKit pipeline with no extra build config (props/events/state + accessibility). **Playwright** for end-to-end + **visual regression** (Chromatic screenshots over the **Storybook/Histoire** catalog). **Integration** tests run against **Miniflare** (local D1 + R2). A component is covered by **catalog entry + behavior tests + visual-regression** — appearance _and_ behavior. Test data is always the **write-path fixtures** (ADR-0034): real domain APIs, never raw inserts; seeded + deterministic. TDD expectations, CI gates, and coverage targets are detailed in Phase 0 (`docs/conventions/testing.md`). Rejected: catalog + visual-regression _only_ (verifies appearance, not behavior); a non-Vite test runner (would duplicate the SvelteKit build pipeline).
