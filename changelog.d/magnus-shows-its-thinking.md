---
category: Added
audience: public
---

**Magnus shows its thinking.** `ConversationInput` gains `onThinking`: given, the gateway sends a third-party model `stream: true` with `thinking: { type: "adaptive", display: "summarized" }` and reads the Messages event stream (`packages/inference/src/conversation-stream.ts`), handing the growing summary to the listener. The Magnus consumer writes it onto the pending turn's new `magnus_turn.thinking` column at most once a second and in full before the answer settles; the poll and the turn read return it. The transcript shows it in a Thinking section that folds shut when the answer lands, and the 30-second "taking longer than it should" note and its timer are gone. The buffered `responseText` now joins every text block, so an answer that starts with a thinking block is no longer read as empty.

## Public

**See what Magnus is thinking.** While Magnus works on an answer, a Thinking section shows a summary of what it is considering and grows as it goes, in place of "Magnus is answering." When the answer arrives, the summary folds shut above it, and you can open it again. The long "taking longer than it should" message is gone.
