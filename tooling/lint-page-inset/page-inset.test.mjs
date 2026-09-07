/*
 * What the page-inset scan must and must not say. Every case here is a real shape from the route
 * tree, stated as a string: the three screens that carried a second inset, and the ones whose
 * spacing is legitimate and must never be flagged.
 */
import { describe, expect, it } from "vitest";
import {
  auditPageInset,
  classTokensOf,
  readSurface,
  rendersIntoSurface,
  topLevelElements,
} from "./page-inset.mjs";

const SHELL_LAYOUT = "apps/web/src/routes/(app)/+layout.svelte";

/** The App Shell as it stands: a padded, block-flow work surface. */
const SHELL = `<main class="mc-scrollbar relative grow overflow-y-auto rounded-ss-lg p-24">
  {@render children()}
</main>`;

const screen = (path, source) => ({ path, source });
const shellLayout = screen(SHELL_LAYOUT, "<AppShell>{@render children()}</AppShell>");

function audit(files, shellSource = SHELL) {
  return auditPageInset({ files: [shellLayout, ...files], shellSource, shellLayout: SHELL_LAYOUT });
}

describe("reading the markup a screen places", () => {
  it("finds a top-level element behind a leading <svelte:head>", () => {
    const found = topLevelElements(`<svelte:head><title>Tasks</title></svelte:head>

<div class="flex h-full flex-col gap-16">
  <ScreenHeader title="Tasks" />
</div>`);
    expect(found.map((element) => element.name)).toEqual(["svelte:head", "div"]);
    expect(found[1].classes).toContain("gap-16");
  });

  it("does not stop at the `>` inside an event handler", () => {
    // A tag holding `() => close()` used to end at that arrow, and everything after it read as
    // top-level markup.
    const found = topLevelElements(`<div class="p-24">
  <Button onclick={() => (open = true)}>Open</Button>
</div>
<Dialog bind:open />`);
    expect(found.map((element) => element.name)).toEqual(["div", "Dialog"]);
  });

  it("reads a type argument in a snippet header as a type, not as an unclosed tag", () => {
    // The time sheet's cell snippet. Read as a tag, `<TimeEntrySummary>` swallowed the rest of the
    // screen and the scan reported it clean — the failure this case exists to keep out.
    const found = topLevelElements(`{#snippet cell({ row }: GridCellContext<TimeEntrySummary>)}
  <span class="p-24">{row.name}</span>
{/snippet}

<div class="flex h-full flex-col gap-16 p-24">
  <ScreenHeader title="Time" />
</div>`);
    expect(found.map((element) => element.name)).toEqual(["div"]);
    expect(found[0].line).toBe(5);
  });

  it("counts an element inside a top-level {#if} as top level, because it is", () => {
    const found = topLevelElements(`{#if ready}
  <div class="p-24">Ready</div>
{/if}`);
    expect(found.map((element) => element.name)).toEqual(["div"]);
  });

  it("takes no classes from a fully dynamic class expression", () => {
    expect(classTokensOf(`<div class={narrow ? "p-24" : "p-0"}>`)).toEqual([]);
  });
});

describe("which screens the rule reaches", () => {
  const layouts = [
    SHELL_LAYOUT,
    "apps/web/src/routes/(app)/matters/[id]/+layout.svelte",
    "apps/web/src/routes/(app)/settings/+layout.svelte",
  ];
  const reaches = (file) => rendersIntoSurface(file, { layouts, shellLayout: SHELL_LAYOUT });

  it("reaches a screen sitting directly in the group", () => {
    expect(reaches("apps/web/src/routes/(app)/tasks/+page.svelte")).toBe(true);
  });

  it("reaches a nested layout, which is itself a child of <main>", () => {
    expect(reaches("apps/web/src/routes/(app)/matters/[id]/+layout.svelte")).toBe(true);
  });

  it("does not reach a page under that nested layout, whose frame is the layout's", () => {
    expect(reaches("apps/web/src/routes/(app)/matters/[id]/tasks/+page.svelte")).toBe(false);
    expect(reaches("apps/web/src/routes/(app)/settings/billing/+page.svelte")).toBe(false);
  });

  it("does not reach the layout that renders the shell", () => {
    expect(reaches(SHELL_LAYOUT)).toBe(false);
  });
});

