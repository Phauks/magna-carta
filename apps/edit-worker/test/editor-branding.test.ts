import { describe, expect, it } from "vitest";
import {
  isEditorPage,
  LOGO_FIELD_SELECTOR,
  logoFieldHandler,
  NO_LOGO,
  withoutEditorLogo,
  type PageRewriter,
} from "../src/editor-branding.ts";

// A rewriter that records what it was asked to do and applies the handler to one fake element, so
// the decision and the edit are both checked without the runtime's own streaming rewriter.
function fakeRewriter(): {
  rewriter: PageRewriter;
  selectors: string[];
  attributes: Record<string, string>;
} {
  const selectors: string[] = [];
  const attributes: Record<string, string> = {};
  let handler: typeof logoFieldHandler | null = null;
  const rewriter: PageRewriter = {
    on(selector, given) {
      selectors.push(selector);
      handler = given;
      return rewriter;
    },
    transform(response) {
      handler?.element({
        setAttribute(name, value) {
          attributes[name] = value;
        },
      });
      return new Response("rewritten", { status: response.status, headers: response.headers });
    },
  };
  return { rewriter, selectors, attributes };
}

describe("isEditorPage", () => {
  it("is the editor's HTML page and nothing else", () => {
    expect(
      isEditorPage(
        new Response("<html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
      ),
    ).toBe(true);
    expect(isEditorPage(new Response("body{}", { headers: { "content-type": "text/css" } }))).toBe(
      false,
    );
    expect(
      isEditorPage(new Response("gone", { status: 404, headers: { "content-type": "text/html" } })),
    ).toBe(false);
  });

  it("never reads an upgrade as a page, whatever headers it carries", () => {
    const upgrade = {
      status: 101,
      webSocket: {},
      headers: new Headers({ "content-type": "text/html" }),
    } as unknown as Response;
    expect(isEditorPage(upgrade)).toBe(false);
  });
});

describe("withoutEditorLogo", () => {
  it("switches the logo field to the editor's own word for none, on the page only", () => {
    const { rewriter, selectors, attributes } = fakeRewriter();
    const page = new Response("<html>", { headers: { "content-type": "text/html" } });
    const rewritten = withoutEditorLogo(page, () => rewriter);
    expect(rewritten).not.toBe(page);
    expect(selectors).toEqual([LOGO_FIELD_SELECTOR]);
    expect(attributes).toEqual({ value: NO_LOGO });
    expect(NO_LOGO).toBe("none");
  });

  it("hands everything that is not the page back by identity, the upgrade first among them", () => {
    const { rewriter } = fakeRewriter();
    const asset = new Response("body{}", { headers: { "content-type": "text/css" } });
    expect(withoutEditorLogo(asset, () => rewriter)).toBe(asset);
    const upgrade = { status: 101, webSocket: {}, headers: new Headers() } as unknown as Response;
    expect(withoutEditorLogo(upgrade, () => rewriter)).toBe(upgrade);
  });
});
