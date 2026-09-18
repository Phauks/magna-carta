import { describe, expect, it } from "vitest";
import {
  EDITOR_STYLESHEET,
  EDITOR_STYLESHEET_PATH,
  HEAD_SELECTOR,
  isStylesheetRequest,
  STYLESHEET_LINK,
  stylesheetLinkHandler,
  stylesheetResponse,
  withEditorStylesheet,
  type HeadRewriter,
} from "../src/editor-stylesheet.ts";

// A rewriter that records what it was asked to do and applies the handler to one fake element, so
// the decision and the edit are both checked without the runtime's own streaming rewriter.
function fakeRewriter(): { rewriter: HeadRewriter; selectors: string[]; appended: string[] } {
  const selectors: string[] = [];
  const appended: string[] = [];
  let handler: typeof stylesheetLinkHandler | null = null;
  const rewriter: HeadRewriter = {
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

describe("the stylesheet request", () => {
  it("is a GET of the platform's path on the document's origin, and nothing coolwsd serves", () => {
    const origin =
      "https://0123456789abcdef0123456789abcdef0123456789abcdef0123.magnacartausercontent.com";
    expect(isStylesheetRequest(new Request(`${origin}${EDITOR_STYLESHEET_PATH}`))).toBe(true);
    expect(isStylesheetRequest(new Request(`${origin}/browser/dist/cool.html`))).toBe(false);
    expect(
      isStylesheetRequest(new Request(`${origin}${EDITOR_STYLESHEET_PATH}`, { method: "POST" })),
    ).toBe(false);
    // Under a path prefix the editor never serves, so the worker answers before the container.
    expect(EDITOR_STYLESHEET_PATH.startsWith("/magna-carta/")).toBe(true);
  });

  it("is answered as CSS, briefly cached", async () => {
    const response = stylesheetResponse();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/css");
    expect(response.headers.get("cache-control")).toContain("max-age=3600");
    expect(await response.text()).toBe(EDITOR_STYLESHEET);
  });
});

describe("the rules", () => {
  it("order the host's button first on the shortcuts bar, and invert its icon in the dark theme", () => {
    // The editor appends a host's buttons after its own and shows the icon as given; both rules
    // key on the class the editor puts on every host button, and match nothing else.
    expect(EDITOR_STYLESHEET).toContain("td.cell:has(> .integrator-shortcut)");
    expect(EDITOR_STYLESHEET).toContain("order: -1");
    expect(EDITOR_STYLESHEET).toContain(
      "html[data-theme='dark'] .notebookbar-shortcuts-bar .integrator-shortcut img",
    );
    expect(EDITOR_STYLESHEET).toContain("filter: invert(0.9)");
  });
});

describe("withEditorStylesheet", () => {
  it("links the stylesheet into the page's head, on the page only", () => {
    const { rewriter, selectors, appended } = fakeRewriter();
    const page = new Response("<html>", { headers: { "content-type": "text/html" } });
    const rewritten = withEditorStylesheet(page, () => rewriter);
    expect(rewritten).not.toBe(page);
    expect(selectors).toEqual([HEAD_SELECTOR]);
    expect(appended).toEqual([STYLESHEET_LINK]);
    // The link names the served path exactly, on the same origin, which is what the page's own
    // policy (`style-src 'self'`) allows and the one thing it allows.
    expect(STYLESHEET_LINK).toBe(`<link rel="stylesheet" href="${EDITOR_STYLESHEET_PATH}">`);
  });

  it("hands everything that is not the page back by identity, the upgrade first among them", () => {
    const { rewriter } = fakeRewriter();
    const asset = new Response("body{}", { headers: { "content-type": "text/css" } });
    expect(withEditorStylesheet(asset, () => rewriter)).toBe(asset);
    const upgrade = { status: 101, webSocket: {}, headers: new Headers() } as unknown as Response;
    expect(withEditorStylesheet(upgrade, () => rewriter)).toBe(upgrade);
  });
});
