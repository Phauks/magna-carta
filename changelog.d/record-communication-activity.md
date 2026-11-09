---
category: Added
audience: public
---

**A recorded call says what happened on the line, and a message taken on it becomes a task.** Four nullable columns on `communication` (`caller_id_name`, `outcome`, `spam_kind`, `message_task_id`), validated in `packages/communications/src/validation.ts` (`normalizeCallOutcome`, `normalizeCallerIdName`) rather than by CHECKs, since the table is populated. Outcomes are per direction (`INBOUND_CALL_OUTCOMES`, `OUTBOUND_CALL_OUTCOMES`); a spam outcome sets the `spam` disposition and refuses a matter; a transfer needs `memberUserId`; spam, no answer and a voicemail need no notes. `POST /api/v1/communications` takes `callerIdName`, `outcome`, `spamKind` and `message`; a message is written through `createMatterTask` in the same batch as the call (a `MessageTaskWriter` handed to `logCommunication`), needs `tasks:write` and, for somebody else, `tasks:assign`, and raises the ordinary task-assignment notification. The form's Activity section is `communication-activity.svelte`; the Identification tab counts earlier spam marks on the number from the rows themselves (`number-history.ts`).

## Public

**Say what happened on a call.** When you record a call, the new Activity choice says whether it was answered, transferred, a message taken or spam (or, for a call you made, connected, a voicemail left or no answer). You can also type the name the caller gave as their Caller ID.

**Taking a message puts it on your colleague's task list.** Choose Message Taken, pick who it is for, what they asked for, by when and whether it is urgent. Saving the call gives them a task such as "Call back Maria Lopez" and a notification.

**Spam calls warn you next time.** Mark a call as spam and say what kind; it is filed away without reaching the queue, and the next call from that number shows a Likely Spam warning with how many times the firm has marked it.
