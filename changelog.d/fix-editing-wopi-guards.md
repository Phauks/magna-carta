---
category: Fixed
---

- **The editor's live working copy is now served only to the session that owns it.** The WOPI file-access
  handlers chose between the mutable `files/{fileId}/current` object and the immutable version the access
  token names by the token's capability, so any edit token got `current` whenever the object existed. That
  object outlives the session that wrote it — an idle reap cuts a version but leaves the object in place —
  so a newly opened editing session could pick up an abandoned working copy as its base and save on top of
  it, and a token minted outside the live session could be handed bytes it was never scoped to. Both
  handlers now share one rule: read `current` only when an editing session is live, the token was minted
  for that session, and that session recorded the working copy; everyone else reads the version their token
  names, with no fallback between the two. `CheckFileInfo` applies the same rule, so the size and version it
  advertises always describe the bytes the next `GetFile` returns. Reading is still never blocked — a
  read-only viewer that joined the live session follows the live edits.
- **The document editor worker no longer boots a container for an invented hostname.** Its per-document
  routing accepted any nonempty first Host label as a container key, so any request carrying a plausible
  `Host` started an isolated multi-gigabyte Collabora container. The label is now validated against the
  shape the editor-launch actually mints — 52 lowercase hex characters of a SHA-256 digest — before
  anything addresses a container, and anything else gets a cheap 404.
