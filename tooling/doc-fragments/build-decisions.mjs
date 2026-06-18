import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pad, parseAdrFile, serializeAdrFile } from "./adr-file.mjs";
import { assignNumbers } from "./assign.mjs";
import { planMigration } from "./migrate-decisions.mjs";
import { renderRegister, replaceRegister } from "./render-register.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DECISIONS_DIR = join(ROOT, "docs/decisions");
const PENDING_DIR = join(DECISIONS_DIR, "pending");
const LOG_PATH = join(ROOT, "docs/Decision-Log.md");
const ID_PREFIX = "ADR-";

function numberedFiles() {
  if (!existsSync(DECISIONS_DIR)) return [];
  return readdirSync(DECISIONS_DIR)
    .filter((name) => /^\d{4}-.+\.md$/.test(name))
    .map((name) => parseAdrFile(readFileSync(join(DECISIONS_DIR, name), "utf8")));
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
  const docsRoot = join(ROOT, "docs");
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, name.name);
      if (name.isDirectory()) walk(full);
      else if (name.name.endsWith(".md")) {
        const text = readFileSync(full, "utf8");
        const rewritten = text.replace(pattern, id);
        if (rewritten !== text) writeFileSync(full, rewritten);
      }
    }
  };
  walk(docsRoot);
}

function assemblePending() {
  if (!existsSync(PENDING_DIR)) return;
  const pendingNames = readdirSync(PENDING_DIR).filter((name) => name.endsWith(".md"));
  if (pendingNames.length === 0) return;
  const ordered = pendingNames
    .map((name) => ({ name, time: firstCommitTime(join(PENDING_DIR, name)) }))
    .sort((left, right) => left.time - right.time || left.name.localeCompare(right.name))
    .map((item) => item.name);
  const existing = numberedFiles().map((record) => record.number);
  const assigned = assignNumbers(
    existing,
    ordered.map((name) => name.replace(/\.md$/, "")),
  );
  for (const { slug, number } of assigned) {
    const record = parseAdrFile(readFileSync(join(PENDING_DIR, `${slug}.md`), "utf8"));
    record.number = number;
    record.slug = slug;
    writeFileSync(join(DECISIONS_DIR, `${pad(number)}-${slug}.md`), serializeAdrFile(record));
    rmSync(join(PENDING_DIR, `${slug}.md`));
    rewriteReferences(slug, number);
  }
}

function regenerateRegister() {
  const register = renderRegister(numberedFiles());
  writeFileSync(LOG_PATH, replaceRegister(readFileSync(LOG_PATH, "utf8"), register));
}

if (process.argv.includes("--migrate")) migrate();
assemblePending();
regenerateRegister();
console.log("decisions: register regenerated");
