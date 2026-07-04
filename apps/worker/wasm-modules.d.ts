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
