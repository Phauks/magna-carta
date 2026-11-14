---
category: Changed
audience: public
---

**Changing a message while Magnus answers.** `turnChangeRefusal` no longer refuses for a pending answer. The edit and remove routes read the conversation's pending answer (`readPendingAnswer`) and pass it as `cancelling`; `submitTurn` and `removeTurn` settle it `refused` / `cancelled` in the same batch, audited. The consumer reads the turn again after the model answers and, for a cancelled turn, commits only the token meter and the dedup record. Its model port is injectable (`MagnusConsumerPorts.inference`). The transcript's Edit and Remove buttons stay enabled while an answer is pending, and the Remove dialog says the answer will stop.

## Public

**Edit or remove a message while Magnus is still answering.** You no longer have to wait. Editing a message stops the answer in progress and asks again with your new version; removing one stops the answer and leaves a note where the message was.
