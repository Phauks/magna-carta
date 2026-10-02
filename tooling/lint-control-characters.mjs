// Fitness function: no RAW CONTROL CHARACTER in tracked source. Write the escape instead.
//
// WHY THIS EXISTS. A raw NUL, form feed, or C0 byte sitting inside a string literal or a regular
// expression is INVISIBLE — in a file read, in `git diff`, in a review pane, in most editors. The
// source reads as one thing and means another, and the failure is not hypothetical: a `.join("\0")`
// written with the literal byte read as `.join("")` to two separate readers on the same day and
// produced a wrong diagnosis of a real defect. `"\0"` says exactly what the byte is, costs one
// character, and is the same value at runtime. There is no case where the raw byte is clearer.
//
// SCANS: the same code extensions as tooling/lint-process-references.mjs, whose shape this follows,
// PLUS Markdown — which that scan exempts and this one must not. A code sample in a document is read
// and copied, so an invisible byte in one travels into source; the rule was written with a raw escape
// character in its own prose on the first attempt, which is the argument. Data files (.txt wordlists,
// .json, fixtures) and binaries are not scanned — a control byte in a corpus is the corpus, not a
// legibility problem.
//
// PERMITTED RAW: tab (0x09), newline (0x0a), and carriage return (0x0d). Everything else in the C0
// range plus DEL (0x7f) must be written as an escape. C1 (0x80-0x9f) never appears raw in UTF-8 source
// as a control character — those bytes are continuation bytes of ordinary characters — so this scans
// decoded CODE POINTS rather than bytes, and reports the code point it found.
//
// AND U+FFFD, THE REPLACEMENT CHARACTER, which is not a control character and is banned raw for its
// own two reasons. It is what a decoder emits for bytes it could NOT read, so a literal one in source
// is indistinguishable from a file that was itself mangled in transit — the reader cannot tell a
// deliberate one from damage, which is the same legibility failure as an invisible byte arriving from
// the other direction. And one inside a u-flagged regular expression that is actually used hangs the
// linter outright: no error, no timeout, no file named. That cost this repository six days of an
// unrunnable gate of record in September 2026, diagnosed five times as a slow machine, because a check
// that never returns looks exactly like one that is merely slow. `\uFFFD` is the same character to
// every consumer and none of that is true of it.
//
// Escape hatch: a `control-characters:allow` comment ON THE SAME LINE, with a reason. Reach for it only
// where writing the escape would change what the line proves; converting is otherwise always available,
// including in a test whose whole subject is the control byte.
//
// Run: `pnpm run lint:control-characters`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SELF = fileURLToPath(import.meta.url);

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".svelte",
  ".rs",
  ".sql",
  ".yaml",
  ".yml",
  ".toml",
  ".md",
]);

const SKIP_DIRECTORIES = new Set([
  // .claude holds git worktrees (parallel-session checkouts) — scanning them double-counts and can
  // flag code that lives on another branch. The rest are not source.
  "node_modules",
  ".git",
  ".claude",
  "dist",
  "build",
  ".svelte-kit",
  ".wrangler",
  ".vite",
  "target",
  "coverage",
  ".playwright-mcp",
]);

const ALLOW_MARKER = /control-characters:allow\b[ \t]*(?:[-—:][ \t]*(?<reason>\S.*)?)?/;

// The escape a reader should have seen instead. Named for the ones with a conventional short form, and
// the numeric escape otherwise — which is what the fix instruction prints, so the message is the patch.
const NAMED_ESCAPES = new Map([
  [0x00, "\\0"],
  [0x08, "\\b"],
  [0x0b, "\\v"],
  [0x0c, "\\f"],
  [0x1b, "\\u001b"],
  // Upper case, because this one is read by people rather than only matched: \uFFFD is legible as the
  // replacement character at a glance, and \ufffd reads as an arbitrary code point.
  [0xfffd, "\\uFFFD"],
]);

export function escapeFor(codePoint) {
  return NAMED_ESCAPES.get(codePoint) ?? `\\u${codePoint.toString(16).padStart(4, "0")}`;
}

/** The replacement character: what a decoder emits for bytes it could not read. Never written raw. */
export const REPLACEMENT_CHARACTER = 0xfffd;

/**
 * Every offending code point in one file's text, as { line, column, codePoint, kind }. Pure over the
 * text so the fixture test drives it directly rather than through the filesystem.
 *
 * `kind` is "control" or "replacement" — they are reported together because the remedy is identical
 * (write the escape) but explained separately, because the reasons are not the same and a reader who
 * is told the wrong one will argue with it.
 */
export function controlCharactersIn(text) {
  const found = [];
  let line = 1;
  let column = 1;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (character === "\n") {
      line += 1;
      column = 1;
      continue;
    }
    // Tab and carriage return are the other two a source file legitimately holds raw.
    if (codePoint !== 0x09 && codePoint !== 0x0d && (codePoint < 0x20 || codePoint === 0x7f)) {
      found.push({ line, column, codePoint, kind: "control" });
    } else if (codePoint === REPLACEMENT_CHARACTER) {
      found.push({ line, column, codePoint, kind: "replacement" });
    }
    column += 1;
  }
  return found;
}

