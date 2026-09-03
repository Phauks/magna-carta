/*
 * Each rule, proved against known-bad input.
 *
 * A fitness function that has never been shown to fail is a fitness function nobody can trust: the
 * scan can drift into vacuity (a renamed marker, a regex that stopped matching) and go on printing
 * its cheerful line forever. So every rule here is exercised twice — once on source that must pass,
 * once on source that must not — and the domain scan is exercised a third time on the prose that
 * would make it cry wolf, because that is the failure mode that gets a gate switched off.
 */
import { describe, expect, it } from "vitest";
import { readsAsFieldName } from "../../packages/design-system/src/lib/formatters/placeholder.ts";
import { STATUS_REGISTER } from "../../packages/design-system/src/lib/status-register/status-register.ts";
import {
  DATA_TABLE_HOME,
  applyAllowances,
  effectRegions,
  exportsName,
  findDomainLeaks,
  findHandBuiltDialogs,
  findFooterSetProblems,
  findHandComposedModals,
  findHandDrawnGlyphs,
  findHandRolledSelects,
  findHeaderSetProblems,
  findImperativeDomUse,
  findInventedStatusTones,
  findPlaceholderProblems,
  findRawTables,
  findRegistryProblems,
  findTableMachinery,
  identifierParts,
  kebabCase,
  stripComments,
  stripReExports,
} from "./rules.mjs";

/** The register's own words and tones, exactly as the runner reads them. */
const REGISTER = {
  labels: Object.values(STATUS_REGISTER).map((entry) => entry.label),
  tones: [...new Set(Object.values(STATUS_REGISTER).map((entry) => entry.tone))],
};

const details = (problems) => problems.map((problem) => problem.detail).join(" ");

const headerSource = (controls) => `
<div class="mc-record-window-header">
  <div class="mc-record-window-header-actions">
${controls}
  </div>
</div>
`;

const control = (action, tag = "button") =>
  `    <${tag} data-record-window-action="${action}"></${tag}>`;

const FIVE_IN_ORDER = [
  control("menu", "DropdownMenu.Trigger"),
  control("edit"),
  control("print"),
  control("expand"),
  control("close", "Dialog.Close"),
].join("\n");

describe("the record window's header set", () => {
  it("passes on exactly the kind's menu, Edit, Print, expand and close, in that order", () => {
    expect(findHeaderSetProblems("shell.svelte", headerSource(FIVE_IN_ORDER))).toEqual([]);
  });

  it("bites when a fifth control is added", () => {
    const source = headerSource(`${FIVE_IN_ORDER}\n${control("duplicate")}`);
    const problems = findHeaderSetProblems("shell.svelte", source);
    expect(problems).toHaveLength(1);
    expect(problems[0].rule).toBe("header-set");
    expect(problems[0].detail).toContain("duplicate");
  });

  it("bites when the order changes", () => {
    const source = headerSource(
      [
        control("menu", "DropdownMenu.Trigger"),
        control("print"),
        control("edit"),
        control("expand"),
        control("close", "Dialog.Close"),
      ].join("\n"),
    );
    expect(findHeaderSetProblems("shell.svelte", source)[0].detail).toContain(
      "menu, print, edit, expand, close",
    );
  });

  it("bites when one of the set is dropped", () => {
    const source = headerSource(
      [
        control("menu", "DropdownMenu.Trigger"),
        control("edit"),
        control("expand"),
        control("close", "Dialog.Close"),
      ].join("\n"),
    );
    expect(findHeaderSetProblems("shell.svelte", source)).toHaveLength(1);
  });

  it("bites when a control in the group carries no marker at all", () => {
    const source = headerSource(`${FIVE_IN_ORDER}\n    <button title="Share"></button>`);
    const problems = findHeaderSetProblems("shell.svelte", source);
    expect(problems.map((problem) => problem.detail).join(" ")).toContain(
      "data-record-window-action",
    );
  });

  it("fails loudly rather than vacuously when the action group is gone", () => {
    const problems = findHeaderSetProblems("shell.svelte", "<div>no header here</div>");
    expect(problems).toHaveLength(1);
    expect(problems[0].detail).toContain("mc-record-window-header-actions");
  });
});

