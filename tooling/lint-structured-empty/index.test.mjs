/*
 * Each rule, proved against known-bad input.
 *
 * A fitness function that has never been shown to fail is a fitness function nobody can trust: the
 * scan can drift into vacuity (a renamed tag, a parser that stopped following a block) and go on
 * printing its cheerful line forever. So every rule here is exercised on source that must pass and
 * on source that must not — and on the shapes that would make it cry wolf, because that is the
 * failure mode that gets a gate switched off.
 */
import { describe, expect, it } from "vitest";
import {
  allowancesIn,
  auditFile,
  isLooseProse,
  markupOf,
  parseMarkup,
  standsInForAbsence,
  structuresUnder,
} from "./structured-empty.mjs";

const FILE = "apps/web/src/lib/example/example.svelte";
const rules = (source) => auditFile(FILE, source).problems.map((problem) => problem.rule);
const lines = (source) => auditFile(FILE, source).problems.map((problem) => problem.line);

describe("markupOf", () => {
  it("preserves offsets so a reported line is the real one", () => {
    const source =
      '<script>\n  const a = 1;\n</script>\n<!-- x -->\n<p class="text-text-muted">y</p>';
    expect(markupOf(source)).toHaveLength(source.length);
    expect(markupOf(source).split("\n")).toHaveLength(source.split("\n").length);
  });

  it("hides a structure mentioned inside a comment or the script block", () => {
    const source = "<script>const a = '<EventRail />';</script>\n<!-- <dl></dl> -->\n<p>x</p>";
    expect(structuresUnder(parseMarkup(markupOf(source)).children)).toEqual([]);
  });
});

describe("parseMarkup", () => {
  it("follows a block through its branches and a tag through an attribute holding a brace", () => {
    const tree = parseMarkup(
      '{#if rows.length === 0}<p>none</p>{:else}<DataTable.Grid grid={g} caption=">" />{/if}',
    );
    expect(tree.children).toHaveLength(1);
    const [block] = tree.children;
    expect(block.kind).toBe("if");
    expect(block.branches.map((branch) => branch.label)).toEqual(["if", "else"]);
    expect(block.branches[0].condition).toBe("rows.length === 0");
    expect(block.branches[1].children.map((node) => node.name)).toEqual(["DataTable.Grid"]);
  });

  it("does not let a tag close across a block boundary", () => {
    const tree = parseMarkup("<div>{#if a}<p>x</p>{/if}</div>");
    const [div] = tree.children;
    expect(div.name).toBe("div");
    expect(div.children[0].type).toBe("block");
  });
});

describe("isLooseProse", () => {
  const children = (markup) => parseMarkup(markup).children;

  it("is a paragraph, a bare text node, or a div holding only text", () => {
    expect(isLooseProse(children("<p>Nothing yet.</p>"))).toBe(true);
    expect(isLooseProse(children("Nothing yet."))).toBe(true);
    expect(isLooseProse(children('<div class="p-12"><p>{message}</p></div>'))).toBe(true);
  });

  it("is not a component, a control, or nothing at all", () => {
    expect(isLooseProse(children('<EmptyState title="Nothing yet" />'))).toBe(false);
    expect(isLooseProse(children("<p><Info /> Nothing yet.</p>"))).toBe(false);
    expect(isLooseProse(children("   \n  "))).toBe(false);
    expect(isLooseProse(children("{@render empty()}"))).toBe(false);
  });

  it("is not a spacer holding only a non-breaking space", () => {
    expect(isLooseProse(children('<p class="text-sm text-text-muted">&nbsp;</p>'))).toBe(false);
  });
});

describe("standsInForAbsence", () => {
  const branchesOf = (markup) => parseMarkup(markup).children[0].branches;

  it("reads absence off the branch's own condition", () => {
    const [empty, rest] = branchesOf("{#if rows.length === 0}a{:else}b{/if}");
    expect(standsInForAbsence(empty)).toBe(true);
    expect(standsInForAbsence(rest)).toBe(true); // a bare else inherits the chain
    const [kind] = branchesOf('{#if section.kind === "text"}a{:else}b{/if}');
    expect(standsInForAbsence(kind)).toBe(false);
  });

  it("treats an each's else as absence by definition, and a build flag as not", () => {
    const [, eachElse] = branchesOf("{#each rows as row}a{:else}b{/each}");
    expect(standsInForAbsence(eachElse)).toBe(true);
    const [, devElse] = branchesOf("{#if dev}a{:else}b{/if}");
    expect(standsInForAbsence(devElse)).toBe(false);
  });
});

