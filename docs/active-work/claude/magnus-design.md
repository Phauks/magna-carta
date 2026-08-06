# claude/magnus-design

**Scope:** Design only — the backend for **Magnus**, the assistant a firm member can talk to. Spec plus
implementation plan, a decision fragment, and a changelog fragment. **No product code in this stream.**

Owner ask (2026-08-06): _"I want you to build whatever backend we need for Magnus, the AI the user can
talk to… routing it through an AI GATEWAY seam"_ and, on AI features generally, _"it will need to be
opt-in, like many other AI features of course."_

## Files this stream touches

Created, all new — no shared or generated file is edited:

- `docs/specs/2026-08-06-magnus-design.md`
- `docs/specs/2026-08-06-magnus-implementation-plan.md`
- `docs/decisions/pending/magnus-conversation-backend.md`
- `changelog.d/magnus-design.md`
- this note

Explicitly **not** touched: `CHANGELOG.md`, `STATUS.md`, `STATUS.json`, `ROADMAP.md`, the white paper,
`docs/conventions/`, `docs/Decision-Log.md`, and every package under `packages/` and `apps/`.

## Overlap watch

The design **reads** these shipped surfaces and proposes changes to two of them in a later build
stream, so a concurrent stream editing them should know:

- `packages/inference/` — the design proposes **one additive operation** on `InferencePort`
  (`generateConversation`) plus the matching gateway request-body translation. Nothing is removed or
  renamed. No edit is made in this stream.
- `apps/worker/src/inference/`, `apps/worker/src/progress/` — read as precedent only.

A parallel research stream is assessing **Cloudflare AI Search**. This design deliberately does not
design retrieval; it names the one seam retrieval would attach to (`MagnusContextPort`) and stops.
