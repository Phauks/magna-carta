# claude/automation-protected-value-binding

**Scope.** Protected-value binding for document assembly: a merge field whose value lives in an
encrypted column resolves through the existing decrypt-permission-plus-audit chokepoint, and through
nothing else. A member who does not hold the decrypt permission gets a declared absence naming the
protected field and the permission it needs, never a blank, never the value, and never an aborted
assembly.

**Status.** building

## Files expected to touch

- `packages/document-assembly/src/protected-bindings.ts` (new — the protected merge sources, their
  dictionary rows, the reader seam, the absence reasons)
- `packages/document-assembly/src/types.ts` (the `protectedIdentifier` merge source)
- `packages/document-assembly/src/resolve.ts` (protected resolution, riding the party read)
- `packages/document-assembly/src/merge-statements.ts` (the party projection gains `entity_id`)
- `packages/document-assembly/src/directory-role-bindings.ts` (party row shape)
- `packages/document-assembly/package.json`, `test/purity.test.ts` (the two new allowed externals)
- `packages/document-assembly/test/protected-value-binding.test.ts` (new)
- `packages/document-assembly/CLAUDE.md`
- `apps/worker/src/assemblies/assembly-consumer.ts` (wiring the reader to the real decrypt path)
- `apps/worker/src/routes/templates.ts` (the field-list surfaces mark a field protected)
- `apps/worker/openapi/openapi.json` + `packages/api-client/src/` (regenerated — the field-list
  responses gain `sensitivity`)
- `apps/worker/test/document-assembly-protected-binding.test.ts` (new — the real audited decrypt)
- `docs/user/features/document-templates-and-assembly.md`
- `changelog.d/automation-protected-value-binding.md`, `status.d/2-6-document-automation.md`

## Overlaps to coordinate

- `apps/worker/openapi/openapi.json` and `packages/api-client/src/` are declared by
  `claude/email-add-in-client-api`, `claude/trust-matter-close-precondition`, and
  `claude/undeclared-body-contract-fix`. This stream adds one optional response property to two
  existing schemas; regenerate on top of whichever lands first.
