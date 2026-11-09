// @vitest-environment happy-dom
/*
 * The record's one scrolling page, mounted: every section is on it at once, and a press on the rail
 * lights that row and lands the reader on the section. The arithmetic behind which row is lit
 * while scrolling is pinned beside this in directory-record-sections.test.ts.
 */
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import RecordSections from "../src/lib/directory/record-sections.svelte";

const SECTIONS = [
  { id: "names", label: "Names", count: 2 },
  { id: "contact", label: "Contact", count: 0 },
  { id: "address", label: "Address" },
];

const body = createRawSnippet((entry: () => { label: string }) => ({
  render: () => `<p>${entry().label} fields</p>`,
}));

let mounted: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (mounted !== null) void unmount(mounted);
  mounted = null;
  document.body.innerHTML = "";
});

function render(): HTMLElement {
  const target = document.createElement("div");
  document.body.append(target);
  mounted = mount(RecordSections, { target, props: { sections: SECTIONS, section: body } });
  flushSync();
  return target;
}

describe("the record's one page", () => {
  it("stacks every section at once, so nothing waits behind a press", () => {
    const target = render();
    expect(target.querySelectorAll("section")).toHaveLength(3);
    expect(target.textContent).toContain("Contact fields");
    expect(target.textContent).toContain("Address fields");
    // The heading each section carries is the rail's own word for it.
    expect(
      [...target.querySelectorAll("section h3")].map((heading) => heading.textContent),
    ).toEqual(["Names", "Contact", "Address"]);
  });

  it("counts what a section holds on the rail, and draws no number for none", () => {
    const target = render();
    const rows = [...target.querySelectorAll("nav button")];
    expect(rows.map((row) => row.textContent?.replaceAll(/\s+/g, ""))).toEqual([
      "Names2",
      "Contact",
      "Address",
    ]);
  });

  it("lights the first row at rest, and the pressed row once pressed, landing focus on its section", () => {
    const target = render();
    const rows = [...target.querySelectorAll<HTMLButtonElement>("nav button")];
    expect(rows[0]?.getAttribute("aria-current")).toBe("true");

    rows[2]?.click();
    flushSync();

    expect(rows[2]?.getAttribute("aria-current")).toBe("true");
    expect(rows[0]?.hasAttribute("aria-current")).toBe(false);
    expect(document.activeElement).toBe(target.querySelectorAll("section")[2]);
  });
});
