// The email engine's WebAssembly module, declared for TESTS ONLY.
//
// src/wasm-modules.d.ts no longer names it: nothing under src/ imports the email engine any more —
// it runs in apps/email-worker and is reached over a service binding, which is what keeps the
// email-core build out of this Worker's deploy. The capture suites still need a real parse to be
// suites about capture rather than about a stub, so test/support/email-engine.ts runs the same
// build in-process, and this is the declaration that import needs.
//
// It lives under test/ deliberately. Putting it back in src/ would make the engine importable from
// production code again with nothing to notice.
declare module "@magna-carta/email/src/pkg/email_core_bg.wasm" {
  const wasm: WebAssembly.Module;
  export default wasm;
}