describe("no kind of record inside the shell", () => {
  it("passes on a shell that only knows about records in general", () => {
    const source = `<script lang="ts">
  let { heading, subtitle, record, tabs, actions, onEdit, onPrint } = $props();
</script>
<div class="mc-record-window-header">{heading}</div>`;
    expect(findDomainLeaks("record-window.svelte", source)).toEqual([]);
  });

  it("bites on a prop named after one kind of record", () => {
    const source = `<script lang="ts">
  let { invoiceNumber } = $props();
</script>`;
    const problems = findDomainLeaks("record-window.svelte", source);
    expect(problems).toHaveLength(1);
    expect(problems[0].rule).toBe("domain-leak");
    expect(problems[0].detail).toContain("invoiceNumber");
  });

  it("bites on a lone identifier in code, where a bare word is never English", () => {
    const problems = findDomainLeaks("shell.ts", "export function total(cost) { return cost; }");
    expect(problems.map((problem) => problem.detail).join(" ")).toContain("cost");
  });

  it("bites on a recipe class that names one kind of record", () => {
    const problems = findDomainLeaks(
      "record-window.css",
      "@layer components {\n  .mc-record-window-fee-amount { color: var(--mc-text-default); }\n}",
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].line).toBe(2);
  });

  it("bites on a two-word name spelled as one identifier", () => {
    const problems = findDomainLeaks("shell.ts", "export type TimeEntryFields = never;");
    expect(problems.map((problem) => problem.detail).join(" ")).toContain("TimeEntryFields");
  });

  it("does NOT cry wolf on ordinary English in a comment", () => {
    const source = `/* A long tab costs the window nothing, and it does not matter which tab it is. */
export const value = 1;`;
    expect(findDomainLeaks("shell.ts", source)).toEqual([]);
  });

  it("does NOT cry wolf on ordinary English in a label a reader sees", () => {
    const source = `<script lang="ts">
  const label = "It does not matter which tab is open";
</script>
<button title="No matter">{label}</button>`;
    expect(findDomainLeaks("record-window.svelte", source)).toEqual([]);
  });

  it("does NOT read a Svelte file's markup as code", () => {
    // Prose in the template is text a reader sees, not an identifier — only the script blocks are
    // read as code, which is what keeps the second pass to compound identifiers.
    expect(
      findDomainLeaks("record-window.svelte", "<p>The cost does not matter here.</p>"),
    ).toEqual([]);
  });

  it("strips comments without moving any line number", () => {
    const stripped = stripComments("a\n/* two\n   three */\nfour // five\n");
    expect(stripped.split("\n")).toHaveLength(5);
    expect(stripped.split("\n")[3].trim()).toBe("four");
  });

  it("splits identifiers across every casing the codebase uses, and folds plurals", () => {
    expect(identifierParts("invoiceNumber")).toEqual(["invoice", "number"]);
    expect(identifierParts("mc-record-window-fee")).toEqual(["mc", "record", "window", "fee"]);
    expect(identifierParts("record_costs")).toEqual(["record", "cost"]);
  });
});

describe("the one-implementation registry", () => {
  const entries = [
    { name: "RecordWindow", home: "packages/design-system/src/lib/components/record-window" },
  ];

  it("passes when the home is there and nothing else claims the name", () => {
    const result = findRegistryProblems(entries, {
      homesPresent: new Set(["RecordWindow"]),
      foreignExports: [],
    });
    expect(result.problems).toEqual([]);
    expect(result.notices).toEqual([]);
  });

  it("bites, without crashing, when a declared home is not on disk", () => {
    const result = findRegistryProblems(entries, {
      homesPresent: new Set(),
      foreignExports: [],
    });
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].detail).toContain("nothing is there");
  });

  it("reports a home that is still being written as a notice, not a failure", () => {
    const pending = [{ ...entries[0], pending: "being built in this same round" }];
    const result = findRegistryProblems(pending, {
      homesPresent: new Set(),
      foreignExports: [],
    });
    expect(result.problems).toEqual([]);
    expect(result.notices[0]).toContain("Expected to arrive");
  });

  it("refuses a pending mark with no reason", () => {
    const pending = [{ ...entries[0], pending: "  " }];
    const result = findRegistryProblems(pending, {
      homesPresent: new Set(),
      foreignExports: [],
    });
    expect(result.problems[0].detail).toContain("no reason");
  });

  it("refuses a pending mark that has outlived its home", () => {
    const pending = [{ ...entries[0], pending: "being built" }];
    const result = findRegistryProblems(pending, {
      homesPresent: new Set(["RecordWindow"]),
      foreignExports: [],
    });
    expect(result.problems[0].detail).toContain("take the mark off");
  });

  it("bites when a second file exports the same component name", () => {
    const result = findRegistryProblems(entries, {
      homesPresent: new Set(["RecordWindow"]),
      foreignExports: [{ name: "RecordWindow", file: "apps/web/src/lib/wip/record-window.svelte" }],
    });
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].detail).toContain("second implementation");
  });
});

