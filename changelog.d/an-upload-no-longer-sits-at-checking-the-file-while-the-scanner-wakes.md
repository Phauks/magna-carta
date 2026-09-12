---
category: Fixed
audience: public
---

**An upload's safety check no longer waits on a cold scan instance.** The first real upload after the
readiness work landed, then sat at "Checking the file" for minutes: the scan worker picked a random
one of five container shards, four of which had scaled to zero, the engine answered 500 until clamd
had loaded its signatures, and the ingest queue's three immediate retries met the same cold shard
three times and dead-lettered the file until the five-minute redrive. Four changes: the scan
worker's warm-poke cron is on (the first firm is onboarded, which the config comment named as the
condition); a keyless scan routes to the warm primary shard, and the interactive ingest lane sends
no key (the bulk lane keeps its per-file key for the fan-out); the interactive queue waits one
second to batch rather than five and carries ten retries; and the consumer retries with a growing
delay rather than at once. The upload dialog says when the check is still running past the time it
waits, instead of reporting a finished upload the matter does not list yet.

## Public

**Uploads are checked promptly again.** A file you upload no longer sits at "Checking the file" for
minutes while the safety scanner wakes up: the scanner is kept ready, and a check that does have to
wait retries patiently instead of giving up. If a check is still running when the upload dialog
stops waiting, the dialog now says so — the file appears on the matter as soon as the check finishes.
