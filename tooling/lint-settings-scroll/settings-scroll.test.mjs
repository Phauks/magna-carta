/*
 * The settings-scroll gate's own tests. Each states a settings surface as a handful of strings,
 * because the rules are pure and the file system lives in index.mjs.
 */
import { describe, expect, it } from "vitest";
import {
  auditSettingsScroll,
  importSpecifiers,
  isFloatingSurface,
  mountsPortal,
  RULING_SENTENCE,
  scrollRegionsIn,
  SETTINGS_ROUTES,
  SETTINGS_SCROLL_REGION,
} from "./settings-scroll.mjs";

/** A ruling and a region that satisfy the premise, so a test can get to the rule it means to state. */
const RULING = `Some earlier correction.\n\n- **A settings page is the three stories.** ${RULING_SENTENCE} _(Settings, 2026-09-17)_\n`;
const REGION_SOURCE = `<div class="mc-scrollbar min-h-0 grow overflow-y-auto"></div>`;

/** One stylesheet, so the design-system class that scrolls is derived rather than assumed. */
const STYLESHEETS = [{ path: "data-table.css", source: ".mc-table-scroll { overflow-x: auto; }" }];

const PAGE = `${SETTINGS_ROUTES}/numbering/+page.svelte`;
const TABLE = "packages/design-system/src/lib/components/data-table/table.svelte";
const BARREL = "packages/design-system/src/lib/components/data-table/index.ts";

/** A graph node. `imports` is a list of target paths, or {locals, target} where the names matter. */
const node = (path, source, imports = []) => ({
  path,
  source,
  imports: imports.map((entry) =>
    typeof entry === "string" ? { locals: [], target: entry } : entry,
  ),
});

const audit = ({ graph, roots = [PAGE], allowances = [] }) =>
  auditSettingsScroll({
    graph,
    roots,
    stylesheets: STYLESHEETS,
    rulingSource: RULING,
    scrollRegionSource: REGION_SOURCE,
    allowances,
  });

/** The page under test, reaching one component through the design system's barrel. */
const surfaceReaching = (componentSource) => [
  node(
    PAGE,
    `<script>import * as DataTable from "@magna-carta/design-system/data-table";</script>`,
    [BARREL],
  ),
  node(BARREL, `import Root from "./table.svelte";`, [TABLE]),
  node(TABLE, componentSource),
];

describe("a settings page that reaches a scroll region", () => {
  it("fails, naming the component that draws it", () => {
    const { problems } = audit({
      graph: surfaceReaching(`<div class="mc-table-scroll mc-scrollbar w-full"></div>`),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      rule: "nested-scroll-region",
      file: PAGE,
      introducer: TABLE,
      scrollers: ["mc-table-scroll"],
    });
    expect(problems[0].message).toContain(TABLE);
  });

  it("passes when the component it reaches scrolls nothing", () => {
    const { problems } = audit({
      graph: surfaceReaching(`<table class="mc-table w-full"></table>`),
    });
    expect(problems).toEqual([]);
  });

  it("fails on a Tailwind scrolling utility just as on a recipe class", () => {
    const { problems } = audit({
      graph: surfaceReaching(`<div class="mc-scrollbar max-lg:overflow-y-auto"></div>`),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].scrollers).toEqual(["max-lg:overflow-y-auto"]);
  });

  it("ignores the overflow utilities that never draw a scrollbar", () => {
    const { problems } = audit({
      graph: surfaceReaching(`<div class="overflow-hidden overflow-x-clip"></div>`),
    });
    expect(problems).toEqual([]);
  });

  it("reports the chain that reached it, so the import is not gone looking for", () => {
    const { problems } = audit({
      graph: surfaceReaching(`<div class="mc-table-scroll"></div>`),
    });
    expect(problems[0].chain).toEqual([PAGE, BARREL, TABLE]);
  });
});

describe("the one region", () => {
  it("is exempt, because it IS the scroll region the ruling names", () => {
    const { problems, filesReached } = audit({
      graph: [
        node(
          PAGE,
          `<script>import Region from "$lib/settings/components/settings-scroll-region.svelte";</script>`,
          [SETTINGS_SCROLL_REGION],
        ),
        node(SETTINGS_SCROLL_REGION, REGION_SOURCE),
      ],
    });
    expect(problems).toEqual([]);
    expect(filesReached).toBe(1);
  });
});

describe("a floating surface", () => {
  const DIALOG_CONTENT = "packages/design-system/src/lib/components/dialog/dialog-content.svelte";
  const DIALOG_BARREL = "packages/design-system/src/lib/components/dialog/index.ts";
  const PANEL = "apps/web/src/lib/settings/components/request-change-dialog.svelte";

  it("is recognised by the portal it mounts", () => {
    expect(mountsPortal(`<DialogPrimitive.Portal><div /></DialogPrimitive.Portal>`)).toBe(true);
    expect(mountsPortal(`<div class="mc-table-scroll"></div>`)).toBe(false);
  });

  it("is recognised by the floating panel it renders, when the family portals", () => {
    const floatingNamespaces = new Set(["Dialog"]);
    expect(
      isFloatingSurface({ source: `<Dialog.Content>x</Dialog.Content>`, floatingNamespaces }),
    ).toBe(true);
    expect(
      isFloatingSurface({ source: `<Tabs.Content>x</Tabs.Content>`, floatingNamespaces }),
    ).toBe(false);
  });

  it("is not descended into, so an overlay's scroller is not a bar on the page", () => {
    const { problems } = audit({
      graph: [
        node(PAGE, `<script>import Panel from "./panel.svelte";</script>`, [PANEL]),
        node(PANEL, `<script>import Dialog from "@magna-carta/design-system/dialog";</script>`, [
          { locals: ["Dialog"], target: DIALOG_BARREL },
        ]),
        node(DIALOG_BARREL, `import Content from "./dialog-content.svelte";`, [DIALOG_CONTENT]),
        node(
          DIALOG_CONTENT,
          `<DialogPrimitive.Portal><div class="mc-table-scroll"></div></DialogPrimitive.Portal>`,
        ),
      ],
    });
    expect(problems).toEqual([]);
  });
});

