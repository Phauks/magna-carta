import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectSourceFiles,
  crateWasmExports,
  declaredWasmExports,
  hashSourceTree,
  missingBindings,
  readStamp,
} from "./artefact-verification.mjs";

// The two questions bootstrap has to answer without trusting an mtime: "were these bindings built from
// the sources sitting here?" (the source hash) and "does what landed on disk export what the crate
// declares?" (the export check). A synthetic crate tree exercises both.

let workspace;

beforeEach(() => {
  workspace = mkdtempSync(path.join(tmpdir(), "bootstrap-verification-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function writeFile(relative, contents) {
  const target = path.join(workspace, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
  return target;
}

describe("collectSourceFiles", () => {
  it("walks the source set and leaves build output out of it", () => {
    writeFile("crate/src/lib.rs", "pub fn a() {}");
    writeFile("crate/src/deep/wasm.rs", "pub fn b() {}");
    writeFile("crate/Cargo.toml", '[package]\nname = "crate"\n');
    writeFile("crate/README.md", "not a compile input");
    writeFile("crate/target/release/build-output.rs", "cargo output, not a source");
    writeFile("crate/.cargo/config.toml", "machine-local, generated");

    expect(collectSourceFiles(path.join(workspace, "crate"))).toEqual([
      "Cargo.toml",
      "src/deep/wasm.rs",
      "src/lib.rs",
    ]);
  });

  it("reports an absent directory as an empty source set rather than throwing", () => {
    expect(collectSourceFiles(path.join(workspace, "nothing-here"))).toEqual([]);
  });
});

describe("hashSourceTree", () => {
  it("gives identical sources the same hash wherever they live", () => {
    writeFile("left/src/lib.rs", "pub fn a() {}");
    writeFile("right/src/lib.rs", "pub fn a() {}");

    expect(hashSourceTree(path.join(workspace, "left"))).toBe(
      hashSourceTree(path.join(workspace, "right")),
    );
  });

  it("moves when a source's CONTENT changes, which an mtime comparison is what it replaces", () => {
    const source = writeFile("crate/src/lib.rs", "pub fn a() {}");
    const before = hashSourceTree(path.join(workspace, "crate"));
    writeFileSync(source, "pub fn a() {}\npub fn b() {}");

    expect(hashSourceTree(path.join(workspace, "crate"))).not.toBe(before);
  });

  it("moves when a source is renamed, even though the bytes are unchanged", () => {
    writeFile("crate/src/lib.rs", "pub fn a() {}");
    const before = hashSourceTree(path.join(workspace, "crate"));
    rmSync(path.join(workspace, "crate/src/lib.rs"));
    writeFile("crate/src/other.rs", "pub fn a() {}");

    expect(hashSourceTree(path.join(workspace, "crate"))).not.toBe(before);
  });

  it("ignores build output, so a build cannot invalidate the stamp it just wrote", () => {
    writeFile("crate/src/lib.rs", "pub fn a() {}");
    const before = hashSourceTree(path.join(workspace, "crate"));
    writeFile("crate/target/wasm32-unknown-unknown/release/crate.wasm", "compiled bytes");

    expect(hashSourceTree(path.join(workspace, "crate"))).toBe(before);
  });
});

describe("declaredWasmExports", () => {
  it("reads a module-level function under its Rust name", () => {
    expect(declaredWasmExports("#[wasm_bindgen]\npub fn parse(bytes: &[u8]) -> u32 {}\n")).toEqual([
      "parse",
    ]);
  });

  it("reads a renamed function under its js_name, which is the name the bindings export", () => {
    expect(
      declaredWasmExports(
        "#[wasm_bindgen(js_name = extractPart)]\npub fn extract_part(bytes: &[u8]) {}\n",
      ),
    ).toEqual(["extractPart"]);
  });

  it("reads a struct, which wasm-bindgen emits as a class", () => {
    expect(
      declaredWasmExports("#[wasm_bindgen]\npub struct PdfDocument {\n    inner: u32,\n}\n"),
    ).toEqual(["PdfDocument"]);
  });

  it("looks past doc comments and stacked attributes between the attribute and the item", () => {
    const source = [
      "#[wasm_bindgen(js_name = redactDocument)]",
      "/// Redacts the regions in place.",
      "#[allow(clippy::needless_pass_by_value)]",
      "",
      "pub fn redact_document(bytes: Vec<u8>) {}",
    ].join("\n");

    expect(declaredWasmExports(source)).toEqual(["redactDocument"]);
  });

  it("counts no export for an impl block — its methods hang off the class the struct declared", () => {
    const source = [
      "#[wasm_bindgen]",
      "impl PdfDocument {",
      "    #[wasm_bindgen(js_name = pageSize)]",
      "    pub fn page_size(&self, index: usize) {}",
      "}",
    ].join("\n");

    expect(declaredWasmExports(source)).toEqual([]);
  });

  it("counts no export for a wasm-bindgen test", () => {
    const source = ["#[wasm_bindgen_test]", "pub fn round_trips() {}"].join("\n");

    expect(declaredWasmExports(source)).toEqual([]);
  });

  it("counts no export for a private function", () => {
    expect(declaredWasmExports("#[wasm_bindgen]\nfn internal() {}\n")).toEqual([]);
  });
});

describe("crateWasmExports", () => {
  it("unions the surface across a crate's sources and ignores non-Rust files", () => {
    writeFile("crate/src/wasm.rs", "#[wasm_bindgen]\npub fn parse(bytes: &[u8]) {}\n");
    writeFile(
      "crate/src/forms.rs",
      "#[wasm_bindgen(js_name = readForm)]\npub fn read_form(bytes: &[u8]) {}\n",
    );
    writeFile("crate/Cargo.toml", "#[wasm_bindgen]\npub fn notRust() {}\n");

    expect(crateWasmExports(path.join(workspace, "crate"))).toEqual(["parse", "readForm"]);
  });
});

describe("missingBindings", () => {
  const bindings = [
    "export function parse(bytes) {}",
    "export class PdfDocument {}",
    "export function readForm(bytes) {}",
  ].join("\n");

  it("passes bindings that carry every declared name", () => {
    expect(missingBindings(["parse", "PdfDocument", "readForm"], bindings)).toEqual([]);
  });

  it("names exactly what a re-emit from a cached compilation left out", () => {
    // The reported failure: a source adds an export, cargo serves the build from a cached compilation
    // of the older sources, wasm-bindgen re-emits from it, and the caller gets "is not a function".
    expect(missingBindings(["parse", "stampBates"], bindings)).toEqual(["stampBates"]);
  });

  it("is not fooled by a name that only appears inside the module body", () => {
    expect(
      missingBindings(["stampBates"], "function helper() {\n  return stampBates;\n}\n"),
    ).toEqual(["stampBates"]);
  });

  it("is not fooled by a longer export that merely starts with the declared name", () => {
    expect(missingBindings(["parse"], "export function parseMbox(bytes) {}")).toEqual(["parse"]);
  });
});

describe("readStamp", () => {
  it("reads back a stamp it can trust", () => {
    writeFile("pkg/.source-stamp.json", JSON.stringify({ crate: "pdf-core", sourceHash: "abc" }));

    expect(readStamp(path.join(workspace, "pkg/.source-stamp.json"))?.sourceHash).toBe("abc");
  });

  it("treats an absent stamp as no stamp — the state a fresh worktree is in", () => {
    expect(readStamp(path.join(workspace, "pkg/.source-stamp.json"))).toBeNull();
  });

  it("treats a truncated stamp as no stamp rather than throwing", () => {
    writeFile("pkg/.source-stamp.json", '{"sourceHash": "abc');

    expect(readStamp(path.join(workspace, "pkg/.source-stamp.json"))).toBeNull();
  });

  it("treats a stamp with no hash in it as no stamp", () => {
    writeFile("pkg/.source-stamp.json", JSON.stringify({ crate: "pdf-core" }));

    expect(readStamp(path.join(workspace, "pkg/.source-stamp.json"))).toBeNull();
  });
});
