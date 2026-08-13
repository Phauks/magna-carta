import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArea, renderNow, renderPublicRoadmap } from "./roadmap.mjs";

// Regenerate docs/public-roadmap.md + docs/now.md from the roadmap.d/* feature ledger. Persistent,
// NOT consume-once: a capability's status keeps moving, so nodes live on and both documents are
// re-rendered whole from the current ledger every run (same shape as build-status.mjs; contrast
// build-changelog.mjs, which deletes fragments).
//
// Run on main after a merge, next to `vp run changelog-build` / `vp run status-build`. Both outputs
// are byte-exact functions of the ledger and tooling/lint-roadmap.mjs fails the gate when either
// file on disk differs from a fresh render — which is what makes the public view unable to drift.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LEDGER_DIR = join(ROOT, "roadmap.d");
const PUBLIC_ROADMAP = join(ROOT, "docs", "public-roadmap.md");
const NOW = join(ROOT, "docs", "now.md");

const RESERVED = new Set(["README.md"]);

export function loadAreas(dir = LEDGER_DIR) {
  // Sorted, so the rendered order is the directory's order and never the filesystem's.
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(".md") && !RESERVED.has(name))
    .toSorted();
  return names.map((name) => parseArea(readFileSync(join(dir, name), "utf8"), name));
}

export function render(areas) {
  return { publicRoadmap: renderPublicRoadmap(areas), now: renderNow(areas) };
}

export function build() {
  if (!existsSync(LEDGER_DIR)) throw new Error("roadmap.d/ not found");
  const areas = loadAreas();
  const { publicRoadmap, now } = render(areas);
  writeFileSync(PUBLIC_ROADMAP, publicRoadmap);
  writeFileSync(NOW, now);
  const nodes = areas.reduce((total, area) => total + area.nodes.length, 0);
  console.log(
    `roadmap: rendered docs/public-roadmap.md + docs/now.md from ${nodes} node(s) across ${areas.length} area(s)`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  build();
}
