import { describe, expect, it } from "vitest";
import {
  ABOUT_INFO_SELECTOR,
  BUILD_BLOCK_ID,
  buildBlockHandler,
  buildBlockHtml,
  buildRows,
  REPOSITORY_URL,
  withBuildIdentity,
  type AboutRewriter,
} from "../src/editor-about.ts";

const RELEASE = {
  commit: "3396b89",
  commitTime: "2026-09-19T21:04:11.000Z",
  buildTime: "2026-09-19T21:09:02.000Z",
};
const DEVELOPMENT = { commit: "dev", commitTime: null, buildTime: null };

function fakeRewriter(): { rewriter: AboutRewriter; selectors: string[]; appended: string[] } {
  const selectors: string[] = [];
  const appended: string[] = [];
  let handler: ReturnType<typeof buildBlockHandler> | null = null;
  const rewriter: AboutRewriter = {
    on(selector, given) {
      selectors.push(selector);
      handler = given;
      return rewriter;
    },
    transform(response) {
      handler?.element({
        append(content, options) {
          expect(options.html).toBe(true);
          appended.push(content);
        },
      });
      return new Response("rewritten", { status: response.status, headers: response.headers });
    },
  };
  return { rewriter, selectors, appended };
}

describe("the block's rows", () => {
  it("name the build, link it to its commit, and read the two instants as a person would", () => {
    expect(buildRows(RELEASE)).toEqual([
      { label: "Build", value: "3396b89", href: `${REPOSITORY_URL}/commit/3396b89` },
      { label: "Committed", value: "2026-09-19 21:04 UTC" },
      { label: "Built", value: "2026-09-19 21:09 UTC" },
    ]);
  });

  it("say a development build is one, rather than inventing a version or a link", () => {
    expect(buildRows(DEVELOPMENT)).toEqual([{ label: "Build", value: "development build" }]);
    expect(buildBlockHtml(DEVELOPMENT)).not.toContain("<a ");
  });

  it("render a heading and one line per row, the link in a new tab, everything escaped", () => {
    const html = buildBlockHtml({ ...RELEASE, commit: "<x>" });
    expect(html.startsWith(`<div id="${BUILD_BLOCK_ID}" dir="ltr">`)).toBe(true);
    expect(html).toContain('<div class="mc-about-label">Magna Carta</div>');
    expect(html.match(/class="mc-about-row"/g)).toHaveLength(3);
    expect(html).toContain('target="_blank" rel="noreferrer">&lt;x&gt;</a>');
    expect(html).toContain("commit/%3Cx%3E");
    expect(html).not.toContain("<x>");
  });
});

describe("withBuildIdentity", () => {
  it("appends the block after the editor's own version rows, on the page only", () => {
    const { rewriter, selectors, appended } = fakeRewriter();
    const page = new Response("<html>", { headers: { "content-type": "text/html" } });
    const rewritten = withBuildIdentity(page, RELEASE, () => rewriter);
    expect(rewritten).not.toBe(page);
    expect(selectors).toEqual([ABOUT_INFO_SELECTOR]);
    expect(appended).toEqual([buildBlockHtml(RELEASE)]);
  });

  it("hands everything that is not the page back by identity, the upgrade first among them", () => {
    const { rewriter } = fakeRewriter();
    const asset = new Response("body{}", { headers: { "content-type": "text/css" } });
    expect(withBuildIdentity(asset, RELEASE, () => rewriter)).toBe(asset);
    const upgrade = { status: 101, webSocket: {}, headers: new Headers() } as unknown as Response;
    expect(withBuildIdentity(upgrade, RELEASE, () => rewriter)).toBe(upgrade);
  });
});
