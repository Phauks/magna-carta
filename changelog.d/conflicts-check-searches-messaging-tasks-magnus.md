---
category: Added
audience: public
---

**A conflicts check searches calls, texts, email, tasks and Magnus conversations.** `packages/conflicts/src/content-search.ts` searches the check's subject parties in `communication`, `email_participant` and `email_message.subject`, `matter_task` (by matter status, archived tasks optional) and Magnus conversations (General included, deleted excluded): identity at tier 1, the name compared whole at tier 2, as `content`-class hits. A new nullable `conflicts_hit.found_in_json` records where each was found (kind, id, matter, instant; never text). The scope request takes `places`, run summaries echo it in `askedScope`, hit details carry `foundIn` with the matter's number, and runs report a `places` stage. Files and email bodies are not searched yet.

## Public

**Conflicts checks now look through your firm's calls, texts, email, tasks and Magnus conversations as well as the Directory.** Each is on by default in New Check and can be turned off. A result found there says whether it was a call, text, email, task or Magnus conversation, which matter it is filed on, and when it happened, with a link to the matter. An email's body and your files are not searched yet.
