// What makes a generated wasm-bindgen artefact trustworthy: a content hash of the Rust sources it was
// built from, and proof that the emitted JavaScript bindings actually export the surface the crate
// declares.
//
// Both exist because an mtime comparison cannot answer either question. Every worktree on this machine
// shares one cargo target directory, so a build can be satisfied from a cached compilation whose inputs
// are not the sources on disk here; wasm-bindgen then re-emits bindings from that cached artefact and
// the emitted files get a fresh mtime, which is exactly the signal an mtime-based staleness check reads
// as "current". The result is a build that reports success while `packages/*/src/pkg` holds bindings
// missing a function the crate exports — the failure only surfaces at runtime as "X is not a function".
//
// A content hash of the source set is immune to that (and to a fresh worktree checkout, where every
// mtime is the checkout time), and an export check is immune to a hash that is right for the wrong
// reason: it compares what the crate declares against what was actually written to disk.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

// Directory names that are cargo/tool output rather than source: hashing them would be both wrong (a
// build changes them, so the hash could never settle) and enormous.
const IGNORED_DIRECTORIES = new Set(["target", ".cargo", "node_modules", "pkg"]);

// The file kinds that can change what a crate compiles to. A README or a fixture image cannot.
const SOURCE_EXTENSIONS = new Set([".rs", ".toml", ".lock"]);

// Sorting is what makes every result here reproducible across machines, so the comparison is spelled
// out rather than left to the locale-sensitive default.
const byCodePoint = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

/**
 * Every source file under `directory`, as paths relative to it, sorted so the walk order of the
 * filesystem cannot change the result.
 */
export function collectSourceFiles(directory) {
  if (!existsSync(directory)) return [];
  const collected = [];
  const walk = (absolute, relative) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true }).toSorted((left, right) =>
      byCodePoint(left.name, right.name),
    )) {
      if (entry.name.startsWith(".") || IGNORED_DIRECTORIES.has(entry.name)) continue;
      const childAbsolute = path.join(absolute, entry.name);
      const childRelative = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(childAbsolute, childRelative);
      else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) collected.push(childRelative);
    }
  };
  walk(directory, "");
  return collected.toSorted(byCodePoint);
}

/**
 * A stable digest of the source set under `directory` — every file's relative path and its bytes. Two
 * worktrees holding identical sources produce the same hash regardless of where they live on disk or
 * when they were checked out, which is the whole point: it answers "are these the sources the artefact
 * was built from" rather than "is some mtime newer than some other mtime".
 */
export function hashSourceTree(directory) {
  const digest = createHash("sha256");
  for (const relative of collectSourceFiles(directory)) {
    digest.update(relative);
    digest.update("\0");
    digest.update(readFileSync(path.join(directory, relative)));
    digest.update("\0");
  }
  return digest.digest("hex");
}

// A `#[wasm_bindgen]` attribute in column 0 introduces a module-level item; the same attribute indented
// is a field or a method inside an impl block, which becomes a class member rather than a module export.
// `#[wasm_bindgen_test]` marks a test and exports nothing.
const MODULE_LEVEL_ATTRIBUTE = /^#\[wasm_bindgen(?![_a-z])/;
const JS_NAME = /js_name\s*=\s*([A-Za-z_$][A-Za-z0-9_$]*)/;
const EXPORTED_ITEM = /^pub\s+(?:fn|struct|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/;
// Lines that may sit between the attribute and the item it applies to.
const INTERLEAVED = /^(?:#\[|\/\/|$)/;

/**
 * The JavaScript names a Rust source declares to wasm-bindgen: every module-level `pub fn`/`pub struct`/
 * `pub enum` carrying a `#[wasm_bindgen]` attribute, under its `js_name` when one is given and under the
 * Rust identifier when one is not. A `#[wasm_bindgen] impl` block adds no export of its own — its
 * methods hang off the class the `pub struct` already declared — so it contributes nothing here.
 */
export function declaredWasmExports(rustSource) {
  const lines = rustSource.split("\n");
  const declared = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!MODULE_LEVEL_ATTRIBUTE.test(line)) continue;
    const renamed = JS_NAME.exec(line);
    for (let ahead = index + 1; ahead < lines.length; ahead += 1) {
      const candidate = lines[ahead];
      const item = EXPORTED_ITEM.exec(candidate);
      if (item) {
        declared.add(renamed ? renamed[1] : item[1]);
        break;
      }
      // Anything that is not another attribute, a comment, or a blank line is a different item (an
      // `impl` block, say) — the attribute exports nothing on its own.
      if (!INTERLEAVED.test(candidate)) break;
    }
  }
  return [...declared].toSorted(byCodePoint);
}

/** The union of the wasm-bindgen surface declared across a crate's Rust sources. */
export function crateWasmExports(crateDirectory) {
  const declared = new Set();
  for (const relative of collectSourceFiles(crateDirectory)) {
    if (path.extname(relative) !== ".rs") continue;
    for (const name of declaredWasmExports(
      readFileSync(path.join(crateDirectory, relative), "utf8"),
    )) {
      declared.add(name);
    }
  }
  return [...declared].toSorted(byCodePoint);
}

/**
 * The declared names that the generated bindings do NOT export — the direct evidence that an emitted
 * artefact predates the sources beside it. Non-empty means importing the package throws "is not a
 * function" at runtime for exactly these names.
 */
export function missingBindings(declared, generatedBindings) {
  return declared.filter(
    (name) =>
      !new RegExp(`^export\\s+(?:function|class|const|let)\\s+${name}\\b`, "m").test(
        generatedBindings,
      ),
  );
}

/**
 * The stamp written beside a built artefact: the hash of the sources it was built from and the export
 * surface that was verified present. Read back on the next run to decide staleness without consulting
 * a single mtime.
 */
export function readStamp(stampPath) {
  if (!existsSync(stampPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(stampPath, "utf8"));
    return typeof parsed?.sourceHash === "string" ? parsed : null;
  } catch {
    return null; // a truncated or hand-mangled stamp is no stamp at all — rebuild
  }
}

/** Whether a path exists and is a file (the emitted `.wasm`, the generated `.js`). */
export function isFile(target) {
  return existsSync(target) && statSync(target).isFile();
}
