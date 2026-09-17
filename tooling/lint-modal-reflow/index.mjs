// Fitness function: a press inside a modal must not grow the modal.
//
// WHY THIS EXISTS (owner ruling, 2026-09-16). "For physical file, and for many other items in the
// app, I do not want reflow when clicking buttons inside of modals." A modal is a fixed frame a
// reader has already sized up: it centres itself, it is as tall as its content, and its commit sits
// at the bottom. A control inside it that reveals a form, a field pair or a detail block on press
// moves every one of those at the moment somebody acts — the commit walks down the screen, the
// frame re-centres, and the thing that was under the pointer is no longer under the pointer. On a
// short window it is a jolt; on a window already near the height of the screen the commit leaves
// the viewport entirely.
//
// THE THREE SHAPES THAT ARE ALLOWED, and they are the owner's own list:
//   1. A SECOND MODAL. The press opens its own panel over this one — what Amend and Change Status
//      already do from the matter's status window. The parent holds perfectly still.
//   2. AN AREA THAT WAS ALREADY THERE. The field stands in the row at rest, carrying the value the
//      record holds, with its commit beside it: the same size before and after it is used. This is
//      what the paper file's office and the matter's number now do.
//   3. A DROPDOWN THAT TAKES TYPING. A closed choice is a combobox (`@magna-carta/design-system/
//      combobox`), which opens over the surface in a floating layer and displaces nothing. Selects,
//      dropdown menus and popovers are the same story.
//
// WHAT IS CHECKED, AND WHY IT IS THIS. A reveal-in-place is written as a control carrying
// `aria-expanded` — that attribute is the promise "pressing me expands something HERE", which is
// exactly the promise this rule refuses inside a modal. It is a narrow probe on purpose: the
// design system's own disclosure pieces (Accordion, Combobox, Select, DropdownMenu, Popover) set
// the attribute from inside the component, so a surface composing them trips nothing, and a
// hand-written one in app markup is a bespoke fold almost every time. A fold written without the
// attribute slips past this check and is an accessibility defect in its own right.
//
// A control that OPENS THE MODAL is not a reveal-in-place, and is not flagged: its `aria-expanded`
// names the dialog's own open state, which is remedy 1 above.
//
// ONLY WHAT IS ACTUALLY INSIDE THE WINDOW is checked. A screen that folds a section of the page and
// also happens to render a dialog somewhere below is not a modal-reflow defect, so the scan works on
// the shell's own tag range — plus the ranges of any `{#snippet}` the shell is handed, because a
// two-sided panel's right side is written at the bottom of the file and is every bit as much inside
// the window as the body above it.
//
// THE INVENTORY below is every allowance that exists today, each with what it would take to clear
// it. Adding to it is a reviewed edit to this file, never a silent one, and an entry that no longer
// trips the rule fails too — a stale allowance is a rule nobody is keeping.
//
// Run: `pnpm run lint:modal-reflow`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { modalReflowFindings } from "./modal-reflow.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SWEEP = "apps/web/src";
const SKIP = new Set(["node_modules", "dist", "build", ".svelte-kit"]);

/**
 * The allowances, each `<path>:<expression> — <what it would take to clear it>`. Every one of these
 * predates the ruling; none is a licence for a new one.
 */
const EXPECTED_ALLOWANCES = [
  "apps/web/src/lib/components/bug-report-dialog.svelte:diagnosticsExpanded — the diagnostics a report will carry, folded away. Wants remedy 2: the block rendered at rest inside its own scrolling region, which is a redesign of the dialog's body rather than a swap.",
  "apps/web/src/lib/matters/matter-status-dialog.svelte:historyShown — the fee agreement's version history, folded under the engagement. Wants remedy 1: the history is long and rarely read, so it belongs in its own panel over the window, beside Amend.",
  "apps/web/src/lib/billing/invoice-window.svelte:disclosedLines.includes(line.id) — a bill line's own breakdown, opened per row. A table row's detail line is the one fold that is genuinely about the row and not about the window; it wants the grid's `rowDetail`, which reserves the line rather than inserting one.",
  "apps/web/src/lib/file-manager/folder-delete-dialog.svelte:showAffected — what a folder delete would take with it. Wants remedy 2: the list rendered at rest in a fixed-height scrolling region, since its whole point is to be read before the commit.",
  "apps/web/src/lib/time/time-sheet.svelte:searchOpen — the sheet's own search field. Wants remedy 3 or the screen's one search control, which every other Workspace screen already uses.",
];

function walk(directory, out = []) {
  for (const entry of readdirSync(directory)) {
    if (SKIP.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith(".svelte")) out.push(path);
  }
  return out;
}

const findings = [];
for (const path of walk(join(ROOT, SWEEP))) {
  const relativePath = relative(ROOT, path).replaceAll("\\", "/");
  for (const found of modalReflowFindings(readFileSync(path, "utf8"))) {
    findings.push({ ...found, path: relativePath, key: `${relativePath}:${found.expression}` });
  }
}

const allowed = new Set(EXPECTED_ALLOWANCES.map((entry) => entry.split(" — ")[0]));
const unexpected = findings.filter((finding) => !allowed.has(finding.key));
const stale = [...allowed].filter((key) => !findings.some((finding) => finding.key === key));

if (unexpected.length === 0 && stale.length === 0) {
  console.log(`lint:modal-reflow — ${String(findings.length)} allowed fold(s), no new ones.`);
  process.exit(0);
}

for (const finding of unexpected) {
  console.error(
    `${finding.path}:${String(finding.line)} — a press inside a modal reveals content in place (aria-expanded={${finding.expression}}).\n` +
      "  Open a second panel, render the area at rest, or use a combobox. See tooling/lint-modal-reflow/index.mjs.",
  );
}
for (const key of stale) {
  console.error(
    `${key} — listed as an allowed fold, but nothing there trips the rule any more. Delete the entry.`,
  );
}
process.exit(1);
