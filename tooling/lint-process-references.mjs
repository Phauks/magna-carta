// Golden rule 13 gate: code (source, tests, config) must not cite process artifacts. The reasoning
// belongs inline; a decision's durable home is docs/Decision-Log.md or its spec, never the source.
// Run locally with `pnpm run lint:process-refs`; CI runs it as a contract gate.
//
// SCANS: .ts/.tsx/.mts/.cts/.js/.mjs/.cjs/.svelte/.rs/.sql/.yaml/.yml/.toml under the repo.
// EXEMPT: docs/** and every *.md (documentation may cite ADRs/specs — that is their job),
//         generated code (*.gen.ts, *.generated.ts, and the OpenAPI snapshot), citations of
//         EXTERNAL published standards (MS-*, RFC, ISO, ECMA, W3C, Unicode) and legal statutes —
//         which rule 13 explicitly permits ("point to a living standard") — node_modules / build
//         output, and this file (it necessarily names the patterns it bans).
//
// SCOPE NOTE: this gate hard-bans the unambiguous process-doc citations that recurred across the
// codebase (ADR numbers dominated). Forward-looking "slice 0·6 swaps in …" / "Phase 3 adds …"
// replacement notes are ALLOWED by rule 13 and deliberately NOT scanned here — distinguishing them
// from backward labels mechanically is unreliable, so they are governed by code review instead.
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
]);
const SKIP_DIRECTORIES = new Set([
  // .claude holds git worktrees (parallel-session checkouts) — scanning them double-counts and
  // can flag code that lives on another branch. .git/dist/build/etc. are not source.
  "node_modules",
  ".git",
  ".claude",
  "dist",
  "build",
  ".svelte-kit",
  ".wrangler",
  ".vite",
  "docs",
  // Tool-output scratch dirs (Playwright MCP page snapshots scrape legal text where "§" is a real
  // statutory citation, not a process-doc reference).
  ".playwright-mcp",
  // Throwaway de-risking harnesses — exploration code deleted after it yields its measurements, where
  // "spike" is the literal name of the artifact, not a citation of one. Golden rule 13 governs shipped
  // source/tests/config.
  "spikes",
  // The kept CSP probe (re-run on bits-ui/svelte upgrades): "spike" is this directory's own name,
  // and its files necessarily say what they are and how to re-run them.
  "csp-spike",
]);

// Each pattern flags a process-artifact citation that has no legitimate form in code.
const BANNED = [
  { label: "ADR citation", pattern: /\bADR-\d{2,}/ },
  { label: "design-spec citation", pattern: /\bdesign spec\b/i },
  { label: "implementation-plan citation", pattern: /\bimplementation plan\b/i },
  { label: "spec-section citation", pattern: /\bspec §|§\s?\d/ },
  { label: "numbered-decision citation", pattern: /\bdecided (?:up front )?#\d/i },
  { label: "white-paper citation", pattern: /\bwhite[ -]paper\b/i },
  // (?<!-) lets hyphenated artifact names pass: "test/csp-spike/…" is a concrete file path —
  // exactly what rule 13 says to point at — while prose like "the spike showed" stays banned.
  { label: "spike citation", pattern: /(?<!-)\bspike\b/i },
];

// A "§N" that cites an EXTERNAL published standard or a legal statute is a legitimate reference,
// not an internal process-doc citation — rule 13 explicitly allows pointing to a living standard.
// Only the "spec-section citation" pattern is this ambiguous; the others (ADR, white-paper, …) are
// unambiguously internal, so this exemption applies to that label alone.
const EXTERNAL_STANDARD =
  /\b(MS-[A-Z0-9]+|RFC\s?\d|ISO[\s/]?\d|IEC\s?\d|ECMA-?\d|W3C|Unicode|ANSI|NIST|U\.S\.C\.|C\.F\.R\.|Stat\.|(?:Code|Law|Rule|Rev\.?\s?Stat\.?|Gen\.?\s?Stat\.?|Prof\.?\s?Conduct)\b[^§\n]*)\s?§/i;

const files = [];
function walk(directory) {
  for (const name of readdirSync(directory)) {
    const full = join(directory, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRECTORIES.has(name)) walk(full);
      continue;
    }
    files.push(full);
  }
}
walk(ROOT);

const offenders = [];
for (const file of files) {
  if (file === SELF) continue;
  const name = basename(file);
  if (name.endsWith(".gen.ts") || name.endsWith(".generated.ts") || name.endsWith(".md")) continue;
  const extension = name.slice(name.lastIndexOf("."));
  if (!CODE_EXTENSIONS.has(extension)) continue;

  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const relativePath = relative(ROOT, file).split(sep).join("/");
  lines.forEach((line, index) => {
    for (const { label, pattern } of BANNED) {
      if (!pattern.test(line)) continue;
      // A spec-section "§N" that names an external standard/statute is a legitimate citation.
      if (label === "spec-section citation" && EXTERNAL_STANDARD.test(line)) continue;
      offenders.push(`  ${relativePath}:${index + 1}  [${label}]  ${line.trim()}`);
    }
  });
}

if (offenders.length > 0) {
  console.error(
    "\nGolden rule 13 — code must not cite process artifacts (ADRs, specs, plans, spikes, white-paper sections).",
  );
  console.error(
    "Explain the reasoning inline, or point to a file by path. Decisions live in docs/Decision-Log.md.",
  );
  console.error(
    'Forward-looking "slice N / Phase N swaps in / replaces / adds …" notes are allowed.\n',
  );
  console.error(offenders.join("\n"));
  console.error(`\n${offenders.length} process-artifact reference(s) found in code.`);
  process.exit(1);
}
console.log("No process-artifact references in code (golden rule 13).");
