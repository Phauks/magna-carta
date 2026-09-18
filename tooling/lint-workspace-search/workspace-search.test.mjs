import { describe, expect, it } from "vitest";
import {
  actionsSnippets,
  auditWorkspaceSearch,
  libComponentImports,
  lineOf,
  markupOf,
  rendersScreenSearch,
  screenSearchTags,
  searchReachableFrom,
  withoutComments,
  workspaceDestinations,
} from "./workspace-search.mjs";

const MATTERS = "apps/web/src/routes/(app)/matters/+page.svelte";

/** A Workspace destination, shipped unless said otherwise. */
function destination(id, overrides = {}) {
  return { id, label: id, href: `/${id}`, shipped: true, ...overrides };
}

/**
 * Audits a set of files as though each destination's page were the file of the same name. `files`
 * maps a repository-relative path to its source.
 */
function audit(files, destinations, declined = new Map()) {
  const paths = Object.keys(files);
  return auditWorkspaceSearch({
    destinations,
    pageOf: (href) => paths.find((path) => path.includes(`/${href.slice(1)}/`)) ?? null,
    read: (path) => files[path] ?? null,
    screenFiles: paths.map((path) => ({ path, source: files[path] })),
    declined,
  });
}

const SEARCHING_PAGE = `<script>
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
</script>
<ScreenHeader title="Matters">
  {#snippet actions()}
    <ScreenSearch bind:value={searchText} label="Search the docket" />
  {/snippet}
</ScreenHeader>`;

const BARE_PAGE = `<script>
  import ScreenHeader from "$lib/screen/screen-header.svelte";
</script>
<ScreenHeader title="Matters" />`;

describe("withoutComments and markupOf", () => {
  it("preserve offsets, so a reported line is the real one", () => {
    const source = "<script>\n  /* a note */\n</script>\n<!-- x -->\n<ScreenSearch />";
    expect(withoutComments(source)).toHaveLength(source.length);
    expect(markupOf(source)).toHaveLength(source.length);
    expect(markupOf(source).split("\n")).toHaveLength(source.split("\n").length);
  });

  it("hides a control mentioned only in a comment", () => {
    expect(rendersScreenSearch("<!-- <ScreenSearch /> -->")).toBe(false);
    expect(rendersScreenSearch("<ScreenSearch />")).toBe(true);
  });

  it("hides the markup's components from the script block", () => {
    // The import names the component; only rendering it counts as having one.
    const source = '<script>\n  import ScreenSearch from "x";\n</script>\n<div />';
    expect(rendersScreenSearch(source)).toBe(false);
  });

  it("does not mistake a longer name for the control", () => {
    expect(rendersScreenSearch("<ScreenSearchPanel />")).toBe(false);
  });
});

describe("workspaceDestinations", () => {
  const REGISTRY = `
  {
    id: "matters",
    label: "Matters",
    href: "/matters",
    icon: FolderOpen,
    description: "Every matter the firm holds.",
    group: "work",
    shipped: true,
  },
  {
    id: "forms",
    label: "Forms",
    href: "/forms",
    group: "work",
    shipped: false,
  },
  {
    id: "billing",
    label: "Billing",
    href: "/billing",
    group: "money",
    shipped: true,
  },`;

  it("reads only the Workspace group, keeping whether each shipped", () => {
    expect(workspaceDestinations(REGISTRY)).toEqual([
      { id: "matters", label: "Matters", href: "/matters", shipped: true },
      { id: "forms", label: "Forms", href: "/forms", shipped: false },
    ]);
  });
});

describe("coverage", () => {
  it("passes a screen that renders the control", () => {
    const { problems, covered } = audit({ [MATTERS]: SEARCHING_PAGE }, [destination("matters")]);
    expect(problems).toEqual([]);
    expect(covered).toHaveLength(1);
  });

  it("reports a Workspace screen that neither searches nor says why", () => {
    const { problems } = audit({ [MATTERS]: BARE_PAGE }, [destination("matters")]);
    expect(problems.map((problem) => problem.rule)).toEqual(["no-search"]);
    expect(problems[0].message).toContain("neither renders ScreenSearch nor says why");
  });

  it("accepts a recorded decline, and reports it as declining rather than covered", () => {
    const declined = new Map([["matters", "the read takes no query"]]);
    const { problems, declining, covered } = audit(
      { [MATTERS]: BARE_PAGE },
      [destination("matters")],
      declined,
    );
    expect(problems).toEqual([]);
    expect(covered).toEqual([]);
    expect(declining).toEqual([
      { destination: destination("matters"), reason: "the read takes no query" },
    ]);
  });

  it("reports a decline recorded for a screen that HAS the control", () => {
    const declined = new Map([["matters", "stale"]]);
    const { problems } = audit({ [MATTERS]: SEARCHING_PAGE }, [destination("matters")], declined);
    expect(problems.map((problem) => problem.rule)).toEqual(["stale-decline"]);
  });

  it("says nothing about a destination that has not shipped", () => {
    const { problems, covered, declining } = audit({ [MATTERS]: BARE_PAGE }, [
      destination("matters", { shipped: false }),
    ]);
    expect(problems).toEqual([]);
    expect(covered).toEqual([]);
    expect(declining).toEqual([]);
  });
});

