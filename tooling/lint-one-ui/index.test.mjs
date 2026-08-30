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
import {
  exportsName,
  findDomainLeaks,
  findHeaderSetProblems,
  findRegistryProblems,
  identifierParts,
  kebabCase,
  stripComments,
  stripReExports,
} from "./rules.mjs";

const headerSource = (controls) => `
<div class="mc-record-window-header">
  <div class="mc-record-window-header-actions">
${controls}
  </div>
</div>
`;

const control = (action, tag = "button") =>
  `    <${tag} data-record-window-action="${action}"></${tag}>`;

const FOUR_IN_ORDER = [
  control("edit"),
  control("print"),
  control("expand"),
  control("close", "Dialog.Close"),
].join("\n");

describe("the record window's header set", () => {
  it("passes on exactly Edit, Print, expand and close, in that order", () => {
    expect(findHeaderSetProblems("shell.svelte", headerSource(FOUR_IN_ORDER))).toEqual([]);
  });

  it("bites when a fifth control is added", () => {
    const source = headerSource(`${FOUR_IN_ORDER}\n${control("duplicate")}`);
    const problems = findHeaderSetProblems("shell.svelte", source);
    expect(problems).toHaveLength(1);
    expect(problems[0].rule).toBe("header-set");
    expect(problems[0].detail).toContain("duplicate");
  });

  it("bites when the order changes", () => {
    const source = headerSource(
      [control("print"), control("edit"), control("expand"), control("close", "Dialog.Close")].join(
        "\n",
      ),
    );
    expect(findHeaderSetProblems("shell.svelte", source)[0].detail).toContain(
      "edit, print, expand, close",
    );
  });

  it("bites when one of the four is dropped", () => {
    const source = headerSource(
      [control("edit"), control("expand"), control("close", "Dialog.Close")].join("\n"),
    );
    expect(findHeaderSetProblems("shell.svelte", source)).toHaveLength(1);
  });

  it("bites when a control in the group carries no marker at all", () => {
    const source = headerSource(`${FOUR_IN_ORDER}\n    <button title="Share"></button>`);
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
