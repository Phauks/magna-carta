---
category: Added
audience: public
---

**Meeting recording, the transcript's web half.** The Recordings panel gains a Transcript column
(`recordingTranscriptText` and `recordingTranscriptOpens` in
`apps/web/src/lib/meetings/screen/recording-list.ts`): "Being Made", "Read", or "Could Not Be Made"
with the Error ID wherever the row carries one. Pressing it opens the new transcript panel
(`apps/web/src/lib/meetings/screen/transcript-panel.svelte`, its words in `transcript-panel.ts`), a
reading `ActionDialog` over the list on the precedent of who was told, so it serves the room and the
Meetings page alike. The lines are a `Conversation` read through
`meetingsRecordingTranscriptInfiniteOptions` under `paged`, two hundred at a time with Load More on
the ordinal cursor: each under its speaker (a guest marked as one), at its place in the recording as
`mm:ss` or `h:mm:ss`, and each gap as a failed turn whose warning note says whose audio is missing
and for how long, or that nothing was heard. A transcript being made, one that could not be made, and
a ready one whose lines the read withholds (`linesWithheld`: removed, held or unavailable) are the
design system's `EmptyState`, decided by one pure function (`transcriptBody`), the failure stating
its Error ID; a ready one with no lines
says "No Results" inside its frame; a read that failed is the failure notice with Retry. A
transcript being made is read again every fifteen seconds while the panel is open, and the list is
read again the moment it settles. The WebVTT document opens beside the reader through the file's
own route and `opensBeside("file")`. Line text is drawn and nowhere else: not logged, not in an
address, not in a failure report, and the region is not a live region. Tests:
`apps/web/test/meeting-transcript.test.ts` and the Transcript column in
`meeting-recording-list.test.ts`.

## Public

**Read a recorded meeting's transcript.** The Recordings list now shows where each recording's
transcript stands, and a ready one opens right there: every line under the name of the person who
said it, at its place in the recording, with a highlighted line wherever somebody could not be heard
saying whose audio is missing and for how long. **Open Document** opens the transcript's captions
file on the matter, and a transcript that could not be made shows the Error ID to give support. When
that captions file has been moved to the trash or is held by the safety check, the transcript says
it is withheld and why.
