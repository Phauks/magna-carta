// The half of the stale-workspace-link diagnostic that is a pure string question, kept out of
// index.mjs so it can be tested without running a gate. index.mjs pairs it with the other half — the
// generated build references being in sync — before it says anything.
//
// The failure this recognizes: after merging a trunk that added a package or an export path, `tsc -b`
// reports `Cannot find module '@magna-carta/<something>'` against source that is perfectly correct,
// because workspace links resolve at INSTALL time and the module is genuinely absent from
// node_modules. The remedy is `pnpm install`, and the cost of not recognizing it is an afternoon spent
// debugging code that was never wrong.

// TS2307 and a @magna-carta specifier on the SAME line — which is how the compiler emits it
// ("error TS2307: Cannot find module '@magna-carta/ledger' or its corresponding type declarations").
// Deliberately not `[\s\S]`: a TS2307 about some unrelated module, several errors above an unrelated
// mention of a workspace package, must not match. The `[^\n]*` between them absorbs any color escapes
// a pretty-printing compiler puts around the code.
const MISSING_WORKSPACE_MODULE = /TS2307\b[^\n]*@magna-carta\//;

// Does this type-check output carry the signature of a missing workspace link? True is only half an
// answer — a genuinely missing project reference produces the same errors, and only the reference
// check tells the two apart.
export function mentionsMissingWorkspaceModule(output) {
  return MISSING_WORKSPACE_MODULE.test(output);
}