describe("finding an export of a registered name", () => {
  it("finds every shape a module can export one by", () => {
    expect(exportsName("export function RecordWindow() {}", "RecordWindow")).toBe(true);
    expect(exportsName("export class RecordWindow {}", "RecordWindow")).toBe(true);
    expect(exportsName("export const RecordWindow = 1;", "RecordWindow")).toBe(true);
    expect(exportsName("export type RecordWindow = never;", "RecordWindow")).toBe(true);
    expect(exportsName("export { Shell as RecordWindow };", "RecordWindow")).toBe(true);
    expect(exportsName("export { RecordWindow };", "RecordWindow")).toBe(true);
  });

  it("does not mistake a plain import or a similar name for an export", () => {
    expect(exportsName('import RecordWindow from "./x.svelte";', "RecordWindow")).toBe(false);
    expect(exportsName("export const RecordWindowTab = 1;", "RecordWindow")).toBe(false);
  });

  it("does not count a barrel forwarding the one that exists", () => {
    const barrel = 'export { RecordWindow } from "@magna-carta/design-system/record-window";';
    expect(exportsName(stripReExports(barrel), "RecordWindow")).toBe(false);
  });

  it("spells a component name the way its file and folder are spelled", () => {
    expect(kebabCase("RecordWindow")).toBe("record-window");
    expect(kebabCase("PrintSheet")).toBe("print-sheet");
  });
});

describe("no hand-rolled select", () => {
  it("bites on a native select in an app screen", () => {
    const problems = findHandRolledSelects(
      "screen.svelte",
      '<label for="tone">Tone</label>\n<select id="tone"><option>One</option></select>',
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].rule).toBe("native-select");
    expect(problems[0].line).toBe(2);
  });

  it("does NOT cry wolf on the design system's own Select, which is the answer", () => {
    const source = `<Select.Root type="single">
  <Select.Trigger><Select.Value placeholder="Theme" /></Select.Trigger>
</Select.Root>`;
    expect(findHandRolledSelects("screen.svelte", source)).toEqual([]);
  });

  it("does NOT cry wolf on a selection variable or on the word in prose", () => {
    const source = `<script lang="ts">
  let selectedRow = $state(null);
  const onSelect = () => {};
</script>
<p>Select a row to see its detail.</p>`;
    expect(findHandRolledSelects("screen.svelte", source)).toEqual([]);
  });

  it("does NOT read a comment that names the element it is warning about", () => {
    const source = "<!-- Never a bare <select> here; use Combobox. -->\n<Combobox.Root />";
    expect(findHandRolledSelects("screen.svelte", source)).toEqual([]);
  });
});

describe("no raw table outside the one table's home", () => {
  it("bites on a raw table in an app screen, once, at its first element", () => {
    const source = `<details>
  <table class="w-full">
    <thead><tr><th scope="col">Sample</th></tr></thead>
    <tbody><tr><td>1</td></tr></tbody>
  </table>
</details>`;
    const problems = findRawTables("apps/web/src/lib/tools/speed-test/sparkline.svelte", source);
    expect(problems).toHaveLength(1);
    expect(problems[0].rule).toBe("raw-table");
    expect(problems[0].line).toBe(2);
    expect(problems[0].detail).toContain("`<table`");
    expect(problems[0].detail).toContain("6 more below");
    expect(problems[0].detail).toContain("DataTable.Grid");
  });

  it("bites on a div wearing a table's role", () => {
    const source = `<div role="grid">
  <div role="row"><div role="columnheader">Name</div></div>
</div>`;
    const problems = findRawTables("screen.svelte", source);
    expect(problems).toHaveLength(1);
    expect(problems[0].line).toBe(1);
    expect(problems[0].detail).toContain('role="grid"');
  });

  it("does NOT cry wolf on the design system's primitives, which are the answer", () => {
    const source = `<DataTable.Root>
  <DataTable.Header><DataTable.Row><DataTable.Head>Name</DataTable.Head></DataTable.Row></DataTable.Header>
  <DataTable.Body><DataTable.Row><DataTable.Cell>One</DataTable.Cell></DataTable.Row></DataTable.Body>
</DataTable.Root>
<Table><TableRow><TableCell>Two</TableCell></TableRow></Table>
<DataTable.Grid {grid} caption="Matters" />`;
    expect(findRawTables("screen.svelte", source)).toEqual([]);
  });

  it("does NOT cry wolf on elements that merely start the same way, or on a comment", () => {
    const source = `<!-- a raw <table> used to live here -->
<textarea></textarea>
<track kind="captions" />
<time datetime="2026-09-03">today</time>
<p>The table view is below.</p>`;
    expect(findRawTables("screen.svelte", source)).toEqual([]);
  });

  it("leaves the one table's own home alone, where the element has to be written", () => {
    const home = `${DATA_TABLE_HOME}/table.svelte`;
    expect(findRawTables(home, "<table><tbody><tr><td></td></tr></tbody></table>")).toEqual([]);
  });
});

