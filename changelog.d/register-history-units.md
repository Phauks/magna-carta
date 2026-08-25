---
category: Fixed
audience: internal
---

The build register's history series now counts units of work, the same quantity the standing above it counts, so the two are comparable and the document no longer has to warn that they are not. Two reasons the series had stopped moving are fixed with it: a rebuild read the committed file before discarding it, which made a format bump impossible to execute, and the assembly workflow did not name the trunk, which the reconstruction identifies by ref name.