describe("coverage follows the render, not the file", () => {
  const LIST = "apps/web/src/lib/matters/task-list.svelte";
  const DEEPER = "apps/web/src/lib/matters/task-controls.svelte";

  it("finds a search a page keeps in the component that owns the list", () => {
    const files = {
      [MATTERS]: `<script>\n  import TaskList from "$lib/matters/task-list.svelte";\n</script>\n<TaskList />`,
      [LIST]: "<ScreenSearch />",
    };
    expect(searchReachableFrom(MATTERS, (path) => files[path] ?? null)).toBe(true);
  });

  it("follows the chain further than one hop", () => {
    const files = {
      [MATTERS]: `<script>\n  import TaskList from "$lib/matters/task-list.svelte";\n</script>`,
      [LIST]: `<script>\n  import Controls from "$lib/matters/task-controls.svelte";\n</script>`,
      [DEEPER]: "<ScreenSearch />",
    };
    expect(searchReachableFrom(MATTERS, (path) => files[path] ?? null)).toBe(true);
  });

  it("terminates on a cycle rather than walking forever", () => {
    const files = {
      [MATTERS]: `<script>\n  import TaskList from "$lib/matters/task-list.svelte";\n</script>`,
      [LIST]: `<script>\n  import Page from "$lib/matters/+page.svelte";\n</script>`,
    };
    // The second file imports back into the first; a visited set is what keeps this returning.
    expect(searchReachableFrom(MATTERS, (path) => files[path] ?? null)).toBe(false);
  });

  it("ignores a `.ts` module, which renders nothing", () => {
    const source = `<script>\n  import { thing } from "$lib/matters/thing.ts";\n  import List from "$lib/matters/list.svelte";\n</script>`;
    expect(libComponentImports(source)).toEqual(["apps/web/src/lib/matters/list.svelte"]);
  });
});

describe("placement", () => {
  it("passes a control inside the header's actions snippet", () => {
    const { problems } = audit({ [MATTERS]: SEARCHING_PAGE }, [destination("matters")]);
    expect(problems).toEqual([]);
  });

  it("reports a control seated in a row of its own under the title", () => {
    const source = `<script>
  import ScreenHeader from "$lib/screen/screen-header.svelte";
</script>
<ScreenHeader title="Matters" />
<div class="filters">
  <ScreenSearch />
</div>`;
    const { problems } = audit({ [MATTERS]: source }, [destination("matters")]);
    expect(problems.map((problem) => problem.rule)).toEqual(["placement"]);
    expect(problems[0].line).toBe(6);
  });

  it("measures against an actions snippet that holds its own block", () => {
    const source = `<script>
  import ScreenHeader from "$lib/screen/screen-header.svelte";
</script>
<ScreenHeader title="Matters">
  {#snippet actions()}
    {#if ready}
      <ScreenSearch />
    {/if}
  {/snippet}
</ScreenHeader>`;
    // A lazily-matched snippet body would end at the `{/if}` and read the control as outside it.
    const { problems } = audit({ [MATTERS]: source }, [destination("matters")]);
    expect(problems).toEqual([]);
  });

  it("says nothing about a file that renders no screen header", () => {
    // A component that owns a list holds its search for the screen to seat; only the file that
    // renders the header can be judged on where the control sits in it.
    const source = "<div>\n  <ScreenSearch />\n</div>";
    const { problems } = audit({ [MATTERS]: source }, [destination("matters")]);
    expect(problems).toEqual([]);
  });
});

describe("no second implementation", () => {
  it("reports a hand-rolled field", () => {
    const source = `<script>\n  import ScreenSearch from "x";\n</script>\n<ScreenSearch />\n<input type="search" />`;
    const { problems } = audit({ [MATTERS]: source }, [destination("matters")]);
    expect(problems.map((problem) => problem.rule)).toEqual(["hand-rolled-field"]);
    expect(problems[0].line).toBe(5);
  });

  it("reports a hand-rolled glyph, which is the half that opens the field", () => {
    const source = `<script>
  import Search from "@lucide/svelte/icons/search";
  import ScreenSearch from "x";
</script>
<ScreenSearch />`;
    const { problems } = audit({ [MATTERS]: source }, [destination("matters")]);
    expect(problems.map((problem) => problem.rule)).toEqual(["hand-rolled-glyph"]);
  });

  it("does not report either shape written inside a comment", () => {
    const source = `<script>
  /* A previous version imported "@lucide/svelte/icons/search" here. */
  import ScreenSearch from "x";
</script>
<!-- and drew its own <input type="search" /> -->
<ScreenSearch />`;
    const { problems } = audit({ [MATTERS]: source }, [destination("matters")]);
    expect(problems).toEqual([]);
  });
});

describe("offsets", () => {
  it("counts lines from the original source, not the blanked copy", () => {
    const source = "a\nb\nc";
    expect(lineOf(source, 0)).toBe(1);
    expect(lineOf(source, 4)).toBe(3);
  });

  it("locates every control in a file", () => {
    const markup = markupOf("<ScreenSearch />\n<div />\n<ScreenSearch />");
    expect(screenSearchTags(markup)).toHaveLength(2);
  });

  it("finds each actions snippet's body", () => {
    const markup = markupOf(
      "{#snippet actions()}<A />{/snippet}\n{#snippet actions()}<B />{/snippet}",
    );
    expect(actionsSnippets(markup)).toHaveLength(2);
  });
});