// The scan proves itself before it scans, the way tooling/lint-ledger-staleness does: a check that
// never fires is indistinguishable from a clean tree, and these bytes are invisible, so nobody would
// notice it had stopped. The fixtures are assembled with String.fromCodePoint rather than written as
// literals — a raw control character in this file would be exactly what it bans, and an escape here
// would still be an escape, so neither form proves the scan sees a real one.
const SELF_TEST = [
  { name: "a raw NUL", text: `join(${String.fromCodePoint(0x00)})`, expect: [0x00] },
  { name: "a raw DEL", text: String.fromCodePoint(0x7f), expect: [0x7f] },
  { name: "a raw escape byte", text: `\`${String.fromCodePoint(0x1b)}[0m\``, expect: [0x1b] },
  { name: "tab, newline and carriage return stay legal", text: "a\tb\r\nc", expect: [] },
  { name: "the escape form is not a finding", text: 'join("\\0")', expect: [] },
  { name: "ordinary multi-byte text is not a finding", text: "café — naïve ☂", expect: [] },
  {
    name: "a raw replacement character",
    text: `replace(/${String.fromCodePoint(0xfffd)}$/u, "")`,
    expect: [0xfffd],
  },
  { name: "its escape form is not a finding", text: 'replace(/\\uFFFD$/u, "")', expect: [] },
  {
    // The neighbours on either side, so a botched comparison that swallowed the whole range would be
    // caught rather than passing as a tightened rule.
    name: "the code points either side of it are ordinary text",
    text: `${String.fromCodePoint(0xfffc)}${String.fromCodePoint(0xfffe)}`,
    expect: [],
  },
];

function runSelfTest() {
  const failures = [];
  for (const { name, text, expect } of SELF_TEST) {
    const found = controlCharactersIn(text).map((finding) => finding.codePoint);
    if (JSON.stringify(found) !== JSON.stringify(expect)) failures.push({ name, found, expect });
  }
  return failures;
}

function walk(directory, files) {
  for (const name of readdirSync(directory)) {
    const full = join(directory, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRECTORIES.has(name)) walk(full, files);
      continue;
    }
    files.push(full);
  }
}

function main() {
  const selfTestFailures = runSelfTest();
  if (selfTestFailures.length > 0) {
    console.error("\nlint-control-characters: the scan no longer sees what it must.\n");
    for (const failure of selfTestFailures) {
      console.error(
        `  ${failure.name}\n` +
          `    expected: ${JSON.stringify(failure.expect)}\n` +
          `    got:      ${JSON.stringify(failure.found)}`,
      );
    }
    process.exit(1);
  }

  const files = [];
  walk(ROOT, files);

  const offenders = [];
  const emptyAllowances = [];
  for (const file of files) {
    if (file === SELF) continue;
    const name = basename(file);
    const extension = name.slice(name.lastIndexOf("."));
    if (!CODE_EXTENSIONS.has(extension)) continue;

    const text = readFileSync(file, "utf8");
    const findings = controlCharactersIn(text);
    if (findings.length === 0) continue;

    const lines = text.split("\n");
    const relativePath = relative(ROOT, file).split(sep).join("/");
    for (const finding of findings) {
      const source = lines[finding.line - 1] ?? "";
      const allowance = ALLOW_MARKER.exec(source);
      if (allowance !== null) {
        if ((allowance.groups?.reason ?? "").trim() === "") {
          emptyAllowances.push(`  ${relativePath}:${finding.line}  ${source.trim()}`);
        }
        continue;
      }
      offenders.push({
        kind: finding.kind,
        line:
          `  ${relativePath}:${finding.line}:${finding.column}` +
          `  U+${finding.codePoint.toString(16).toUpperCase().padStart(4, "0")}` +
          `  write it as "${escapeFor(finding.codePoint)}"`,
      });
    }
  }

  if (emptyAllowances.length > 0) {
    console.error(
      "\nA bare `control-characters:allow` with no reason excuses nothing — say why the escape" +
        " would change what this line means, or write the escape.\n",
    );
    console.error(emptyAllowances.join("\n"));
  }
  // Reported apart because the remedy is shared and the reasoning is not, and a reader handed the
  // wrong reason for their finding will argue with the rule instead of fixing the line.
  const control = offenders.filter((finding) => finding.kind === "control");
  const replacement = offenders.filter((finding) => finding.kind === "replacement");

  if (control.length > 0) {
    console.error("\nRaw control characters in source — invisible in reads, diffs, and reviews.\n");
    console.error(
      "Write the escape instead: it is the same value at runtime and says what the byte is.\n",
    );
    console.error(control.map((finding) => finding.line).join("\n"));
    console.error(`\n${control.length} raw control character(s) found in code.`);
  }
  if (replacement.length > 0) {
    console.error(
      "\nA raw U+FFFD in source — the character a decoder emits for bytes it could NOT read.\n",
    );
    console.error(
      "Write it as \\uFFFD. Raw, a reader cannot tell a deliberate one from a mangled file, and one\n" +
        "inside a u-flagged regular expression that is used hangs the linter with no error and no file\n" +
        "named — which took six days to find the last time it happened.\n",
    );
    console.error(replacement.map((finding) => finding.line).join("\n"));
    console.error(`\n${replacement.length} raw replacement character(s) found in code.`);
  }
  if (offenders.length > 0 || emptyAllowances.length > 0) process.exit(1);
  console.log("No raw control or replacement characters in code.");
}

if (process.argv[1] === SELF) main();
