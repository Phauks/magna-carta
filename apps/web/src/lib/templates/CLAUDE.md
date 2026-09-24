# templates — local notes

**Purpose.** The firm's template library — the Documents destination. What a template IS lives in
`@magna-carta/document-assembly` and its routes; this directory decides how the catalogue is read,
how a template is registered from the browser, and how one template is added to several matters at
once.

**Rendered at:** `src/http/routes/(app)/documents`. **Contract:** the `templates.*` and `assemblies.*`
operations, reached only through `@magna-carta/api-client` (see `$lib/api/CLAUDE.md`).

## Key files / entry points

- `template-columns.ts` — the register's column model and the derived STANDING (ready · being
  checked · archived). Pure; tested in `test/template-columns.test.ts`.
- `register-template.ts` — the presign → PUT → register ceremony over injected ports, and the
  registration report read as findings. `liveRegisterTemplatePorts()` is the one place the
  generated client is named for it.
- `add-to-matters.ts` — one assembly job per matter, each under its own idempotency key, polled to a
  per-matter standing; the summary and the row vocabulary. `liveAddToMattersPorts()` likewise.
- `template-register.svelte`, `new-template-dialog.svelte`, `add-to-matters-dialog.svelte` — the
  surfaces over those three.

## Local conventions

- **Standing is derived, not served.** The listing carries `status` and `currentVersionId`; neither
  alone says whether a template can be built from. Only a template with a clean current version is
  offered to Add to Matters, which is the same rule the matter's Files page applies in its picker.
- **A batch never stops at one refusal.** Each matter's standing is its own; the dialog renders a row
  per matter and the summary counts them.
- **A document with blanks is its own standing** (`landed-with-blanks`), never folded into "landed":
  it is on the matter and it needs a person's eye before it goes anywhere.
- **Nothing here says "filed".** A document is FILED with a court and nothing else may use the word
  (`docs/conventions/design-corrections.md`); a built document is "on the matter".
- **The kind is chosen at presign**, read off the file's name, because the signed URL covers the
  content type. A person never picks "Word or PDF" by hand.

## Gotchas

- The idempotency key for a registration or for one matter's submission is minted per INTENT and kept
  across retries (`$lib/api/write-intent.ts` says why); the dialogs hold the keys, the ceremonies
  take them.
- Nothing here spells a contract path; `lint:screen-data` holds that. The PUT to storage goes to the
  URL the presign answered, which is not a contract path.
