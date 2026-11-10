import { describe, expect, it } from "vitest";
import { ACROSS_THE_APP, areasOf, ledgerRow, renderLedger } from "./build-pull-request-ledger.mjs";

const fragment = (category, audience, text) =>
  ["---", `category: ${category}`, `audience: ${audience}`, "---", "", text, ""].join("\n");

describe("areasOf", () => {
  it("names the parts of the application a pull request's paths fall in, once each", () => {
    expect(
      areasOf([
        "apps/web/src/routes/(app)/matters/+page.svelte",
        "apps/web/src/lib/matters/matter-header.svelte",
        "packages/billing-core/src/invoice.ts",
      ]),
    ).toEqual(["Matters", "Billing"]);
  });

  it("names none for paths no reader can see", () => {
    expect(areasOf(["tooling/gate/index.mjs", "docs/now.md", "pnpm-lock.yaml"])).toEqual([]);
  });

  it("calls a sweep across more than four areas a change across the app", () => {
    expect(
      areasOf([
        "packages/matters/a.ts",
        "packages/billing/a.ts",
        "packages/trust/a.ts",
        "packages/costs/a.ts",
        "packages/fees/a.ts",
      ]),
    ).toEqual([ACROSS_THE_APP]);
  });
});

describe("ledgerRow", () => {
  const commit = {
    sha: "0123456789abcdef0123456789abcdef01234567",
    date: "2026-11-09",
    subject: "Numbers sort as read (#698)",
    paths: ["apps/web/src/routes/(app)/matters/+page.svelte"],
  };

  it("reads the number and title from a squash-merge subject", () => {
    const row = ledgerRow({ ...commit, fragments: [] });
    expect(row).toMatchObject({ number: 698, title: "Numbers sort as read", areas: ["Matters"] });
  });

  it("leaves out a commit that is not a merged pull request", () => {
    expect(
      ledgerRow({
        ...commit,
        subject: "docs: assemble fragments into the rendered trackers",
        fragments: [],
      }),
    ).toBeNull();
  });

  it("marks a pull request with no fragment as unrecorded, with no entry", () => {
    expect(ledgerRow({ ...commit, fragments: [] })).toMatchObject({
      kind: "Unrecorded",
      memberFacing: false,
      entry: "",
    });
  });

  it("takes the kind, the audience and the developer text from the fragment", () => {
    const row = ledgerRow({
      ...commit,
      fragments: [
        fragment(
          "Changed",
          "public",
          "**Numbers sort.** The developer detail.\n\n## Public\n\nMember copy.",
        ),
      ],
    });
    expect(row).toMatchObject({
      kind: "Changed",
      memberFacing: true,
      entry: "**Numbers sort.** The developer detail.",
    });
  });

  it("keeps the whole text of a fragment written before the frontmatter existed", () => {
    const row = ledgerRow({ ...commit, fragments: ["- An early entry with no frontmatter."] });
    expect(row).toMatchObject({
      kind: "Unrecorded",
      entry: "- An early entry with no frontmatter.",
    });
  });
});

describe("renderLedger", () => {
  it("writes one pull request per line, as a JSON array that parses back", () => {
    const rows = [{ number: 2 }, { number: 1 }];
    const text = renderLedger(rows);
    expect(text.split("\n")).toEqual(["[", '{"number":2},', '{"number":1}', "]", ""]);
    expect(JSON.parse(text)).toEqual(rows);
    expect(JSON.parse(renderLedger([]))).toEqual([]);
  });
});
