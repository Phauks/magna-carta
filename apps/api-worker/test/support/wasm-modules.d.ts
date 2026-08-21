// The PDF engine's WebAssembly module, declared for the TEST compilation only.
//
// This worker's own bundle does not import it — PDF work goes over the SIGN_SERVICE binding to the
// worker that hosts the engine (src/documents/pdf-engine-binding.ts). The tests still need the real
// engine: the local pool cannot run the sign worker, so they stand one up in-process over
// `@magna-carta/pdf/service` and bind it as SIGN_SERVICE. Declaring the module here rather than in
// src/ is what keeps that a test-only fact — a declaration in src/ would make importing the engine
// back into the worker look supported.
//
// (No imports or exports here, so the `declare module` is global to the compilation.)
declare module "@magna-carta/pdf/src/pkg/pdf_core_bg.wasm" {
  const wasm: WebAssembly.Module;
  export default wasm;
}
