---
category: Fixed
audience: public
---

**Meeting recording, hardened after review of compose and file.** Each track's staged audio is a list
of stretches anchored to the instant each began (`meeting_recording_track.segments`), so a participant
whose connection drops and returns is placed where they were heard rather than up to a padded part late;
the 300-second clamp on wall-clock silence is gone. A compose consumer claims each window on the row
(`meeting_recording.compose_claimed_at`, migration
`20261110T000003_meeting-recording-segments-and-compose-claim`) so two deliveries cannot upload the same
parts; recorded progress resets the attempt count, stalls are measured from the latest stop, claim or
progress, and the record is re-read before the composite is completed. A failed compose aborts its
upload session and multipart upload in the same failure, and `initiateUpload` gets a two-day
expiry as a backstop. An abandoned recording completes its staged uploads instead of aborting them, so
the seven-day retention keeps real audio. The compose checks its layout against the declared size,
composes without a staged object missing at the start and records an Error ID for it, and cleans
hostile event titles out of the file name. Ingest's in-memory inspection ceiling is 40 MiB
(`IN_MEMORY_INSPECTION_CEILING_BYTES`), so a long recording commits through the streaming path,
hashed and size-checked and marked unscanned as oversize, rather than running out of memory. Bucket
lifecycle rules for `meeting-recordings/` and abandoned multipart uploads under `files/` are set by
provisioning. The room keeps recently stopped recordings so a late start lights nothing and starts no
recorder; a calendar cancel's last retry settles; the recording list carries the filed version's
document state, and Open appears only for the clean current version. The compose queue runs ten
consumers. Clearing a full page of staging keys stays under SQLite's bound-variable limit.

## Public

**Meeting recordings are more dependable.** Somebody whose connection drops for a moment is heard at
the right point in the recording. Long recordings are filed instead of failing, and a recording opens
from the meeting only once its file has been checked. If a recording was filed without somebody's audio,
the list says so and gives a reference for support.
