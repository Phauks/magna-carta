---
slug: a-meeting-summary-runs-through-the-inference-port-not-as-an-assistant-conversation
status: Proposed
area: Meetings
date: 2026-10-02
summary: "A meeting summary is written by one call through InferencePort.generateConversation with a platform-authored instruction, not as a Magnus conversation, so a privileged transcript is never copied into an assistant history; it runs on the on-Cloudflare model path by default and reaches a third-party frontier model only where the firm's AI-processing eligibility allows, and remains subject to ADR-0108's open consent question for that path. A refused summary is recorded as refused with its reason, never as an error."
---

**A meeting summary is one call through the inference port, not an assistant conversation.**

**Context:** the recording design ([`docs/specs/2026-09-20-meetings-recording-and-transcription-design.md`](../../specs/2026-09-20-meetings-recording-and-transcription-design.md)) produces a transcript of a privileged conversation; a summary
characterizes it.

**Decision.** The summary consumer calls `InferencePort.generateConversation` once, with an instruction
from `packages/meetings` and the transcript as one member message. It is not a `magnus_conversation`:
that would put a full privileged transcript into an assistant history, a second copy of the most
sensitive content the platform holds, for a job with no second turn. The on-Cloudflare model path is
the default; a third-party frontier model is reached only where the firm's AI-processing eligibility
allows, and otherwise the summary is `refused` with `refusal_reason: 'not-eligible'`. A member who wants
to ask follow-up questions attaches the filed transcript to an assistant conversation through the
attachment path that exists.

**Consequences.** The open consent question of ADR-0108 binds the frontier path and only it; the speech
models are hosted on Cloudflare and are unaffected.