describe("the second inset", () => {
  it("catches the wrapper the three screens carried", () => {
    const { problems } = audit([
      screen(
        "apps/web/src/routes/(app)/tasks/+page.svelte",
        `<div class="flex min-h-0 flex-1 flex-col gap-16 p-24"><ScreenHeader title="Tasks" /></div>`,
      ),
    ]);
    expect(problems.map((problem) => problem.rule)).toEqual(["second-inset", "inert-grow"]);
    expect(problems[0].utility).toBe("p-24");
  });

  it("catches a whole axis, which insets from both edges just as surely", () => {
    const { problems } = audit([
      screen("apps/web/src/routes/(app)/x/+page.svelte", `<div class="px-24">x</div>`),
    ]);
    expect(problems.map((problem) => problem.utility)).toEqual(["px-24"]);
  });

  it("catches it under a responsive variant", () => {
    const { problems } = audit([
      screen("apps/web/src/routes/(app)/x/+page.svelte", `<div class="sm:p-24">x</div>`),
    ]);
    expect(problems.map((problem) => problem.utility)).toEqual(["sm:p-24"]);
  });

  it("leaves a one-sided padding against a border alone", () => {
    // The home screen's closing quote: `pt-12` off its own `border-t` is spacing between the things
    // on the screen, not a second inset.
    const { problems } = audit([
      screen(
        "apps/web/src/routes/(app)/home/+page.svelte",
        `<ScreenHeader title="Home" />
<footer class="mt-40 border-t border-border-default pt-12">A quote</footer>`,
      ),
    ]);
    expect(problems).toEqual([]);
  });

  it("leaves padding INSIDE the screen alone, however deep the wrapper", () => {
    const { problems } = audit([
      screen(
        "apps/web/src/routes/(app)/x/+page.svelte",
        `<div class="flex h-full flex-col gap-16">
  <section class="rounded-lg bg-surface-raised p-24">A card</section>
</div>`,
      ),
    ]);
    expect(problems).toEqual([]);
  });

  it("says nothing about a screen under a nested layout", () => {
    const { problems } = audit([
      screen("apps/web/src/routes/(app)/matters/[id]/+layout.svelte", `<div class="flex">x</div>`),
      screen(
        "apps/web/src/routes/(app)/matters/[id]/tasks/+page.svelte",
        `<div class="p-24">x</div>`,
      ),
    ]);
    expect(problems).toEqual([]);
  });

  it("does not mistake a class that merely starts with p for padding", () => {
    const { problems } = audit([
      screen(
        "apps/web/src/routes/(app)/x/+page.svelte",
        `<div class="mc-panel place-items-center">x</div>`,
      ),
    ]);
    expect(problems).toEqual([]);
  });
});

describe("the inert grow", () => {
  it("catches flex-1 at the top level of a block work surface", () => {
    const { problems } = audit([
      screen(
        "apps/web/src/routes/(app)/x/+page.svelte",
        `<div class="flex min-h-0 flex-1 flex-col">x</div>`,
      ),
    ]);
    expect(problems.map((problem) => problem.rule)).toEqual(["inert-grow"]);
  });

  it("says nothing where <main> lays its children out, because then it means something", () => {
    const flexShell = `<main class="flex grow flex-col overflow-y-auto p-24">{@render children()}</main>`;
    const { problems } = audit(
      [screen("apps/web/src/routes/(app)/x/+page.svelte", `<div class="flex-1">x</div>`)],
      flexShell,
    );
    expect(problems).toEqual([]);
  });

  it("leaves h-full alone, which is what a full-height screen should say", () => {
    const { problems } = audit([
      screen(
        "apps/web/src/routes/(app)/x/+page.svelte",
        `<div class="flex h-full min-h-0 flex-col">x</div>`,
      ),
    ]);
    expect(problems).toEqual([]);
  });
});

describe("the premises the rules stand on", () => {
  it("reads the inset and the flow off the shell rather than assuming them", () => {
    expect(readSurface(SHELL)).toEqual({ inset: "p-24", laysOutChildren: false });
    expect(readSurface(`<main class="flex grow p-16">x</main>`).laysOutChildren).toBe(true);
  });

  it("refuses to enforce rule 1 once <main> stops drawing the inset", () => {
    const { premiseProblem, problems } = audit(
      [screen("apps/web/src/routes/(app)/x/+page.svelte", `<div class="p-24">x</div>`)],
      `<main class="grow overflow-y-auto">{@render children()}</main>`,
    );
    expect(premiseProblem).toMatch(/no longer draws a page inset/);
    expect(problems).toEqual([]);
  });

  it("says so when it cannot find <main> at all", () => {
    const { premiseProblem } = audit([], `<div>{@render children()}</div>`);
    expect(premiseProblem).toBe("it has no <main> element");
  });
});
