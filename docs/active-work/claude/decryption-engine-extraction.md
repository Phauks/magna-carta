---
worktree: C:/dev/magna-carta-worktrees/claude/decryption-engine-extraction
area: move the API Worker's recovery-hash extraction behind the RECOVERY_SERVICE binding
status: building
touches: apps/api-worker/src/decryption, apps/api-worker/src/routes/decryption.ts, apps/api-worker/src/routes/recovery.ts, apps/api-worker/openapi/openapi.json, apps/api-worker/vitest.config.ts, apps/api-worker/CLAUDE.md, apps/recovery-worker, containers/recovery, changelog.d
---

Extracts the recovery-hash half of `@magna-carta/decryption` out of the API Worker: the encryption
header parse (`extractHash` + the tier classification) now runs in the recovery Container behind the
`RECOVERY_SERVICE` service binding, resolved through a port in `apps/api-worker/src/decryption/`.
Branched off `claude/worker-decoupling` for the `apps/worker` -> `apps/api-worker` rename.

The **unlock** route (`stripWithKey`) is deliberately NOT moved — it takes the file's own password,
and putting that on the wire to a shared Container is an owner call, not a refactor. So the API
Worker still imports `@magna-carta/decryption` in `routes/decryption.ts`, and `rust-wasm-build`
still needs the decryption-core image. `claude/pdf-engine-extraction` owns the pdf half of the same
Docker dependency; nothing here touches `src/assemblies/`, `src/search/text-extraction.ts`,
`apps/sign-worker/`, or `apps/web-worker/`.
