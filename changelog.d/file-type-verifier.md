---
category: Added
---

**File Type Verifier tool.** Identify a file's true content type, flag when its extension lies about the
content, and recommend the correct extension when it is missing or wrong. Powered by Google Magika,
running as an identification capability of the untrusted-byte scan subsystem. Detection runs in the
sealed scan Container (no network egress); verdict assembly (`match` / `mismatch` / `no-extension` /
`unverifiable`) and extension-mismatch reporting are handled by `@magna-carta/file-type` in the app
Worker.
