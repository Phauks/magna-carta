import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseFragment,
  renderIndex,
  renderStatus,
  validateFragments,
} from "./doc-fragments/status.mjs";

// Fitness function for the status.d/* fragments (mirrors lint-process-references.mjs). Fails CI when a
// fragment is malformed, two claim the same (group, order) slot, or a declared link points nowhere —
// so STATUS.md / STATUS.json can never drift into a broken build. Run: `pnpm run lint:status`.
//
// AND THE DRIFT GATE, which is the half that catches a real slice reading as the wrong stage. Valid
// fragments are not the same claim as a current render: the assembler runs on main after a merge, so
// a branch that lands a fragment change without it leaves STATUS.md stating the stage the slice was
// at BEFORE the work, indefinitely and with nothing complaining. That is how the reports slice sat at
// `built: todo` in the rendered table while its own fragment said the build was under way. So this
// re-derives both outputs from the fragments and diffs them against what is committed, exactly as
// lint-roadmap.mjs does for docs/now.md — the same reasoning, over the other generated tracker.

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

// Only meaningful once every fragment parsed and the set validated — a partial set renders a shorter
// document, which would be reported as drift rather than as the parse failure it is.
if (errors.length === 0) {
  const sections = readFileSync(join(FRAGMENT_DIR, "_sections.md"), "utf8");
  for (const [path, rendered] of [
    ["STATUS.md", renderStatus(sections, fragments)],
    ["STATUS.json", renderIndex(fragments)],
  ]) {
    const absolute = join(ROOT, path);
    const onDisk = existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
    if (onDisk === rendered) continue;
    errors.push(
      onDisk === null
        ? `  ${path} is missing — it is assembled from status.d/, never written by hand; run \`vp run status-build\``
        : `  ${path} does not match a fresh render of status.d/ — a fragment moved without the assembler running; run \`vp run status-build\` and commit the result`,
    );
  }
}

if (errors.length > 0) {
  console.error("\nStatus fragments (status.d/*) failed validation:\n");
  console.error(errors.join("\n"));
  console.error(
    `\n${errors.length} problem(s). Each line names its own remedy: fix the fragment, or run \`vp run status-build\` and commit what it renders.`,
  );
  process.exit(1);
}
console.log(`Status fragments valid (${fragments.length} slice(s)).`);