describe("no table machinery beside the one table", () => {
  it("bites on a sortable header rolled by hand, naming every signal it found", () => {
    const source = `<DataTable.Head aria-sort={sortKey === "name" ? direction : "none"}>
  <button type="button" class="mc-table-sort" onclick={() => sortBy("name")}>Name</button>
</DataTable.Head>`;
    const problems = findTableMachinery("screen.svelte", source);
    expect(problems).toHaveLength(1);
    expect(problems[0].rule).toBe("table-machinery");
    expect(problems[0].line).toBe(1);
    expect(problems[0].detail).toContain("`aria-sort`, line 1");
    expect(problems[0].detail).toContain("`mc-table-sort`, line 2");
    expect(problems[0].detail).toContain("createDataTableGrid");
  });

  it("bites on the headless engine composed in a screen or a module, and on its parts", () => {
    expect(
      findTableMachinery("state.svelte.ts", "export const table = createSvelteTable(options);"),
    ).toHaveLength(1);
    expect(
      findTableMachinery(
        "screen.svelte",
        'import { getCoreRowModel } from "@tanstack/table-core";',
      ),
    ).toHaveLength(1);
    expect(findTableMachinery("screen.svelte", "<DataTable.Search {table} />")).toHaveLength(1);
    expect(findTableMachinery("screen.svelte", "<TableViewMenu {table} />")).toHaveLength(1);
    expect(findTableMachinery("screen.svelte", "<FlexRender content={cell} />")).toHaveLength(1);
  });

  it("does NOT cry wolf on the Grid, on a Lucide Search icon, or on a sort that is the Grid's", () => {
    const source = `<script lang="ts">
  import Search from "@lucide/svelte/icons/search";
  import * as DataTable from "@magna-carta/design-system/data-table";
  const grid = DataTable.createDataTableGrid({ columns, rowKey: (row) => row.id });
  const sorted = rows.toSorted((first, second) => first.name.localeCompare(second.name));
</script>
<Search />
<DataTable.Grid {grid} caption="Matters" />`;
    expect(findTableMachinery("screen.svelte", source)).toEqual([]);
  });

  it("does NOT read a comment that names the signal it is warning about", () => {
    const source =
      "<!-- never a hand-rolled aria-sort here -->\n// createSvelteTable( is the Grid's\n<DataTable.Grid />";
    expect(findTableMachinery("screen.svelte", source)).toEqual([]);
  });

  it("leaves the one table's own home alone, where the machinery has to be written", () => {
    const home = `${DATA_TABLE_HOME}/data-table-grid.svelte`;
    expect(findTableMachinery(home, '<th aria-sort="none" class="mc-table-sort">')).toEqual([]);
  });
});

describe("no raw dialog and no hand-built scrim", () => {
  it("bites on a raw dialog element", () => {
    const problems = findHandBuiltDialogs(
      "screen.svelte",
      "<dialog open>\n  <p>Hello</p>\n</dialog>",
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].rule).toBe("hand-built-dialog");
    expect(problems[0].detail).toContain("raw `<dialog>`");
  });

  it("bites on a hand-built scrim in a component's style block", () => {
    const source = `<div class="scrim"></div>
<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 50%);
  }
</style>`;
    const problems = findHandBuiltDialogs("screen.svelte", source);
    expect(problems).toHaveLength(1);
    expect(problems[0].detail).toContain("scrim");
  });

  it("bites on the same rectangle spelled out as four physical sides", () => {
    const source = `<style>
  .scrim { position: fixed; top: 0; right: 0; bottom: 0; left: 0; }
</style>`;
    expect(findHandBuiltDialogs("screen.svelte", source)).toHaveLength(1);
  });

  it("bites on the logical pair as well as the shorthand", () => {
    const source = `<style>
  .scrim { position: fixed; inset-block: 0; inset-inline: 0; }
</style>`;
    expect(findHandBuiltDialogs("screen.svelte", source)).toHaveLength(1);
  });

  it("does NOT cry wolf on the design system's Dialog, which is the answer", () => {
    const source = `<Dialog.Root bind:open>
  <Dialog.Content><Dialog.Close /></Dialog.Content>
</Dialog.Root>`;
    expect(findHandBuiltDialogs("screen.svelte", source)).toEqual([]);
  });

  it("does NOT cry wolf on a fixed element that is not pinned to every edge", () => {
    const source = `<style>
  .bar { position: fixed; inset-block-end: 0; inline-size: 100%; }
</style>`;
    expect(findHandBuiltDialogs("screen.svelte", source)).toEqual([]);
  });

  it("does NOT cry wolf on a comment describing the recipe that does this correctly", () => {
    // The exact shape in dialog-content.svelte: a doc block quoting the recipe's own declarations.
    const source = `<script lang="ts">
  /*
   * The centering is done in the CSS recipe with \`position: fixed; inset: 0; margin: auto\`.
   */
</script>`;
    expect(findHandBuiltDialogs("dialog-content.svelte", source)).toEqual([]);
  });
});

