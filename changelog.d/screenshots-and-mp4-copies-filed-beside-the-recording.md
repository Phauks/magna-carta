---
category: Changed
audience: public
---

**Screenshots and converted copies are filed beside the recording.** Save Screenshot now files the
still into the matter, in the recording's folder, instead of saving it to the reader's computer. The
PNG carries its provenance in UTF-8 text chunks (Title, Description, Source, Comment, Creation Time,
Author), written by `apps/web/src/lib/documents/recording-still.ts`. A recording that will not play
now reads "Unreadable Media File" and, for an MP4, QuickTime or Matroska file whose refusal is about
its encoding, offers Convert to MP4. The playable copy is saved as a file of its own beside the
original ("<name> (converted).mp4"), through the same reserve, write, complete and ingest path as
any server-written document, and the original's version records it in the new
`playable_copy_file_id` column. A copy a member deletes is owed again on the next request.

## Public

**Screenshots and converted videos are saved to the matter.** A screenshot from a video is now saved
in the same folder as the video, and it carries the recording, the moment, the matter and who took
it inside the picture. A video your browser cannot play now offers Convert to MP4, which saves a copy
every browser plays beside the original.
