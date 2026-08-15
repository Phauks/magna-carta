import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build as buildHistory } from "./build-register-history.mjs";
import { parseArea, renderBuildRegister } from "./roadmap.mjs";

// Regenerate docs/now.md — the complete build register — from the roadmap.d/* feature ledger.
// Persistent, NOT consume-once: a capability's status keeps moving, so nodes live on and the
// document is re-rendered whole from the current ledger every run (same shape as build-status.mjs;
// contrast build-changelog.mjs, which deletes fragments).
//
// Run on main after a merge, next to `vp run changelog-build` / `vp run status-build`. The output is
// a byte-exact function of the ledger and tooling/lint-roadmap.mjs fails the gate when the file on
// disk differs from a fresh render — which is what makes the register unable to drift.
//
// The ledger's other rendering, renderPublicRoadmap, is deliberately not written here: it is written
// for people using the product and there are none yet, so it has no audience to be accurate for.
// Everything behind it is kept ready — see the comment at the top of roadmap.mjs.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LEDGER_DIR = join(ROOT, "roadmap.d");
const REGISTER = join(ROOT, "docs", "now.md");

const RESERVED = new Set(["README.md"]);

export function loadAreas(dir = LEDGER_DIR) {
  // Sorted, so the rendered order is the directory's order and never the filesystem's.
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(".md") && !RESERVED.has(name))
    .toSorted();
  return names.map((name) => parseArea(readFileSync(join(dir, name), "utf8"), name));
}

export function render(areas, history = null) {
  return { register: renderBuildRegister(areas, history) };
}

export function build(argv = []) {
  if (!existsSync(LEDGER_DIR)) throw new Error("roadmap.d/ not found");
  const areas = loadAreas();
  // The "where we have been" series first, so this run's own commit is in the document it renders.
  // Cheap by construction: it reads only the commits its file does not already hold, normally none
  // or one. Pass --rebuild-history to recompute the whole series — what to run after a change to the
  // ledger parser, since a commit that used to be unreadable may have become readable.
  const history = buildHistory(argv.includes("--rebuild-history") ? ["--rebuild"] : []);
  const { register } = render(areas, history);
  writeFileSync(REGISTER, register);
  const nodes = areas.reduce((total, area) => total + area.nodes.length, 0);
  console.log(`roadmap: rendered docs/now.md from ${nodes} node(s) across ${areas.length} area(s)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  build(process.argv.slice(2));
}
