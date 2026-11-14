---
slug: magnus-shows-the-models-thinking-summary-and-keeps-it
status: Accepted
area: AI / Inference
date: 2026-11-14
summary: "While Magnus answers, the transcript shows the model's own summary of its thinking, streamed from the provider with the summarized display, written onto the pending turn about once a second and kept with the answer. It replaces the bare answering note and the 30-second slow-answer warning. The summary is work product like the answer: never logged, never sent back to the model, erased only with the conversation."
---

**Magnus shows the model's thinking summary while it answers, and keeps it with the answer.**

**Context:** The owner asked on 2026-11-14 to see Magnus's thoughts instead of "Magnus is answering.", and with that to drop the "taking longer than it should" note. Current Claude models omit the thinking text by default and return a summary only when asked (`thinking.display: "summarized"`); the raw reasoning is never returned.

**Decision.** The Magnus consumer asks the inference port for the thinking (`ConversationInput.onThinking`), which sends the third-party request streamed with the summarized display. The growing summary is written to `magnus_turn.thinking` on the pending turn at most once a second and in full before the answer settles, and the poll returns it. The transcript shows it in a Thinking section that is open while the answer is pending and folds shut once it lands. The slow-answer note and its timer are removed.

**Consequences.** The summary is free text about the member's work, so it carries the answer's rules: nothing logs it, the request window never sends it back, and it is erased only with the whole conversation. Streaming is what the request now uses for Magnus answers on third-party models; a binding that answers whole is still read. Steps such as "Reading 3 files" are not recorded yet.
