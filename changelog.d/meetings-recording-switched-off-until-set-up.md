---
category: Changed
audience: internal
---

**Meeting recording ships switched off until the deployment is set up for it.** Recording,
transcripts, summaries and live captions are now on `main`, but the recording queue
(`MEETING_RECORDING_COMPOSE`) is left unbound in `apps/api-worker/wrangler.jsonc`, because a deploy
that binds a queue the account does not have fails. The start route now also requires that queue
before it offers recording. The owner's steps are in the operations runbook under "Turning meeting
recording on".
