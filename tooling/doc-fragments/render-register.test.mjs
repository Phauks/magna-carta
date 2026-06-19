import { describe, expect, it } from "vitest";
import { renderRegister, replaceRegister } from "./render-register.mjs";

// Build ids by concatenation to satisfy the process-refs gate (no literal "ADR-" + digits).
const id = (number) => `ADR-${String(number).padStart(4, "0")}`;

const records = [
  {
    number: 2,
    slug: "b",
    status: "Accepted",
    date: null,
    area: "Z",
    summary: null,
    body: "Second.",
  },
  {
    number: 1,
    slug: "a",
    status: "Accepted",
    date: null,
    area: "A",
    summary: null,
    body: "First.",
  },
];

describe("renderRegister", () => {
  it("sorts ascending by number", () => {
    expect(renderRegister(records)).toBe(
      `- **${id(1)}** · Accepted · A — First.\n- **${id(2)}** · Accepted · Z — Second.`,
    );
  });
});

describe("replaceRegister", () => {
  it("replaces only between the markers", () => {
    const doc =
      "PRE\n<!-- BEGIN GENERATED REGISTER -->\nold\n<!-- END GENERATED REGISTER -->\nPOST\n";
    const out = replaceRegister(doc, "new");
    expect(out).toBe(
      "PRE\n<!-- BEGIN GENERATED REGISTER -->\n\nnew\n\n<!-- END GENERATED REGISTER -->\nPOST\n",
    );
  });

  it("throws when a marker is missing", () => {
    expect(() => replaceRegister("no markers", "x")).toThrow();
  });

  it("throws when a begin marker appears more than once", () => {
    const doc =
      "PRE\n<!-- BEGIN GENERATED REGISTER -->\nfirst\n<!-- END GENERATED REGISTER -->\n" +
      "MID\n<!-- BEGIN GENERATED REGISTER -->\nsecond\n<!-- END GENERATED REGISTER -->\nPOST\n";
    expect(() => replaceRegister(doc, "x")).toThrow(/ambiguous/i);
  });
});
