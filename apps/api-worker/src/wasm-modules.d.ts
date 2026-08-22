// Wrangler bundles .wasm imports as WebAssembly.Module at runtime. The generated .d.ts file
// adjacent to the .wasm binary describes its binary exports (used by wasm-bindgen's initSync),
// not the module object the bundler provides at the import site — so this ambient declaration
// overrides it for the Worker context.
//
// This file has no imports or exports (it is a "script" file), so declare module statements here
// are unconditionally global and visible to all TypeScript files in the compilation.
//
// ONE DECLARATION LEFT, and it is a countdown. The decryption and email engines now run in the
// workers that own them (apps/recovery-worker, apps/email-worker) and are reached from here over
// service bindings, so their declarations are gone with their imports. The PDF engine is the last
// one in this Worker; when assemblies/pdf-form-engine.ts and search/text-extraction.ts move behind
// their own port, this file goes with them and the app worker's build stops needing Docker.
declare module "@magna-carta/pdf/src/pkg/pdf_core_bg.wasm" {
  const wasm: WebAssembly.Module;
  export default wasm;
}