describe("the action dialog's footer set", () => {
  const bar = (controls) => `
<div class="mc-action-dialog-actions flex items-center justify-end gap-8">
${controls}
</div>
`;
  const footerControl = (action) =>
    `    <Button data-action-dialog-action="${action}">Verb</Button>`;
  const TWO_IN_ORDER = [footerControl("dismiss"), footerControl("commit")].join("\n");

  it("passes on exactly the dismissal then the commit", () => {
    expect(findFooterSetProblems("shell.svelte", bar(TWO_IN_ORDER))).toEqual([]);
  });

  it("bites when a third control joins the bar", () => {
    const problems = findFooterSetProblems(
      "shell.svelte",
      bar(`${TWO_IN_ORDER}\n${footerControl("apply")}`),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].rule).toBe("footer-set");
    expect(problems[0].detail).toContain("apply");
  });

  it("bites when the two are swapped, which un-learns the bar everywhere at once", () => {
    const swapped = [footerControl("commit"), footerControl("dismiss")].join("\n");
    expect(findFooterSetProblems("shell.svelte", bar(swapped))[0].detail).toContain(
      "commit, dismiss",
    );
  });

  it("bites when a control in the bar carries no marker at all", () => {
    const problems = findFooterSetProblems(
      "shell.svelte",
      bar(`${TWO_IN_ORDER}\n    <Button>Apply</Button>`),
    );
    expect(details(problems)).toContain("data-action-dialog-action");
  });

  it("fails loudly rather than vacuously when the bar is gone", () => {
    const problems = findFooterSetProblems("shell.svelte", "<div>no bar here</div>");
    expect(problems).toHaveLength(1);
    expect(problems[0].detail).toContain("mc-action-dialog-actions");
  });
});

