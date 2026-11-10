---
category: Added
audience: internal
---

**Meeting summaries: a ready transcript is summarized, with its action items, and an item can become a
task.** The server half; the summary card is the web half and is next.

- Every transcript that becomes ready begins a summary in the same batch (`meeting_summary`,
  `meeting_summary_action_item`, migration `20261110T000006_meeting-summary`), written on the recording's
  own queue as a third kind of message by `apps/api-worker/src/meetings/summary-consumer.ts` — no new
  queue. It is `refused` with a reason when the firm has not switched `meetings.summariesEnabled` on
  (`disabled`), when the firm has not allowed its content to reach a model at all (`not-eligible`), or
  when nobody was heard (`transcript-empty`). A firm that chose no model is summarized by the platform's
  own reasoning model hosted on Cloudflare (`@cf/openai/gpt-oss-120b`), so the conversation does not
  leave the platform unless the firm chose a model that sends it elsewhere.
- The transcript is sent through `InferencePort.generateConversation` — never as an assistant
  conversation — with a platform-authored instruction (`packages/meetings/src/summary-prompt.ts`) and one
  member message of `HH:MM:SS Name: text` lines. A transcript too long for the model's context window is
  summarized a part at a time (at most five, inside one message's wall-clock budget) and combined. Every
  call's provider usage is written to the firm's token meter, including a run that did not finish.
- The answer must be one documented JSON structure; anything else fails the summary with an Error ID
  (`summary-parse.ts`). An action item's owner is linked only on an exact match to a member's name as the
  transcript knows them, and a due date only where the model quoted transcript words stating it.
- `GET` and `POST /api/v1/meetings/{meetingId}/recordings/{recordingId}/summary` read (audited, one
  `meetings.summary.read` row of identifiers) and re-run a summary; its words are withheld whenever the
  transcript's filed document is trashed, held or gone. `POST …/summary/action-items/{actionItemId}/task`
  makes an item a task through `createMatterTask`, once. The recording list entry carries `summary`.
- The inference catalog records each reasoning model's context window (and answer limit where the
  provider publishes one), and a conversation may ask for an answer length; a model hosted on Cloudflare
  takes the platform's instruction as its first `system` message. The repo-wide scan in
  `packages/meetings/test/no-transcript-text-escape.test.ts` now covers summary text too. Amendments A57
  onward in the recording spec.