describe("loose-empty-branch", () => {
  it("bites on a paragraph standing where the table would", () => {
    const source = `
{#if rows.length === 0}
  <p class="text-sm text-text-muted">No rows yet.</p>
{:else}
  <DataTable.Grid grid={grid} caption="Rows" />
{/if}`;
    expect(rules(source)).toEqual(["loose-empty-branch"]);
    expect(lines(source)).toEqual([3]);
  });

  it("bites on the each-with-else cousin and the await cousin", () => {
    expect(
      rules("{#each rows as row}<EventRail events={row.events} />{:else}<p>Nothing.</p>{/each}"),
    ).toEqual(["loose-empty-branch"]);
    expect(rules("{#await read}<p>Reading.</p>{:then rows}<dl><dt>a</dt></dl>{/await}")).toEqual([
      "loose-empty-branch",
    ]);
  });

  it("bites on every prose branch of a chain, and names the structure", () => {
    const source = `
{#if rows === null}
  <p>Reading.</p>
{:else if rows.length === 0}
  <p>Nothing recorded.</p>
{:else}
  <EventRail events={rows} />
{/if}`;
    const { problems } = auditFile(FILE, source);
    expect(problems).toHaveLength(2);
    expect(problems[0].detail).toContain("EventRail");
    expect(problems[0].detail).toContain("emptyMessage");
  });

  it("finds the structure however deep the other branch buries it", () => {
    const source = `
{#if rows.length === 0}
  <p>None.</p>
{:else}
  <LoadingRegion loading={false}>
    <div class="flex"><dl><dt>a</dt><dd>b</dd></dl></div>
  </LoadingRegion>
{/if}`;
    expect(rules(source)).toEqual(["loose-empty-branch"]);
  });

  it("passes when the other branch is a component rather than prose", () => {
    expect(
      rules('{#if rows.length === 0}<EmptyState title="None" />{:else}<dl></dl>{/if}'),
    ).toEqual([]);
    expect(
      rules("{#if failure}<FailureNotice {failure} />{:else}<EventRail events={rows} />{/if}"),
    ).toEqual([]);
  });

  it("passes when neither branch renders a structure", () => {
    expect(rules("{#if a}<p>one</p>{:else}<p>two</p>{/if}")).toEqual([]);
    expect(rules("{#if a}<p>one</p>{:else}<ul><li>two</li></ul>{/if}")).toEqual([]);
  });

  it("passes on a discriminated union, a build flag and a spacer", () => {
    expect(
      rules(
        '{#if section.kind === "fields"}<dl></dl>{:else if section.kind === "text"}<p>{section.text}</p>{/if}',
      ),
    ).toEqual([]);
    expect(
      rules("{#if dev}<DataTable.Grid grid={g} />{:else}<p>Development only.</p>{/if}"),
    ).toEqual([]);
    expect(
      rules(
        '{#if record === null && !reading}<p class="text-text-muted">&nbsp;</p>{:else}<dl></dl>{/if}',
      ),
    ).toEqual([]);
  });

  it("passes on prose inside the structure's own body", () => {
    expect(
      rules("<dl>{#each facts as fact}<dt>{fact.label}</dt>{:else}<p>Nothing.</p>{/each}</dl>"),
    ).toEqual([]);
  });
});

