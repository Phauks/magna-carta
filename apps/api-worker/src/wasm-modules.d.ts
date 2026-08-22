// Wrangler bundles .wasm imports as WebAssembly.Module at runtime. The generated .d.ts file
// adjacent to the .wasm binary describes its binary exports (used by wasm-bindgen's initSync),
// not the module object the bundler provides at the import site — so this ambient declaration
// overrides it for the Worker context.
//
// This file has no imports or exports (it is a "script" file), so declare module statements here
// are unconditionally global and visible to all TypeScript files in the compilation.
declare module "@magna-carta/decryption/src/pkg/decryption_core_bg.wasm" {
  const wasm: WebAssembly.Module;
  export default wasm;
}
declare module "@magna-carta/email/src/pkg/email_core_bg.wasm" {
  const wasm: WebAssembly.Module;
  export default wasm;
}
// The PDF engine's module is deliberately NOT declared here: this worker no longer bundles it. PDF
// work goes over the SIGN_SERVICE binding to the worker that does host it — see
// src/documents/pdf-engine-binding.ts. The declaration the test suite needs to drive that engine
// in-process lives beside the tests, in test/support/wasm-modules.d.ts.
