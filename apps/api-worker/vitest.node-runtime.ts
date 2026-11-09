// Which api-worker test files run in plain Node rather than inside the Workers runtime.
//
// A file opts in by carrying the directive `// @node-runtime` among its leading comment lines. The
// file declares its own runtime, so no list elsewhere can drift from it, and the same directive
// shape as `@repo-wide-fitness` (tooling/check-scoped/repo-wide.mjs).
//
// Why it is worth opting in: every file in the Workers project boots a workerd VM and preloads the
// whole app graph before its first test (test/support/settle-background-work.ts explains why that
// preload exists), measured at about 25 s of setup per file and most of the suite's memory. A file
// that tests pure logic, route tables or contract shapes needs none of it.
//
// Only opt a file in when it passes under Node. The runtimes differ in ways a test would otherwise
// assert on: `crypto.subtle.timingSafeEqual`, `DigestStream`, WebAssembly module imports and the
// `cloudflare:*` modules exist only in workerd, and code that reaches them fails under Node.
import * as fs from "node:fs";
import * as path from "node:path";

const PACKAGE_ROOT = import.meta.dirname;
const TEST_DIRECTORY = path.join(PACKAGE_ROOT, "test");
const DIRECTIVE = /^\/\/\s*@node-runtime\b/;
const WORKERS_ONLY_IMPORT = /from\s+["']cloudflare:/;

function leadingCommentLines(source: string): string[] {
  const lines: string[] = [];
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("//")) lines.push(trimmed);
    else break;
  }
  return lines;
}

function testFilesUnder(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...testFilesUnder(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".test.ts")) files.push(fullPath);
  }
  return files;
}

/**
 * The opted-in test files, as paths relative to the package root with forward slashes — the form
 * Vitest's `include` and `exclude` match against. Throws when an opted-in file imports a
 * `cloudflare:*` module, because that file cannot run under Node and would fail for a reason its
 * directive hides.
 */
export function nodeRuntimeTestFiles(): string[] {
  const optedIn: string[] = [];
  for (const file of testFilesUnder(TEST_DIRECTORY)) {
    const source = fs.readFileSync(file, "utf8");
    if (!leadingCommentLines(source).some((line) => DIRECTIVE.test(line))) continue;
    const relative = path.relative(PACKAGE_ROOT, file).split(path.sep).join("/");
    if (WORKERS_ONLY_IMPORT.test(source)) {
      throw new Error(
        `${relative} declares @node-runtime but imports a cloudflare:* module, which exists only ` +
          "in the Workers runtime. Remove the directive or the import.",
      );
    }
    optedIn.push(relative);
  }
  return optedIn.toSorted();
}
