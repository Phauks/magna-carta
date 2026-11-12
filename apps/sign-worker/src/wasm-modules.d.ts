// Wrangler bundles a `.wasm` import as a pre-compiled `WebAssembly.Module`. The generated .d.ts
// beside the binary describes the module's wasm-bindgen exports, not the module object the bundler
// hands back at the import site, so this ambient declaration overrides it for the Worker context.
// (No imports/exports here, so the `declare module` is global to the compilation.)
declare module "@magna-carta/pdf/src/pkg/pdf_core_bg.wasm" {
  const wasm: WebAssembly.Module;
  export default wasm;
}
declare module "@magna-carta/pdf-compose/src/pkg/pdf_compose_core_bg.wasm" {
  const wasm: WebAssembly.Module;
  export default wasm;
}