describe("the standing-allowance registry", () => {
  const graph = surfaceReaching(`<div class="mc-table-scroll mc-scrollbar w-full"></div>`);
  const allowance = {
    rule: "nested-scroll-region",
    file: PAGE,
    text: TABLE,
    reason:
      "The page renders the firm's register, whose own horizontal scroller the canvas allows.",
  };

  it("suppresses the finding it names, and prints it as debt", () => {
    const { problems, standing } = audit({ graph, allowances: [allowance] });
    expect(problems).toEqual([]);
    expect(standing).toHaveLength(1);
    expect(standing[0]).toMatchObject({ file: PAGE, introducer: TABLE, reason: allowance.reason });
  });

  it("fails when it has outlived its finding", () => {
    const { problems } = audit({
      graph: surfaceReaching(`<table class="mc-table w-full"></table>`),
      allowances: [allowance],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ rule: "allowance", file: PAGE });
    expect(problems[0].message).toContain("no longer violates it");
  });

  it("fails when it carries no reason, and suppresses nothing", () => {
    const { problems, standing } = audit({
      graph,
      allowances: [{ ...allowance, reason: "  " }],
    });
    expect(standing).toEqual([]);
    expect(problems.map((problem) => problem.rule).toSorted()).toEqual([
      "allowance",
      "nested-scroll-region",
    ]);
    expect(problems.find((problem) => problem.rule === "allowance").message).toContain(
      "An allowance IS its reason",
    );
  });
});

describe("the premise", () => {
  const graph = surfaceReaching(`<div class="mc-table-scroll"></div>`);
  const premise = (overrides) =>
    auditSettingsScroll({
      graph,
      roots: [PAGE],
      stylesheets: STYLESHEETS,
      rulingSource: RULING,
      scrollRegionSource: REGION_SOURCE,
      ...overrides,
    }).premiseProblem;

  it("fails loudly when the ruling no longer says what this scan enforces", () => {
    expect(premise({ rulingSource: "An unrelated ledger of corrections." })).toContain(
      "no longer contains the sentence",
    );
  });

  it("fails loudly when the one region stops being a scroll region", () => {
    expect(premise({ scrollRegionSource: `<div class="min-h-0 grow"></div>` })).toContain(
      "no longer carries",
    );
  });

  it("fails loudly rather than passing vacuously on an empty settings tree", () => {
    expect(premise({ roots: [] })).toContain("no `+page.svelte`");
  });

  it("fails loudly when no design-system class scrolls, which cannot be true", () => {
    expect(
      premise({ stylesheets: [{ path: "a.css", source: ".mc-table { color: red }" }] }),
    ).toContain("no design-system class scrolls");
  });

  it("reports no finding while the premise is unanswered", () => {
    const { problems } = auditSettingsScroll({
      graph,
      roots: [PAGE],
      stylesheets: STYLESHEETS,
      rulingSource: "gone",
      scrollRegionSource: REGION_SOURCE,
    });
    expect(problems).toEqual([]);
  });
});

describe("reading what a file imports", () => {
  it("follows a binding list that wraps over several lines", () => {
    const source = `import NavigationLayout, {\n  NavigationLayoutGroup,\n} from "@magna-carta/design-system/navigation-layout";`;
    expect(importSpecifiers(source)).toEqual(["@magna-carta/design-system/navigation-layout"]);
  });

  it("does not follow an import that takes only types — a type renders nothing", () => {
    expect(
      importSpecifiers(`import type { GridColumn } from "@magna-carta/design-system/data-table";`),
    ).toEqual([]);
    expect(importSpecifiers(`import { type A, type B } from "./columns.ts";`)).toEqual([]);
  });

  it("follows an import that takes a value beside its types", () => {
    expect(importSpecifiers(`import { wallClockMinutes, type Entry } from "./grid.ts";`)).toEqual([
      "./grid.ts",
    ]);
  });

  it("does not follow an import a comment merely describes", () => {
    expect(importSpecifiers(`// import Table from "./table.svelte";\nconst x = 1;`)).toEqual([]);
  });
});

describe("which class expressions scroll", () => {
  const scrollingClasses = new Set(["mc-table-scroll"]);
  const regions = (source) => scrollRegionsIn({ source, scrollingClasses });

  it("reads a recipe class the markup says nothing about", () => {
    expect(regions(`<div class="mc-table-scroll w-full"></div>`)).toEqual([
      { line: 1, scroller: "mc-table-scroll", reason: "recipe" },
    ]);
  });

  it("reads a utility inside a merged class expression", () => {
    const found = regions(`<div class={mergeClasses("min-h-0", "overflow-y-auto")}></div>`);
    expect(found).toEqual([{ line: 1, scroller: "overflow-y-auto", reason: "utility" }]);
  });

  it("does not read its own documentation", () => {
    expect(
      regions(`<!-- overflow-y-auto is what this element does NOT do -->\n<div></div>`),
    ).toEqual([]);
  });
});
