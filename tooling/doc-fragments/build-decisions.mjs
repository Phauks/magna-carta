import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertValidAdrRecord,
  collectAdrRecords,
  pad,
  parseAdrFile,
  serializeAdrFile,
} from "./adr-file.mjs";
import { assignNumbers } from "./assign.mjs";
import { planMigration } from "./migrate-decisions.mjs";
import { renderRegister, replaceRegister } from "./render-register.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DECISIONS_DIR = join(ROOT, "docs/decisions");
const PENDING_DIR = join(DECISIONS_DIR, "pending");
const LOG_PATH = join(ROOT, "docs/Decision-Log.md");
const ID_PREFIX = "ADR-";

// Every numbered file is read through the same validation as a pending fragment. They are generated
// output, but a corrupt one renders a corrupt register bullet forever, and the register is the only
// place most readers ever look — so the assembly stops rather than re-emitting the damage.
function numberedFiles() {
  if (!existsSync(DECISIONS_DIR)) return [];
  return readdirSync(DECISIONS_DIR)
    .filter((name) => /^\d{4}-.+\.md$/.test(name))
    .map((name) => {
      const context = `docs/decisions/${name}`;
      const record = parseAdrFile(readFileSync(join(DECISIONS_DIR, name), "utf8"), context);
      return assertValidAdrRecord(record, context);
    });
}

function firstCommitTime(path) {
  try {
    const out = execFileSync("git", ["log", "--diff-filter=A", "--format=%ct", "--", path], {
      cwd: ROOT,
    });
    const stamps = out.toString().trim().split("\n").filter(Boolean);
    return stamps.length === 0
      ? Number.MAX_SAFE_INTEGER
      : Number.parseInt(stamps[stamps.length - 1], 10);
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function migrate() {
  mkdirSync(DECISIONS_DIR, { recursive: true });
  for (const record of planMigration(readFileSync(LOG_PATH, "utf8"))) {
    writeFileSync(join(ROOT, record.path), serializeAdrFile(record));
  }
}

function rewriteReferences(slug, number) {
  const id = `${ID_PREFIX}${pad(number)}`;
  const token = `${ID_PREFIX}${slug}`;
  // Match the token only when not followed by another identifier character, so a slug that is a
  // prefix of a longer one (ADR-foo must not rewrite the ADR-foo in ADR-foo-bar) is left intact.
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}(?![A-Za-z0-9-])`, "g");
  // A LINK to the pending file is a reference too: a spec that pointed at
  // `docs/decisions/pending/<slug>.md` points at nothing once the file is numbered, and
  // lint:doc-links refuses the spec for a move it did not make. Repointed at the numbered file,
  // whatever directory the link was written from.
  const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const linkPattern = new RegExp(`decisions/pending/${escapedSlug}\\.md`, "g");
  const numberedLink = `decisions/${pad(number)}-${slug}.md`;
  const docsRoot = join(ROOT, "docs");
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, name.name);
      if (name.isDirectory()) walk(full);
      else if (name.name.endsWith(".md")) {
        const text = readFileSync(full, "utf8");
        const rewritten = text.replace(pattern, id).replace(linkPattern, numberedLink);
        if (rewritten !== text) writeFileSync(full, rewritten);
      }
    }
  };
  walk(docsRoot);
}

// A pending decision is written in docs/decisions/pending/ and its links are written from there:
// `../../specs/x` reaches the specs, and a bare `<slug>.md` reaches a sibling still pending. The
// numbered file lives one directory up, so every relative link climbs one level fewer, and a link
// to a sibling that is numbered in the same pass (or was numbered before) is repointed at that
// sibling's numbered file; one to a sibling that stays pending keeps reaching into pending/.
// Absolute links and anchors are left alone.
export function rebasePendingLinks(text, numberedBySlug) {
  return text.replace(/\]\((?!https?:|mailto:|#)([^)\s]+)\)/g, (match, target) => {
    if (target.startsWith("../")) return `](${target.slice(3)})`;
    const sibling = /^([A-Za-z0-9-]+)\.md(#.*)?$/.exec(target);
    if (sibling === null) return match;
    const [, siblingSlug, anchor = ""] = sibling;
    const number = numberedBySlug.get(siblingSlug);
    return number === undefined
      ? `](pending/${siblingSlug}.md${anchor})`
      : `](${pad(number)}-${siblingSlug}.md${anchor})`;
  });
}

function trackedPendingNames() {
  const out = execFileSync("git", ["ls-files", "--", "docs/decisions/pending"], { cwd: ROOT });
  return new Set(
    out
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((path) => path.split("/").pop()),
  );
}

// A decision is only real once it is committed on the branch being merged. Numbering reads from
// git's tracked set, not the raw directory, so an untracked fragment that another worktree left in
// this tree is never swept into this merge's numbering. The documented workflow commits the fragment
// on its branch before merge, so a legitimate one is always tracked by build time; anything left
// untracked is announced (never silently dropped) so a forgotten `git add` is visible.
export function partitionPending(presentNames, trackedNames) {
  const number = presentNames.filter((name) => trackedNames.has(name));
  const skipped = presentNames.filter((name) => !trackedNames.has(name));
  return { number, skipped };
}

// Read and validate the whole pending set BEFORE anything is numbered, renamed, or deleted. A
// fragment is consumed by folding it, so a failure discovered halfway through would leave the
// branch half-assembled; validating first makes a malformed fragment a clean, loud no-op.
function readPendingRecords(names) {
  const { records, problems } = collectAdrRecords(
    names.map((name) => ({
      key: name,
      context: `docs/decisions/pending/${name}`,
      markdown: readFileSync(join(PENDING_DIR, name), "utf8"),
    })),
  );
  if (problems.length > 0) {
    throw new Error(
      `decisions: ${problems.length} pending fragment(s) are malformed and none were numbered.\n\n${problems.join("\n")}\n\nFix the fragment(s) and re-run. Format: docs/decisions/README.md. Check them anytime with \`pnpm run lint:decisions\`.`,
    );
  }
  return records;
}

