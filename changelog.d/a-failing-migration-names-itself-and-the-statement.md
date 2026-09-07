---
category: Fixed
audience: internal
---

A migration that fails now says which migration and which statement, instead of only what SQLite thought of it.

Two outages ran on one sentence — `FOREIGN KEY constraint failed` — and that sentence is identical for every migration in the lineage and every statement inside each one, so it locates nothing. The runner had both facts in hand at the moment it threw and discarded them with the error it re-raised. A failure now reads `<tag> statement 5/9 [DROP TABLE matter] FOREIGN KEY constraint failed`, with the identity first so it survives the bounded field it surfaces through, and the statement collapsed to its opening keywords, which is what tells `DROP TABLE` apart from an `INSERT INTO role_permission`.

The health read's fault line is bounded longer than a logged message head to match. `MESSAGE_HEAD_LENGTH` is sized for a log line, where the same fault repeats across entries and the tail is recoverable from any of them; this is one line on screen for a fault a reader cannot get at any other way, and 120 characters cut it off before the part that identifies anything.
