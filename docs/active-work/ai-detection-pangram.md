# ai-detection-pangram

**Stream:** AI-Text Detection — Pangram first-vendor backend slice.
**Started:** 2026-06-29 · **Owner:** Trevor Goldsmith

## Scope

Wire Pangram behind the existing `AiTextDetectionPort` (platform-managed key, `credential: none`).
Backend-only (no UI — 0·7 gate), paste-text only. Spec:
`docs/specs/2026-06-29-ai-text-detection-pangram-slice-design.md`.

## Files expected to touch

- `packages/ai-detection/src/adapters/pangram.ts` + `src/settings.ts` + response schema + tests + purity allowlist.
- `packages/data-access` — `recordAiDetectionUsage` write + consent-setting read.
- `packages/database` — migration: per-firm `ai_detection_usage` table + `tools:aiTextDetection` role seed.
- `apps/worker` — `POST /api/v1/ai-detection/detect` route + adapter wiring + `PANGRAM_API_KEY` binding + OpenAPI/client regen.

## Deferred (not this stream)

BYO-key credentialed-adapter infra · billing/pass-through · doc text-extraction · UI · matter-action · bulk endpoint · type-level consent witness.
