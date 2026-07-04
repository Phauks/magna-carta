---
slice: AI-Text Detection
group: cross-cutting
order: 14
research: n/a
spec: done by="Opus 4.8"
plan: done by="Opus 4.8"
built: done by="Opus 4.8"
ui: todo
load-profile: n/a
tested: todo
branch: main
active-work:
next:
link-spec:
link-plan:
adrs:
blocked-by:
---

`@magna-carta/ai-detection` vendor-agnostic core (signal-not-proof, `LikelihoodBand`). Pangram first vendor wired 2026-07-02 (Opus 4.8): platform-managed adapter (`credential: none`, one platform key), per-firm consent setting (`aiDetection.externalDetectionEnabled`, default off) enforced at the chokepoint, `POST /api/v1/ai-detection/detect` (paste-text; 422 when consent off or no key), per-firm `ai_detection_usage` metering (migrations 0033/0034). Deferred: UI (0·7), BYO-key, billing pass-through, document text-extraction, bulk endpoint, matter-action.