describe("prose-after-structure", () => {
  it("bites on a muted paragraph beneath a rail in the same block", () => {
    const source = `
<EventRail events={events} label="History" />
<p class="mt-16 text-xs text-text-muted">Every record here was written down by whoever took the call.</p>`;
    expect(rules(source)).toEqual(["prose-after-structure"]);
    expect(lines(source)).toEqual([3]);
  });

  it("bites beneath a definition list and beneath a table", () => {
    expect(
      rules('<dl><dt>a</dt><dd>b</dd></dl>\n<p class="text-xs text-text-subtle">Approximate.</p>'),
    ).toEqual(["prose-after-structure"]);
    expect(
      rules('<DataTable.Root></DataTable.Root>\n<p class="text-text-muted">Note.</p>'),
    ).toEqual(["prose-after-structure"]);
  });

  it("passes when the paragraph is not muted, is not next, or is in another block", () => {
    expect(rules('<dl></dl>\n<p class="text-sm">A fact of the result.</p>')).toEqual([]);
    expect(rules('<dl></dl>\n<Button>Act</Button>\n<p class="text-text-muted">Note.</p>')).toEqual(
      [],
    );
    expect(rules('<dl></dl>\n{#if x}<p class="text-text-muted">Note.</p>{/if}')).toEqual([]);
    expect(rules('{#if x}<dl></dl>{/if}\n<p class="text-text-muted">Note.</p>')).toEqual([]);
  });

  it("passes on prose before the structure", () => {
    expect(rules('<p class="text-text-muted">Note.</p>\n<dl></dl>')).toEqual([]);
  });
});

describe("table-behind-absence", () => {
  it("bites on the uploads shape: an EmptyState where the register's table would stand", () => {
    const source = `
{#if batches.length === 0 && remembered.length === 0}
  <EmptyState title="No Uploads" />
{:else}
  <div class="flex flex-col gap-24">
    <section aria-label="Earlier">
      <DataTable.Root><DataTable.Header /><DataTable.Body /></DataTable.Root>
    </section>
  </div>
{/if}`;
    expect(rules(source)).toEqual(["table-behind-absence"]);
    expect(lines(source)).toEqual([3]);
  });

  it("bites on every absence branch of a chain, the search-empty one included", () => {
    const source = `
{#if shown.length === 0 && query !== ""}
  <EmptyState title="Nothing Matches That Search" />
{:else if shown.length === 0}
  <EmptyState title="No Downloads" />
{:else}
  <DataTable.Root><DataTable.Body /></DataTable.Root>
{/if}`;
    expect(rules(source)).toEqual(["table-behind-absence", "table-behind-absence"]);
    expect(lines(source)).toEqual([3, 5]);
  });

  it("bites on the downloads shape: an emptyState snippet replacing the region's table", () => {
    const source = `
{#snippet shelfHead()}
  <DataTable.Header><DataTable.Row><DataTable.Head>Name</DataTable.Head></DataTable.Row></DataTable.Header>
{/snippet}
<LoadingRegion loading={items === null} empty={items !== null && items.length === 0} label="Reading">
  {#snippet emptyState()}
    <EmptyState title="No Downloads" />
  {/snippet}
  <DataTable.Root>{@render shelfHead()}</DataTable.Root>
</LoadingRegion>`;
    expect(rules(source)).toEqual(["table-behind-absence"]);
    expect(lines(source)).toEqual([7]);
  });

  it("follows the table through a snippet the region only RENDERS, and through a second one", () => {
    const source = `
{#snippet head()}<DataTable.Header />{/snippet}
{#snippet shelf()}<DataTable.Root>{@render head()}</DataTable.Root>{/snippet}
<LoadingRegion loading={false} empty={rows.length === 0} label="Reading">
  {#snippet emptyState()}<EmptyState title="Nothing" />{/snippet}
  {@render shelf()}
</LoadingRegion>`;
    expect(rules(source)).toEqual(["table-behind-absence"]);
  });

  it("bites on prose in an emptyState snippet, which no other rule can see", () => {
    const source = `
<LoadingRegion loading={false} empty={scans.length === 0} label="Reading">
  {#snippet emptyState()}
    <p class="text-sm text-text-muted">No check has been recorded yet.</p>
  {/snippet}
  <DataTable.Grid grid={grid} caption="Checks" />
</LoadingRegion>`;
    expect(rules(source)).toEqual(["table-behind-absence"]);
  });

  it("passes when the table renders its header over an empty body with the words inside", () => {
    const source = `
<DataTable.Root>
  <DataTable.Header><DataTable.Row><DataTable.Head>Name</DataTable.Head></DataTable.Row></DataTable.Header>
  <DataTable.Body>
    {#each rows as row (row.id)}
      <DataTable.Row><DataTable.Cell>{row.name}</DataTable.Cell></DataTable.Row>
    {:else}
      <DataTable.EmptyRow columns={1} title="No Downloads" />
    {/each}
  </DataTable.Body>
</DataTable.Root>`;
    expect(rules(source)).toEqual([]);
  });

  it("passes on a failure standing where the table would, in a branch or in a snippet", () => {
    expect(
      rules("{#if readFailure !== null}<FailureNotice {failure} />{:else}<DataTable.Root />{/if}"),
    ).toEqual([]);
    expect(
      rules(`
<LoadingRegion loading={false} failed={failure !== null} label="Reading">
  {#snippet failure()}
    <FailureNotice failure={readFailure} onRetry={retry} />
  {/snippet}
  <DataTable.Grid grid={grid} caption="Rows" />
</LoadingRegion>`),
    ).toEqual([]);
  });

  it("passes on a permission refusal, which is not an absence of data", () => {
    expect(
      rules(
        '{#if !mayReadLedger}<EmptyState title="Not Yours To Read" />{:else}<table></table>{/if}',
      ),
    ).toEqual([]);
    expect(
      rules(
        '{#if permissionRefusal !== null}<EmptyState title="Refused" />{:else}<DataTable.Grid grid={g} />{/if}',
      ),
    ).toEqual([]);
  });

  it("passes when the branch swapped in is not about absence, and when neither holds a table", () => {
    expect(
      rules(
        '{#if section.kind === "note"}<EmptyState title="A note" />{:else}<DataTable.Root />{/if}',
      ),
    ).toEqual([]);
    expect(
      rules(
        '{#if rows.length === 0}<EmptyState title="None" />{:else}<EventRail events={rows} />{/if}',
      ),
    ).toEqual([]);
  });

  it("passes on a fixture snippet, which is the shape rather than the absence", () => {
    expect(
      rules(`
<LoadingRegion loading={rows === null} label="Reading">
  {#snippet fixture()}<DataTable.Root><DataTable.Body /></DataTable.Root>{/snippet}
  <DataTable.Root><DataTable.Body /></DataTable.Root>
</LoadingRegion>`),
    ).toEqual([]);
  });

  it("takes the allowance, like every other rule here", () => {
    const source = `
{#if row === null}
  <!-- structured-empty-allow: nothing is selected, which is not a table waiting to fill -->
  <EmptyState title="Select a file" />
{:else}
  <DataTable.Root><DataTable.Body /></DataTable.Root>
{/if}`;
    const { problems, excused } = auditFile(FILE, source);
    expect(problems).toEqual([]);
    expect(excused.map(({ problem }) => problem.rule)).toEqual(["table-behind-absence"]);
  });
});

