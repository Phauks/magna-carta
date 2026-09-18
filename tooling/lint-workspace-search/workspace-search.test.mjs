import { describe, expect, it } from "vitest";
import {
  actionsSnippets,
  auditWorkspaceSearch,
  libComponentImports,
  lineOf,
  listRootSnippets,
  markupOf,
  namesSearchState,
  rendersScreenSearch,
  screenSearchTags,
  searchReachableFrom,
  secondResultsSurfaces,
  svelteBlocks,
  withoutComments,
  workspaceDestinations,
} from "./workspace-search.mjs";

const MATTERS = "apps/web/src/routes/(app)/matters/+page.svelte";
const DIRECTORY = "apps/web/src/routes/(app)/directory/+page.svelte";

/** A Workspace destination, shipped unless said otherwise. */
function destination(id, overrides = {}) {
  return { id, label: id, href: `/${id}`, shipped: true, ...overrides };
}

/**
 * Audits a set of files as though each destination's page were the file of the same name. `files`
 * maps a repository-relative path to its source.
 */
function audit(files, destinations, declined = new Map(), allowedSecondSurface = new Map()) {
  const paths = Object.keys(files);
  return auditWorkspaceSearch({
    destinations,
    pageOf: (href) => paths.find((path) => path.includes(`/${href.slice(1)}/`)) ?? null,
    read: (path) => files[path] ?? null,
    screenFiles: paths.map((path) => ({ path, source: files[path] })),
    declined,
    allowedSecondSurface,
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

  // Both Workspace groups and neither of the others: the rail split `top` into `desk` and `work`
  // on 2026-09-16, and a fixture still written in the old vocabulary asks this parser nothing.
  it("reads only the Workspace groups, keeping whether each shipped", () => {
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

/*
 * The Directory as it stood on 2026-09-17, reduced to the shape the owner corrected: a snippet
 * drawing a table of hits, rendered while a query is live, standing where the screen's own grid
 * would be. Both tables are reached through the SAME snippet — once for the answer and once for the
 * loading placeholder — which is why rule 4 has to follow a `{@render}` to see either of them.
 */
const DIRECTORY_SWAP = `<script>
  import * as DataTable from "@magna-carta/design-system/data-table";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
</script>

{#snippet hitTable(rows)}
  <DataTable.Root>
    <DataTable.Header>
      <DataTable.Row>
        <DataTable.Head>Name</DataTable.Head>
        <DataTable.Head>Kind</DataTable.Head>
      </DataTable.Row>
    </DataTable.Header>
  </DataTable.Root>
{/snippet}

<ScreenSearch bind:value={typed} onsearch={(next) => (asked = next)} />

{#if searching}
  <LoadingRegion loading={hits === null}>
    {#snippet fixture()}
      {@render hitTable(HIT_FIXTURE)}
    {/snippet}
    {@render hitTable(hits ?? [])}
  </LoadingRegion>
{:else if listFailure !== null}
  <FailureNotice failure={listFailure} />
{:else}
  <DataTable.Grid {grid} cell={directoryCell} />
  <DataTable.GridFooter {grid} />
{/if}`;

/** The docket: the query goes to the read, and the one grid shows what came back. */
const DOCKET = `<script>
  import * as DataTable from "@magna-carta/design-system/data-table";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
</script>

<ScreenSearch bind:value={searchText} onsearch={(next) => (appliedSearch = next)} />

{#if loadFailure !== null}
  <FailureNotice failure={loadFailure} />
{:else}
  <DataTable.Grid {grid} cell={matterCell} loading={records === null} />
  <DataTable.GridFooter {grid} />
{/if}`;

describe("no second results surface", () => {
  it("reports the shape the Directory shipped: the hits over the query, the grid under the else", () => {
    const { problems } = audit({ [DIRECTORY]: DIRECTORY_SWAP }, [destination("directory")]);
    expect(problems.map((problem) => problem.rule)).toEqual(["second-results-surface"]);
    expect(problems[0].line).toBe(19);
    expect(problems[0].message).toContain("searches the list it already shows");
  });

  it("passes the docket, which narrows the one grid it already shows", () => {
    const { problems } = audit({ [MATTERS]: DOCKET }, [destination("matters")]);
    expect(problems).toEqual([]);
  });

  it("passes a search whose answer opens in the control's own panel", () => {
    // The sanctioned exception, and it needs no exemption: a matter has no single list to narrow,
    // so its search reaches everything on the matter through ScreenSearch's downward panel. A panel
    // belongs to the control; it is not a table standing where a list was.
    const source = `<script>
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import MatterSearchResults from "$lib/matters/matter-search-results.svelte";
</script>

<ScreenSearch bind:value={typed} onsearch={run}>
  {#snippet panel()}
    <div class="settings">Everything on this matter</div>
    {#if hasQuery}
      <MatterSearchResults answer={search.answer} />
    {/if}
  {/snippet}
</ScreenSearch>`;
    const { problems } = audit({ [MATTERS]: source }, [destination("matters")]);
    expect(problems).toEqual([]);
  });

  it("does not count a loading region's fixture, which is the same table drawn as a placeholder", () => {
    const source = `<script>
  import * as DataTable from "@magna-carta/design-system/data-table";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
</script>

<ScreenSearch bind:value={searchText} onsearch={(next) => (appliedSearch = next)} />

<LoadingRegion loading={items === null}>
  {#snippet fixture()}
    <DataTable.Root>{@render shelfHead()}</DataTable.Root>
  {/snippet}
  {#if narrowed.length === 0 && appliedSearch !== ""}
    <EmptyState title="Nothing Matches That Search" />
  {:else}
    <DataTable.Root>{@render shelfHead()}</DataTable.Root>
  {/if}
</LoadingRegion>`;
    const { problems } = audit({ [MATTERS]: source }, [destination("matters")]);
    expect(problems).toEqual([]);
  });

  it("does not report a screen that narrows to a sentence, which is one list and an empty state", () => {
    const source = `<script>
  import * as DataTable from "@magna-carta/design-system/data-table";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
</script>

<ScreenSearch bind:value={query} onsearch={(next) => (appliedQuery = next)} />

{#if visible.length === 0 && searching}
  <EmptyState title="Nothing Matches That" />
{:else if visible.length === 0}
  <EmptyState title="Nothing Here" />
{:else}
  <DataTable.Grid {grid} />
{/if}`;
    const { problems } = audit({ [MATTERS]: source }, [destination("matters")]);
    expect(problems).toEqual([]);
  });

  it("reports the same swap assembled from two conditionals instead of one", () => {
    const source = `<script>
  import * as DataTable from "@magna-carta/design-system/data-table";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
</script>

<ScreenSearch bind:value={typed} onsearch={(next) => (asked = next)} />

{#if searching}
  <DataTable.Root><DataTable.Body /></DataTable.Root>
{/if}

{#if !searching}
  <DataTable.Grid {grid} />
{/if}`;
    const { problems } = audit({ [MATTERS]: source }, [destination("matters")]);
    expect(problems.map((problem) => problem.rule)).toEqual([
      "second-results-surface",
      "second-results-surface",
    ]);
  });

  it("says nothing about a file that does not hold the search itself", () => {
    // The query's state and the branch reading it are written together, so a file with no control
    // is a file rule 4 has nothing to say about — and the coverage rule judges the screen.
    const withoutControl = DIRECTORY_SWAP.replace(/<ScreenSearch[\s\S]*?\/>/u, "<div />").replace(
      /import ScreenSearch.*\n/u,
      "",
    );
    const { problems } = audit({ [MATTERS]: DOCKET, [DIRECTORY]: withoutControl }, [
      destination("matters"),
    ]);
    expect(problems).toEqual([]);
  });

  it("accepts a recorded allowance, and lists it rather than reporting it", () => {
    const allowed = new Map([[DIRECTORY, "the screen has no single list to narrow"]]);
    const { problems, allowing } = audit(
      { [DIRECTORY]: DIRECTORY_SWAP },
      [destination("directory")],
      new Map(),
      allowed,
    );
    expect(problems).toEqual([]);
    expect(allowing).toEqual([
      { file: DIRECTORY, reason: "the screen has no single list to narrow" },
    ]);
  });

  it("reports an allowance left standing after the screen began searching in place", () => {
    const allowed = new Map([[MATTERS, "stale"]]);
    const { problems } = audit({ [MATTERS]: DOCKET }, [destination("matters")], new Map(), allowed);
    expect(problems.map((problem) => problem.rule)).toEqual(["stale-second-surface"]);
  });
});

describe("the block walk rule 4 reads the markup with", () => {
  it("reads an if chain's branches, the else included", () => {
    const markup = markupOf(
      "{#if searching}\n<A />\n{:else if failed}\n<B />\n{:else}\n<C />\n{/if}",
    );
    const chain = svelteBlocks(markup).find((block) => block.branches !== undefined);
    expect(chain.branches).toHaveLength(3);
    expect(chain.branches.map((branch) => branch.condition)).toEqual([
      "{#if searching",
      "{:else if failed",
      null,
    ]);
  });

  it("keeps a nested block's closer from ending the branch it sits in", () => {
    const markup = markupOf(
      "{#if searching}\n{#each rows as row}\n<A />\n{/each}\n<DataTable.Root />\n{/if}",
    );
    const chain = svelteBlocks(markup).find((block) => block.branches !== undefined);
    // A lazily-matched branch would end at the `{/each}` and miss the table after it.
    expect(markup.slice(chain.branches[0].start, chain.branches[0].end)).toContain(
      "DataTable.Root",
    );
  });

  it("follows a snippet that only renders another snippet", () => {
    const markup = markupOf(
      "{#snippet hitTable()}<DataTable.Root />{/snippet}\n{#snippet fixture()}{@render hitTable()}{/snippet}",
    );
    expect(
      [...listRootSnippets(markup)].toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(["fixture", "hitTable"]);
  });

  it("reads a condition as about the query only when it names one", () => {
    expect(namesSearchState("{#if searching")).toBe(true);
    expect(namesSearchState('{#if appliedQuery.trim() !== ""')).toBe(true);
    expect(namesSearchState("{#if hits !== null")).toBe(true);
    expect(namesSearchState("{#if loadFailure !== null")).toBe(false);
    expect(namesSearchState(null)).toBe(false);
  });

  it("finds no swap in a file with no conditional at all", () => {
    expect(secondResultsSurfaces("<ScreenSearch />\n<DataTable.Grid {grid} />")).toEqual([]);
  });
});
