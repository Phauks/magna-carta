import { describe, expect, it } from "vitest";
import {
  auditScreenHeaders,
  destinationLabels,
  headerTags,
  literalAttribute,
  markupOf,
  metaSnippets,
  readsAValue,
} from "./screen-headers.mjs";

const DESTINATIONS = new Map([
  ["/notifications", "Notifications"],
  ["/home", "Home"],
  ["/uploads", "Uploads"],
]);

/** Audits one file, with the route path it serves stated outright. */
function audit(
  source,
  { file = "apps/web/src/routes/(app)/notifications/+page.svelte", href = "/notifications" } = {},
) {
  return auditScreenHeaders({
    files: [{ path: file, source }],
    destinations: DESTINATIONS,
    routeHref: () => href,
    exemptions: new Map(),
  });
}

describe("markupOf", () => {
  it("preserves offsets so a reported line is the real one", () => {
    const source = '<script>\n  const a = 1;\n</script>\n<ScreenHeader title="Home" />';
    expect(markupOf(source)).toHaveLength(source.length);
    expect(markupOf(source).split("\n")).toHaveLength(source.split("\n").length);
  });

  it("hides a header mentioned inside a comment or the script block", () => {
    const source = '<!-- <ScreenHeader eyebrow="X" /> -->\n<ScreenHeader title="Home" />';
    expect(headerTags(markupOf(source))).toHaveLength(1);
  });
});

describe("headerTags", () => {
  it("reads the self-closing form and the form with children alike", () => {
    const markup = '<ScreenHeader title="A" />\n<ScreenHeader title="B">\n</ScreenHeader>';
    expect(headerTags(markup).map((tag) => literalAttribute(tag.attributes, "title"))).toEqual([
      "A",
      "B",
    ]);
  });

  it("does not match a component whose name merely starts the same way", () => {
    expect(headerTags('<ScreenHeaderSkeleton title="A" />')).toHaveLength(0);
  });

  it("reports a dynamic title as absent rather than guessing at it", () => {
    const [tag] = headerTags("<ScreenHeader title={matter.title} />");
    expect(literalAttribute(tag.attributes, "title")).toBeNull();
  });
});

describe("metaSnippets", () => {
  it("takes the whole body past a nested block rather than stopping at its close", () => {
    const markup = "{#snippet meta()}{#if a}<span>{x}</span>{/if}{/snippet}";
    expect(metaSnippets(markup)).toHaveLength(1);
    expect(metaSnippets(markup)[0].body).toBe("{#if a}<span>{x}</span>{/if}");
  });

  it("does not mistake the closing tag for an opener (the bug that silenced the rule)", () => {
    const markup = "{#snippet meta()}<span>Fixed prose.</span>{/snippet}";
    expect(metaSnippets(markup)[0].body).toBe("<span>Fixed prose.</span>");
  });
});

describe("readsAValue", () => {
  it("counts an interpolation and a rendered component as reads", () => {
    expect(readsAValue("<span>{today}</span>")).toBe(true);
    expect(readsAValue("{#if a}x{/if}")).toBe(true);
    expect(readsAValue('<MaturityBadge stage="alpha" />')).toBe(true);
  });

  it("counts fixed prose as reading nothing, entities included", () => {
    expect(readsAValue("<span>Runs outside any matter</span>")).toBe(false);
    expect(readsAValue("<span>&nbsp;</span>")).toBe(false);
  });
});

describe("destinationLabels", () => {
  it("pairs each destination's label with its href", () => {
    const source = `
      { id: "home",
        label: "Home",
        href: "/home",
        icon: House },
      { id: "my-work",
        label: "Tasks",
        href: "/tasks",
        icon: ListChecks },
    `;
    expect(destinationLabels(source)).toEqual(
      new Map([
        ["/home", "Home"],
        ["/tasks", "Tasks"],
      ]),
    );
  });
});

describe("auditScreenHeaders", () => {
  it("passes a header that is only a name", () => {
    expect(audit('<ScreenHeader title="Notifications" />').problems).toEqual([]);
  });

  it("reports an eyebrow, the shape the uploads screen shipped with", () => {
    const { problems } = audit('<ScreenHeader title="Uploads" eyebrow="Uploads" />', {
      file: "apps/web/src/routes/(app)/uploads/+page.svelte",
      href: "/uploads",
    });
    expect(problems.map((problem) => problem.rule)).toEqual(["eyebrow"]);
  });

  it("reports a title the sidebar disagrees with", () => {
    const { problems } = audit('<ScreenHeader title="Notification Center" />');
    expect(problems).toHaveLength(1);
    expect(problems[0].rule).toBe("title");
    expect(problems[0].message).toContain('"Notifications"');
  });

  it("reports a meta that is a fixed sentence", () => {
    const source =
      '<ScreenHeader title="Notifications">\n' +
      "  {#snippet meta()}<span>Alerts across your matters.</span>{/snippet}\n" +
      "</ScreenHeader>";
    expect(audit(source).problems.map((problem) => problem.rule)).toEqual(["meta"]);
  });

  it("leaves a meta that reads a value alone", () => {
    const source =
        '<ScreenHeader title="Home">\n' +
        "  {#snippet meta()}<span>{today}</span>{/snippet}\n" +
        "</ScreenHeader>",
      result = audit(source, {
        file: "apps/web/src/routes/(app)/home/+page.svelte",
        href: "/home",
      });
    expect(result.problems).toEqual([]);
  });

  it("says nothing about a title on a screen that is not a destination", () => {
    const { problems } = audit('<ScreenHeader title="The Check" back="conflicts" />', {
      file: "apps/web/src/routes/(app)/conflicts/checks/[checkId]/+page.svelte",
      href: null,
    });
    expect(problems).toEqual([]);
  });

  it("reports the line the header is on, not the line the file starts on", () => {
    const source = '<script>\n  const a = 1;\n</script>\n\n<ScreenHeader title="X" eyebrow="X" />';
    expect(audit(source).problems[0].line).toBe(5);
  });

  it("honours a named exemption", () => {
    const result = auditScreenHeaders({
      files: [{ path: "a.svelte", source: '<ScreenHeader title="X" eyebrow="X" />' }],
      destinations: DESTINATIONS,
      routeHref: () => null,
      exemptions: new Map([["a.svelte", "reason"]]),
    });
    expect(result.problems).toEqual([]);
  });

  it("ignores a meta snippet on a file with no header of its own", () => {
    const source = "{#snippet meta()}<span>Fixed prose.</span>{/snippet}";
    expect(audit(source, { file: "apps/web/src/lib/x.svelte", href: null }).problems).toEqual([]);
  });
});