describe("every modal surface is one of the declared shells", () => {
  const SHELLS = [
    "packages/design-system/src/lib/components/action-dialog",
    "packages/design-system/src/lib/components/record-window",
  ];

  it("bites on a screen composing a Dialog panel of its own", () => {
    const source = `<Dialog.Root bind:open>
  <Dialog.Content>
    <Dialog.Title>Write Off a Balance</Dialog.Title>
  </Dialog.Content>
</Dialog.Root>`;
    const problems = findHandComposedModals(
      "apps/web/src/lib/billing/screen.svelte",
      source,
      SHELLS,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].rule).toBe("hand-composed-modal");
    expect(problems[0].detail).toContain("ActionDialog");
  });

  it("bites on an AlertDialog panel and on a Sheet panel too", () => {
    for (const part of ["AlertDialog", "Sheet"]) {
      const problems = findHandComposedModals(
        "apps/web/src/lib/screen.svelte",
        `<${part}.Content><p>x</p></${part}.Content>`,
        SHELLS,
      );
      expect(problems).toHaveLength(1);
      expect(problems[0].detail).toContain(`${part}.Content`);
    }
  });

  it("bites on a scrim written as utilities, which the style-block rule cannot see", () => {
    const source = '<div class="fixed inset-0 z-modal bg-surface-scrim"></div>';
    const problems = findHandComposedModals("apps/web/src/lib/screen.svelte", source, SHELLS);
    expect(problems).toHaveLength(1);
    expect(problems[0].detail).toContain("scrim");
  });

  it("bites on a reach for the platform's own modal, which no markup scan sees", () => {
    const problems = findHandComposedModals(
      "apps/web/src/lib/screen.ts",
      "panel.showModal();",
      SHELLS,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].detail).toContain("through the platform directly");
  });

  it("does NOT cry wolf inside a declared shell's own home", () => {
    const source = "<Dialog.Content><Dialog.Title>{heading}</Dialog.Title></Dialog.Content>";
    const inside = "packages/design-system/src/lib/components/action-dialog/action-dialog.svelte";
    expect(findHandComposedModals(inside, source, SHELLS)).toEqual([]);
  });

  it("does NOT cry wolf on a screen that reaches for the shell, which is the answer", () => {
    const source = `<ActionDialog bind:open heading="Write Off a Balance" commitLabel="Write It Off" {onCommit}>
  {#snippet fields({ busy })}<Input disabled={busy} />{/snippet}
</ActionDialog>`;
    expect(findHandComposedModals("apps/web/src/lib/screen.svelte", source, SHELLS)).toEqual([]);
  });

  it("does NOT cry wolf on a pinned element that is not at the modal layer", () => {
    const source = '<div class="fixed inset-0 bg-surface-sunken"></div>';
    expect(findHandComposedModals("apps/web/src/lib/screen.svelte", source, SHELLS)).toEqual([]);
  });

  it("does NOT cry wolf on prose describing the shape, which is how a gate gets switched off", () => {
    const source = `<script lang="ts">
  /*
   * This screen used to compose a <Dialog.Content> of its own and pin a \`fixed inset-0 z-modal\`
   * scrim behind it. It reaches for the shell now.
   */
</script>`;
    expect(findHandComposedModals("apps/web/src/lib/screen.svelte", source, SHELLS)).toEqual([]);
  });

  it("reads the shell homes it is given rather than a list of its own", () => {
    // The homes are declared in registry.json so adding a shell is a reviewed edit there. Passing
    // none is therefore the state the runner refuses outright, and the rule must not paper over it.
    const source = "<Dialog.Content><p>x</p></Dialog.Content>";
    const home = "packages/design-system/src/lib/components/action-dialog/action-dialog.svelte";
    expect(findHandComposedModals(home, source, [])).toHaveLength(1);
  });
});

describe("no hand-drawn glyphs", () => {
  it("bites on a glyph drawn as literal geometry", () => {
    const source = '<svg viewBox="0 0 24 24">\n  <path d="M12 2 L22 22 L2 22 Z" />\n</svg>';
    const problems = findHandDrawnGlyphs("screen.svelte", source);
    expect(problems).toHaveLength(1);
    expect(problems[0].rule).toBe("hand-drawn-glyph");
    expect(problems[0].line).toBe(2);
  });

  it("does NOT cry wolf on a chart, whose geometry is computed from data", () => {
    // bandwidth-sparkline.svelte's real shape: the path is a picture OF something, not a drawing.
    const source = `<svg viewBox="0 0 100 30">
  <path d={area} fill="var(--mc-accent-default)" stroke="none" />
  <path d={line} fill="none" stroke="var(--mc-accent-default)" />
</svg>`;
    expect(findHandDrawnGlyphs("bandwidth-sparkline.svelte", source)).toEqual([]);
  });

  it("does NOT cry wolf on a Lucide icon, which is the answer", () => {
    const source = `<script lang="ts">
  import FileText from "@lucide/svelte/icons/file-text";
</script>
<FileText class="size-16" />`;
    expect(findHandDrawnGlyphs("screen.svelte", source)).toEqual([]);
  });

  it("does NOT read geometry quoted inside a comment", () => {
    const source = '<svg>\n  <!-- was <path d="M12 2 L22 22 Z" />; replaced by Lucide -->\n</svg>';
    expect(findHandDrawnGlyphs("screen.svelte", source)).toEqual([]);
  });
});

