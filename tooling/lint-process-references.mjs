// Golden rule 13 gate: code (source, tests, config) must not cite process artifacts. The reasoning
// belongs inline; a decision's durable home is docs/Decision-Log.md or its spec, never the source.
// Run locally with `pnpm run lint:process-refs`; CI runs it as a contract gate.
//
// SCANS: .ts/.tsx/.mts/.cts/.js/.mjs/.cjs/.svelte/.rs/.sql/.yaml/.yml/.toml under the repo.
// EXEMPT: docs/** and every *.md (documentation may cite ADRs/specs — that is their job),
//         *.gen.ts and the OpenAPI snapshot (generated), node_modules / build output, and this
//         file (it necessarily names the patterns it bans).
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
  // Only a section citation OF ONE OF OUR PROCESS DOCS is banned — the rule exists because our specs and
  // the white paper renumber, so a "§N" pointing at them rots. A bare "§N" is not evidence of that: in a
  // legal platform it is usually a statute or court rule ("Judiciary Law §499"), and in an engine it is
  // usually an external standard ("MS-OFFCRYPTO §2.3.4.13") — both are stable, real citations of the kind
  // the rule asks for, not process-doc references. So match the section symbol only when a process-doc
  // noun introduces it, never on its own.
  {
    label: "spec-section citation",
    pattern: /\b(?:spec|specification|white[ -]paper|design doc)\s*§\s?\d/i,
  },
  { label: "numbered-decision citation", pattern: /\bdecided (?:up front )?#\d/i },
  { label: "white-paper citation", pattern: /\bwhite[ -]paper\b/i },
  // (?<!-) lets hyphenated artifact names pass: "test/csp-spike/…" is a concrete file path —
  // exactly what rule 13 says to point at — while prose like "the spike showed" stays banned.
  { label: "spike citation", pattern: /(?<!-)\bspike\b/i },
];

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
  if (name.endsWith(".gen.ts") || name.endsWith(".md")) continue;
  const extension = name.slice(name.lastIndexOf("."));
  if (!CODE_EXTENSIONS.has(extension)) continue;

  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const relativePath = relative(ROOT, file).split(sep).join("/");
  lines.forEach((line, index) => {
    for (const { label, pattern } of BANNED) {
      if (pattern.test(line)) {
        offenders.push(`  ${relativePath}:${index + 1}  [${label}]  ${line.trim()}`);
      }
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
