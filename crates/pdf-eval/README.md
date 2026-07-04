# pdf-eval

Regression-harness CLI for the PDF engine (`pdf-core`, `hayro`). See `src/main.rs`
for the full mode list (`smoke`, `parse`, `redact-smoke`, `sanitize-smoke`,
`detect`, `detect-smoke`, `render`, `surgery-coverage`, `fidelity`, `pdfium`,
`corpus-fetch`, `validate`).

## Validation harness

`src/validate/` is a reusable, engine-agnostic harness: it runs a set of
`ValidationOperation`s (phase 1 ships `forms`) over a corpus of PDFs, isolates
each run under `catch_unwind` + a wall-clock timeout, and classifies the result
as robustness (no panic/hang), safety (an operation-specific invariant held),
and coverage (good path vs. fallback vs. skip).

- `corpus-fetch` — downloads the forms corpus listed in `corpus-forms.lock`
  into `corpus-forms/` (gitignored; regenerated on demand, not committed).
  Requires the `corpus-fetch` feature:

  ```
  cargo run -p pdf-eval --features corpus-fetch corpus-fetch
  ```

- `validate <corpus_dir>` — runs every phase-1 operation over each PDF in
  `corpus_dir`, writes a per-document JSONL report to
  `pdf-eval/validation-report.jsonl`, prints a summary, and diffs it against
  the committed `validation-baseline.json`. Exits non-zero on any regression
  (a new panic, a new timeout, a new safety violation, or a drop in successes):

  ```
  cargo run -p pdf-eval validate pdf-eval/corpus-forms
  ```

`corpus-forms/` is gitignored and regenerated from `corpus-forms.lock` via
`corpus-fetch` — it is never committed. The small `corpus-ci/` corpus (checked
into the repository) backs the unit/smoke tests that run in CI without a
network fetch.