describe("one status register", () => {
  it("bites when a surface hands a status word a tone of its own", () => {
    const source = '<Badge variant="warning">Void</Badge>';
    const problems = findInventedStatusTones("screen.svelte", source, REGISTER);
    expect(problems).toHaveLength(1);
    expect(problems[0].rule).toBe("status-tone");
    expect(problems[0].detail).toContain("Void");
  });

  it("bites on a second register written as a local label map and tone map", () => {
    // cost-api.ts's real shape, which is where every disagreement on this repository lives.
    const source = `const STATUS_LABELS = { draft: "Draft", submitted: "Submitted", void: "Void" };
export function statusTone(status) {
  return status === "void" ? "warning" : "neutral";
}`;
    const problems = findInventedStatusTones("cost-api.ts", source, REGISTER);
    expect(problems).toHaveLength(1);
    expect(problems[0].detail).toContain("second status register");
  });

  it("passes a surface that takes its words and tones from the register", () => {
    const source = `<script lang="ts">
  import { statusBadgeAttributes, statusEntry } from "@magna-carta/design-system/status-register";
  const key = "void";
</script>
<Badge {...statusBadgeAttributes(key)}>{statusEntry(key).label}</Badge>`;
    expect(findInventedStatusTones("screen.svelte", source, REGISTER)).toEqual([]);
  });

  it("does NOT cry wolf on a badge whose word is not a status", () => {
    const source = `<Badge variant="neutral">Soon</Badge>
<Badge variant="warning">Different Builds</Badge>
<Badge variant="neutral" class="tabular-nums">Was: 3</Badge>`;
    expect(findInventedStatusTones("screen.svelte", source, REGISTER)).toEqual([]);
  });

  it("does NOT cry wolf on a badge whose variant is an expression", () => {
    const source = "<Badge variant={presentation.badgeVariant}>{presentation.label}</Badge>";
    expect(findInventedStatusTones("maturity-badge.svelte", source, REGISTER)).toEqual([]);
  });

  it("does NOT cry wolf on one ordinary word that happens to be a status", () => {
    const source = `const heading = "Draft";
const tone = "neutral";`;
    expect(findInventedStatusTones("screen.svelte", source, REGISTER)).toEqual([]);
  });

  it("reads the words and tones off the register rather than a copy of them", () => {
    // A tone the register does not use must not be treated as one, whatever Badge also offers.
    const source = 'const labels = ["Draft", "Void"];\nconst tone = "destructive";';
    expect(findInventedStatusTones("screen.svelte", source, REGISTER)).toEqual([]);
  });
});

describe("every ghost text is the field's name", () => {
  const find = (path, source) => findPlaceholderProblems(path, source, readsAsFieldName);

  it("bites on ghost text that instructs instead of naming", () => {
    const problems = find("screen.svelte", '<Select.Value placeholder="Select a theme" />');
    expect(problems).toHaveLength(1);
    expect(problems[0].rule).toBe("placeholder");
    expect(problems[0].text).toBe("Select a theme");
  });

  it("bites on ghost text that is a sentence or an example", () => {
    const source = `<Input placeholder="Describe what happened, in a sentence or two." />
<Input placeholder="e.g. Pemberton v. Hale" />`;
    expect(find("screen.svelte", source)).toHaveLength(2);
  });

  it("does NOT cry wolf on ordinary field names, which is most of the product", () => {
    // The names the ruling itself gives as correct — the failure mode that gets a gate switched off.
    const source = `<Input placeholder="Amount" />
<Input placeholder="Description" />
<Input placeholder="Reason" />
<Input placeholder="Payee" />
<Input placeholder="Matter" />
<Input placeholder="Time Worked" />
<Input placeholder="Internal Memo" />
<Input placeholder="Email Address" />
<Input placeholder="Recovery Code" />
<Input placeholder="Search" />`;
    expect(find("screen.svelte", source)).toEqual([]);
  });

  it("does NOT read a placeholder that is not a literal — that is already the right answer", () => {
    expect(find("screen.svelte", "<Input placeholder={placeholderOf(label)} />")).toEqual([]);
  });

  it("honours the repository's inline allowance on the line above", () => {
    const source = `<!-- fitness-allow: the field has no name of its own; it filters the column beside it -->
<Input placeholder="Contains…" />`;
    expect(find("screen.svelte", source)).toEqual([]);
  });

  it("borrows the design system's judgement rather than restating it", () => {
    // If the predicate is ever loosened or tightened, this rule moves with it — which is the point.
    expect(readsAsFieldName("Amount")).toBe(true);
    expect(readsAsFieldName("Select a theme")).toBe(false);
    expect(find("screen.svelte", '<Input placeholder="Amount" />')).toEqual([]);
    expect(find("screen.svelte", '<Input placeholder="Select a theme" />')).toHaveLength(1);
  });
});

