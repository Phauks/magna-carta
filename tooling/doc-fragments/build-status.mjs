import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseFragment, renderIndex, renderStatus } from "./status.mjs";

// Regenerate STATUS.md + STATUS.json from status.d/* fragments. Persistent, NOT consume-once: a
// slice's status keeps moving across the pipeline, so fragments live on and the whole file is
// re-rendered from the current set every run (contrast build-changelog.mjs, which deletes fragments).
// Run on main after a merge, next to `vp run changelog-build` / `vp run decisions-build`.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FRAGMENT_DIR = join(ROOT, "status.d");
const SECTIONS = join(FRAGMENT_DIR, "_sections.md");
const STATUS_MD = join(ROOT, "STATUS.md");
const STATUS_JSON = join(ROOT, "STATUS.json");

const RESERVED = new Set(["_sections.md", "README.md"]);

export function loadFragments(dir = FRAGMENT_DIR) {
  const names = readdirSync(dir).filter((name) => name.endsWith(".md") && !RESERVED.has(name));
  return names.map((name) => parseFragment(readFileSync(join(dir, name), "utf8"), name));
}

export function build() {
  if (!existsSync(FRAGMENT_DIR)) throw new Error("status.d/ not found");
  const sections = readFileSync(SECTIONS, "utf8");
  const fragments = loadFragments();
  writeFileSync(STATUS_MD, renderStatus(sections, fragments));
  writeFileSync(STATUS_JSON, renderIndex(fragments));
  console.log(`status: rendered STATUS.md + STATUS.json from ${fragments.length} fragment(s)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  build();
}
