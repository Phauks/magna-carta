---
category: Changed
---

- **Bash is the canonical shell for this repo** (golden rule 7), with PowerShell reserved for genuinely
  Windows-native work. The two take opposite multi-line-string and path idioms, and mixing them was a
  measurable source of failed commands. Paths are written in one canonical form, passed absolutely
  rather than behind a `cd`, so a permission rule can match more than once.
