---
category: Fixed
audience: internal
---

**Meeting summaries: the server half is corrected after its review.** Amendments A68 to A80 in the
recording spec.

- A task made from an action item can be deleted again: the task delete clears the item's link in its own
  batch (`clearActionItemTaskStatement`, from `@magna-carta/meetings`), and the item reads as untasked.
- A retried `POST` with the same Idempotency-Key now answers the documented body — the summary as it
  stands, or `{ taskId, actionItem }` — instead of the stored pointer.
- A summary needs the firm's AI-processing eligibility as well as `meetings.summariesEnabled`, on every
  model. The platform's own model is now `@cf/openai/gpt-oss-120b` (Apache-2.0, text-only) in a catalog
  role no firm can select for the assistant, and every model hosted on Cloudflare is sent a default
  answer length when a caller names none.
- A due date is kept only when the words somebody said name its day and month one way — never a line's
  timestamp, never "the 14th" alone, never "3/12" — and a year that fits.
- The context bound reckons non-Latin text and timestamps honestly, each call has room for a reasoning
  model's answer, a long transcript's action items are kept whole rather than re-listed by a model, the
  wall clock is checked before each call, every call is metered as it completes, a call the model will
  never take stops being retried, a host's re-run no longer doubles a scheduled retry, the gate is read
  before every call, a withheld transcript is never sent, the answer is asked for in JSON mode, and a
  task's title is cut between characters. Migration
  `20261110T000007_meeting-summary-retry-and-failed-call` adds `model_failure_call` and `retry_at`.
