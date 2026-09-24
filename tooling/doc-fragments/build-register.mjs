import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build as buildHistory } from "./build-register-history.mjs";
import { renderDecisionDesk } from "./decision-desk.mjs";
import { renderBuildRegisterArtifact } from "./register-artifact.mjs";
import { registerRenderRefusal } from "./register-renderers.mjs";
import { parseArea, renderBuildRegister } from "./roadmap.mjs";

// Regenerate docs/now.md, docs/now.html and docs/decisions-open.html — the complete build register
// as a document and as a page, and the decision desk — from the roadmap.d/* feature ledger.
// Persistent, NOT consume-once: a capability's status keeps moving, so nodes live on and the
// document is re-rendered whole from the current ledger every run (same shape as build-status.mjs;
// contrast build-changelog.mjs, which deletes fragments).
//
// Run on main after a merge, next to `vp run changelog-build` / `vp run status-build` — and ONLY
// there, or on the assembly and docs-sync branches that render for main. On a feature branch it
// refuses to write (pass --preview to look at the render anyway, and do not commit it): the
// rendered files are what every two node-flipping branches used to conflict on, and a branch's
// change is its edit to the ledger alone. The output is a byte-exact function of the ledger and
// tooling/lint-roadmap.mjs fails the gate when the file on disk differs from a fresh render where it
// is rendered, and when a branch carries a change to it where it is not.
//
// THREE OUTPUTS, ONE RUN (the same shape as build-status.mjs, which writes STATUS.md +
// STATUS.json). docs/now.html is the same register as a self-contained web page, for the reader who
// reads it as a page rather than as a file in a repository; docs/decisions-open.html is the same
// ledger's `awaiting-owner` questions, gathered with somewhere to answer them. They are written here
// rather than by two more commands on purpose: a register whose renderings are refreshed by
// different commands is a register whose renderings disagree the first time somebody runs one of
// them. Both renderers are pure — tooling/doc-fragments/register-artifact.mjs and
// tooling/doc-fragments/decision-desk.mjs — and take the same `areas` the Markdown takes.
//
// The ledger's other rendering, renderPublicRoadmap, is deliberately not written here: it is written
// for people using the product and there are none yet, so it has no audience to be accurate for.
// Everything behind it is kept ready — see the comment at the top of roadmap.mjs.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LEDGER_DIR = join(ROOT, "roadmap.d");
const REGISTER = join(ROOT, "docs", "now.md");
const REGISTER_PAGE = join(ROOT, "docs", "now.html");
const DECISION_DESK = join(ROOT, "docs", "decisions-open.html");

const RESERVED = new Set(["README.md"]);

export function loadAreas(dir = LEDGER_DIR) {
  // Sorted, so the rendered order is the directory's order and never the filesystem's.
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(".md") && !RESERVED.has(name))
    .toSorted();
  return names.map((name) => parseArea(readFileSync(join(dir, name), "utf8"), name));
}

export function render(areas, history = null) {
  return {
    register: renderBuildRegister(areas, history),
    // The page takes no history: the reconstructed series is a Markdown-shaped answer (tables of
    // commits) and the page is the "where does everything stand right now" instrument. Leaving it
    // out is what keeps the page a pure function of the ledger alone.
    page: renderBuildRegisterArtifact(areas),
    // The third rendering of the same ledger, for the reader who has come to answer rather than to
    // read. Built by this command rather than its own for the reason the page is: a question that is
    // open in one rendering and settled in another is a question nobody can trust either copy of.
    desk: renderDecisionDesk(areas),
  };
}

export function build(argv = []) {
  if (!existsSync(LEDGER_DIR)) throw new Error("roadmap.d/ not found");
  const refusal = argv.includes("--preview") ? null : registerRenderRefusal(ROOT);
  if (refusal !== null) {
    console.log(
      `roadmap: not rendered — ${refusal}. Commit the roadmap.d/ edit; pass --preview to see the render without committing it.`,
    );
    return;
  }
  const areas = loadAreas();
  // The "where we have been" series first, so this run's own commit is in the document it renders.
  // Cheap by construction: it reads only the commits its file does not already hold, normally none
  // or one. Pass --rebuild-history to recompute the whole series — what to run after a change to the
  // ledger parser, since a commit that used to be unreadable may have become readable.
  // `--ref=` is forwarded rather than swallowed so a caller can name the trunk explicitly. CI is the
  // caller that needs it: the reconstruction refuses to walk anything but the trunk, and it decides
  // that from the ref's NAME, so a checkout that leaves HEAD detached would make every scheduled run
  // decline — and decline quietly, which is how the series sat frozen for a week.
  const history = buildHistory([
    ...(argv.includes("--rebuild-history") ? ["--rebuild"] : []),
    ...argv.filter((argument) => argument.startsWith("--ref=")),
  ]);
  const { register, page, desk } = render(areas, history);
  writeFileSync(REGISTER, register);
  writeFileSync(REGISTER_PAGE, page);
  writeFileSync(DECISION_DESK, desk);
  const nodes = areas.reduce((total, area) => total + area.nodes.length, 0);
  console.log(
    `roadmap: rendered docs/now.md + docs/now.html + docs/decisions-open.html from ${nodes} node(s) across ${areas.length} area(s)`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  build(process.argv.slice(2));
}