describe("allowances", () => {
  const excusedBranch = `
{#if rows.length === 0}
  <!-- structured-empty-allow: a printed sheet; an empty list on paper is a sentence -->
  <p>Nothing.</p>
{:else}
  <dl></dl>
{/if}`;

  it("reads a comment and the element it excuses", () => {
    const [allowance] = allowancesIn(excusedBranch);
    expect(allowance.reason).toBe("a printed sheet; an empty list on paper is a sentence");
    expect(excusedBranch.slice(allowance.excuses, allowance.excuses + 3)).toBe("<p>");
  });

  it("excuses the finding immediately after it, and reports the allowance as standing", () => {
    const { problems, excused } = auditFile(FILE, excusedBranch);
    expect(problems).toEqual([]);
    expect(excused).toHaveLength(1);
    expect(excused[0].problem.rule).toBe("loose-empty-branch");
  });

  it("bites on an allowance with no reason", () => {
    const source = excusedBranch.replace(
      "a printed sheet; an empty list on paper is a sentence",
      "  ",
    );
    expect(rules(source)).toEqual(["allowance", "loose-empty-branch"]);
  });

  it("bites on an allowance that excuses nothing", () => {
    const source = "<!-- structured-empty-allow: stale -->\n<p>Nothing to excuse here.</p>";
    const { problems } = auditFile(FILE, source);
    expect(problems.map((problem) => problem.rule)).toEqual(["allowance"]);
    expect(problems[0].detail).toContain("excuses nothing");
  });

  it("does not excuse a finding it is not immediately before", () => {
    const source = `
<!-- structured-empty-allow: too far away -->
<div class="flex"></div>
{#if rows.length === 0}
  <p>Nothing.</p>
{:else}
  <dl></dl>
{/if}`;
    expect(rules(source)).toEqual(["allowance", "loose-empty-branch"]);
  });
});
