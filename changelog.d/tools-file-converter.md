---
category: Added
---

**Tools — a general File Converter (foundation).** A new matter-free file-conversion tool in the Tools area, built on the conversion core — convert a file to another format without uploading it to a matter. Registers the `tools:fileConverter` permission, a `documents` subject group, and the `file-converter` catalog manifest (library-backed, matter-free). Adds file-facing helpers to `@magna-carta/conversion` (`detectFormat`, `availableTargets`, `convertFile`) that map a `File` to a registered format, list its conversion targets, and convert it to a downloadable `Blob`. The interactive widget rides the design-system shell, the server-side engines (Office/AV) ride the conversion substrate, and role-seeding lands with the UI — none of which this foundation needs.
