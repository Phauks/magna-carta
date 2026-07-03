import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFragment, validateFragments } from "./doc-fragments/status.mjs";

// Fitness function for the status.d/* fragments (mirrors lint-process-references.mjs). Fails CI when a
// fragment is malformed, two claim the same (group, order) slot, or a declared link points nowhere —
// so STATUS.md / STATUS.json can never drift into a broken build. Run: `pnpm run lint:status`.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FRAGMENT_DIR = join(ROOT, "status.d");
const RESERVED = new Set(["_sections.md", "README.md"]);

const errors = [];
const fragments = [];

for (const name of readdirSync(FRAGMENT_DIR).filter((n) => n.endsWith(".md") && !RESERVED.has(n))) {
  let fragment;
  try {
    fragment = parseFragment(readFileSync(join(FRAGMENT_DIR, name), "utf8"), name);
  } catch (error) {
    errors.push(`  status.d/${name}  ${error.message}`);
    continue;
  }
  fragments.push(fragment);
  for (const [field, path] of [
    ["link-spec", fragment.links.spec],
    ["link-plan", fragment.links.plan],
    ["active-work", fragment.activeWork],
  ]) {
    if (path && !existsSync(join(ROOT, path))) {
      errors.push(`  status.d/${name}  ${field} points at a missing file: ${path}`);
    }
  }
}

try {
  validateFragments(fragments);
} catch (error) {
  errors.push(`  ${error.message}`);
}

if (errors.length > 0) {
  console.error("\nStatus fragments (status.d/*) failed validation:\n");
  console.error(errors.join("\n"));
  console.error(
    `\n${errors.length} problem(s). Fix the fragment(s) and re-run \`vp run status-build\`.`,
  );
  process.exit(1);
}
console.log(`Status fragments valid (${fragments.length} slice(s)).`);