describe("no imperative DOM in the ported surfaces", () => {
  it("bites on reaching for a node by id", () => {
    const problems = findImperativeDomUse(
      "panel.svelte",
      "const row = document.getElementById(id);",
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].rule).toBe("imperative-dom");
  });

  it("bites on assigning markup as a string", () => {
    const problems = findImperativeDomUse("panel.svelte", "node.innerHTML = renderRow(row);");
    expect(details(problems)).toContain("injection surface");
  });

  it("bites on a selector query outside an effect", () => {
    const source = `function focusFirst() {
  container.querySelector(".mc-row")?.focus();
}`;
    expect(findImperativeDomUse("panel.svelte", source)).toHaveLength(1);
  });

  it("allows the one legitimate use: measuring, inside an effect", () => {
    const source = `$effect(() => {
  const header = container.querySelector(".mc-grid-header");
  height = header?.getBoundingClientRect().height ?? 0;
});`;
    expect(findImperativeDomUse("panel.svelte", source)).toEqual([]);
  });

  it("allows a measuring pass in $effect.pre too, and finds the region's real end", () => {
    const source = `$effect.pre(() => {
  if (ready) {
    const cells = container.querySelectorAll(".mc-cell");
    widths = [...cells].map((cell) => cell.clientWidth);
  }
});
const stray = document.querySelector(".mc-row");`;
    const problems = findImperativeDomUse("panel.svelte", source);
    expect(problems).toHaveLength(1);
    expect(problems[0].line).toBe(7);
  });

  it("does NOT cry wolf on a comment or a string that names one of them", () => {
    const source = `// Never getElementById here: bind:this names the node.
const message = "innerHTML is not how we render";
const selector = ".querySelector-looking-class";`;
    expect(findImperativeDomUse("panel.svelte", source)).toEqual([]);
  });

  it("does NOT cry wolf on the declarative answer", () => {
    const source = `<script lang="ts">
  let container = $state(null);
</script>
<div bind:this={container}></div>`;
    expect(findImperativeDomUse("panel.svelte", source)).toEqual([]);
  });

  it("reads an effect's extent by matching its braces", () => {
    const text = "$effect(() => { if (a) { b(); } });\nafter();";
    const [[start, end]] = effectRegions(text);
    expect(text.slice(start, end + 1)).toBe("$effect(() => { if (a) { b(); } }");
  });
});

describe("an allowance may not outlive its violation", () => {
  const problem = {
    rule: "placeholder",
    file: "apps/web/src/screen.svelte",
    line: 12,
    text: "Select a theme",
    detail: "…",
  };
  const allowance = {
    rule: "placeholder",
    file: "apps/web/src/screen.svelte",
    text: "Select a theme",
    reason: "predates the ruling",
  };

  it("excuses the violation it names, and says so", () => {
    const result = applyAllowances([problem], [allowance]);
    expect(result.problems).toEqual([]);
    expect(result.excused).toHaveLength(1);
    expect(result.excused[0].allowance.reason).toBe("predates the ruling");
  });

  it("matches on the violation, not on the line, so an edit above it changes nothing", () => {
    const moved = { ...problem, line: 400 };
    expect(applyAllowances([moved], [allowance]).problems).toEqual([]);
  });

  it("does not excuse a different violation in the same file", () => {
    // Two problems, and both are right: the new ghost text is unexcused, and the allowance that
    // was meant for the old one has outlived it.
    const other = { ...problem, text: "Choose a format" };
    const result = applyAllowances([other], [allowance]);
    expect(result.excused).toEqual([]);
    expect(result.problems.map((one) => one.rule)).toEqual(["placeholder", "allowance"]);
  });

  it("fails when an allowance has outlived its violation", () => {
    const result = applyAllowances([], [allowance]);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].rule).toBe("allowance");
    expect(result.problems[0].detail).toContain("no longer violates it");
  });

  it("refuses an allowance with no reason", () => {
    const result = applyAllowances([problem], [{ ...allowance, reason: "  " }]);
    expect(details(result.problems)).toContain("carries no reason");
  });

  it("leaves an unallowed problem exactly where it was", () => {
    const result = applyAllowances([problem], []);
    expect(result.problems).toEqual([problem]);
    expect(result.excused).toEqual([]);
  });
});

describe("the registry's own allowances", () => {
  it("every recorded allowance names a rule this tool actually runs", async () => {
    const registry = JSON.parse(
      await import("node:fs").then(({ readFileSync }) =>
        readFileSync(new URL("./registry.json", import.meta.url), "utf8"),
      ),
    );
    const known = new Set([
      "header-set",
      "domain-leak",
      "registry",
      "native-select",
      "hand-built-dialog",
      "footer-set",
      "hand-composed-modal",
      "hand-drawn-glyph",
      "status-tone",
      "placeholder",
      "imperative-dom",
      "raw-table",
      "table-machinery",
      "sweep",
    ]);
    for (const allowance of registry.allowances ?? []) {
      expect(known, `allowance for an unknown rule: ${allowance.rule}`).toContain(allowance.rule);
      expect(String(allowance.reason ?? "").trim()).not.toBe("");
    }
  });
});