function assemblePending() {
  if (!existsSync(PENDING_DIR)) return;
  const present = readdirSync(PENDING_DIR).filter((name) => name.endsWith(".md"));
  const { number: pendingNames, skipped } = partitionPending(present, trackedPendingNames());
  if (skipped.length > 0) {
    console.log(
      `decisions: skipped ${skipped.length} untracked pending fragment(s) — git add to number: ${skipped.join(", ")}`,
    );
  }
  if (pendingNames.length === 0) return;
  const records = readPendingRecords(pendingNames);
  const ordered = pendingNames
    .map((name) => ({ name, time: firstCommitTime(join(PENDING_DIR, name)) }))
    .sort((left, right) => left.time - right.time || left.name.localeCompare(right.name))
    .map((item) => item.name);
  const existing = numberedFiles().map((record) => record.number);
  const assigned = assignNumbers(
    existing,
    ordered.map((name) => name.replace(/\.md$/, "")),
  );
  // Every number this pass assigns, with every number already assigned, so a pending decision's
  // link to a sibling resolves whichever of the two the sibling is.
  const numberedBySlug = new Map(numberedFiles().map((record) => [record.slug, record.number]));
  for (const { slug, number } of assigned) numberedBySlug.set(slug, number);
  for (const { slug, number } of assigned) {
    const record = records.get(`${slug}.md`);
    record.number = number;
    record.slug = slug;
    record.body = rebasePendingLinks(record.body, numberedBySlug);
    writeFileSync(join(DECISIONS_DIR, `${pad(number)}-${slug}.md`), serializeAdrFile(record));
    rmSync(join(PENDING_DIR, `${slug}.md`));
    rewriteReferences(slug, number);
  }
}

function regenerateRegister() {
  const register = renderRegister(numberedFiles());
  writeFileSync(LOG_PATH, replaceRegister(readFileSync(LOG_PATH, "utf8"), register));
}

// Run the side effects only when invoked as a script — importing this module (e.g. from a test for
// partitionPending) must not rewrite the real register.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.includes("--migrate")) migrate();
    assemblePending();
    regenerateRegister();
  } catch (error) {
    // A malformed decision file must stop the assembly with a readable reason, not a stack trace
    // over a half-written register.
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
  console.log("decisions: register regenerated");
}
