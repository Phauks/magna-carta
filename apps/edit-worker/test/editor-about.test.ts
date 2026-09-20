import { describe, expect, it } from "vitest";
import {
  ABOUT_INFO_SELECTOR,
  BUILD_BLOCK_ID,
  buildBlockHandler,
  buildBlockHtml,
  buildLines,
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

describe("the block's lines", () => {
  it("name the build and read its two instants as a person would", () => {
    expect(buildLines(RELEASE)).toEqual([
      "Magna Carta build 3396b89",
      "Committed 2026-09-19 21:04 UTC",
      "Built 2026-09-19 21:09 UTC",
    ]);
  });

  it("say a development build is one, rather than inventing a version", () => {
    expect(buildLines(DEVELOPMENT)).toEqual(["Magna Carta: development build"]);
  });

  it("render in the dialog's own row class, one line per row, escaped", () => {
    const html = buildBlockHtml({ ...RELEASE, commit: "<x>" });
    expect(html.startsWith(`<div id="${BUILD_BLOCK_ID}" class="about-dialog-info-div">`)).toBe(
      true,
    );
    expect(html).toContain("Magna Carta build &lt;x&gt;");
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
