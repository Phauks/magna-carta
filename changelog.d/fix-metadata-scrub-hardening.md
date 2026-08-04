---
category: Fixed
---

- **The metadata scrubber no longer leaves revision, whole-part, or appended-data residue in a file it
  reports clean.** Accepting tracked changes now covers the entire word-processing revision
  vocabulary rather than deletions and move-out content alone: move range markers (which carry the
  reviser's name, the date, and the passage that moved), every property-change record, table row and
  cell revisions — a row or cell deleted under tracked changes is now removed rather than having its
  marker stripped while its text stays — and the revision save identifiers that link passages to
  individual writing sessions across the document, styles, and settings. Whole part classes that
  used to travel through a one-click scrub untouched and unreported are now handled: the rendered
  preview image of page one (which still showed the markup the XML pass had just removed), embedded
  custom XML data (where a document-management system stores its client and matter record), and the
  stored document variables, mail-merge data source, and attached-template path in the document
  settings — including the network locations those carry in their relationships. Dropping a part now
  also removes its content-type declaration and the relationships that point at it, so a scrubbed
  document stays valid for a strict reader; relationships are matched by what they resolve to rather
  than by the end of their address, so an external link whose URL merely ends in a removed part's
  name survives. Every rewritten part is written with a single XML declaration — a second one made
  the part malformed. For images, a JPEG scrub now ends the copy at the end of the image instead of
  carrying forward everything after it, which could be an entire embedded file, and both JPEG and PNG
  inspection report appended data; an image whose structure cannot be parsed is refused as unreadable
  instead of being returned as a header-only picture. The inspection report gained matching entries
  for the newly covered classes: embedded preview, embedded data, document settings, edit history,
  and appended image data.

- **The metadata tool's decompression guards now apply everywhere an archive is opened, at a limit the
  runtime can survive.** Format detection used to inflate the main document part with no guard at
  all, ahead of every guarded read, so a small crafted archive could exhaust the runtime before any
  cap was consulted; detection now answers whether the part exists without decompressing anything,
  under the same entry-count and declared-size caps as every other read. The total inflated-size cap
  was set above the memory available to the whole request, which meant it could never fire in time;
  it is now set well below it, with room for the buffers held at the same time. The upload endpoints
  also bound and validate the encoded body on the request schema, so an over-long or malformed upload
  is refused before it is decoded rather than allocating first or failing as an unexpected error.
