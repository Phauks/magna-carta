import { describe, expect, it } from "vitest";
import {
  allowAppFraming,
  appFrameAncestors,
  withAppFrameAncestors,
} from "../src/embedding-policy.ts";

// The policy coolwsd actually sends for the editor page, shortened to the directives that matter here.
// `frame-ancestors` names the editor's own origin and the internal WOPI host and nothing else — the
// defect this module exists to correct.
const DOCUMENT_KEY = "286b0ecd5380489120b8c0f96e26476bad69f2897c22af02d7d6";
const COOLWSD_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  `frame-ancestors ${DOCUMENT_KEY}.magnacartausercontent.com:* wopi.magna-carta.internal:*`,
].join("; ");

const APP_SOURCES = ["https://magnacarta.esq", "https://*.magnacarta.esq"];

describe("appFrameAncestors", () => {
  it("falls back to the production app domain when the deployment sets no var", () => {
    expect(appFrameAncestors({})).toEqual(["https://magnacarta.esq", "https://*.magnacarta.esq"]);
  });

  it("splits a configured value into CSP sources, tolerating the whitespace a var picks up", () => {
    expect(
      appFrameAncestors({ APP_FRAME_ANCESTORS: "  https://a.example   https://b.example " }),
    ).toEqual(["https://a.example", "https://b.example"]);
  });

  it("reads an empty var as no app origins rather than as the default", () => {
    expect(appFrameAncestors({ APP_FRAME_ANCESTORS: "" })).toEqual([]);
  });
});

describe("withAppFrameAncestors", () => {
  it("adds the app origins to the list coolwsd derived, which is the whole defect", () => {
    const merged = withAppFrameAncestors(COOLWSD_POLICY, APP_SOURCES);
    expect(merged).toContain("https://magnacarta.esq");
    expect(merged).toContain("https://*.magnacarta.esq");
  });

  it("keeps the sources coolwsd put there, because the editor frames pages of its own", () => {
    const merged = withAppFrameAncestors(COOLWSD_POLICY, APP_SOURCES);
    expect(merged).toContain(`${DOCUMENT_KEY}.magnacartausercontent.com:*`);
    expect(merged).toContain("wopi.magna-carta.internal:*");
  });

  it("leaves every other directive exactly as it was", () => {
    const merged = withAppFrameAncestors(COOLWSD_POLICY, APP_SOURCES);
    expect(merged).toContain("default-src 'none'");
    expect(merged).toContain("script-src 'self' 'unsafe-inline'");
    // One frame-ancestors directive, not two: a second one would be the one the browser ignores.
    expect(merged.match(/frame-ancestors/g)).toHaveLength(1);
  });

  it("adds a frame-ancestors directive when the policy carries none", () => {
    // Without the directive the browser falls back to default-src, so a policy with no frame-ancestors
    // refuses the frame just as effectively as the wrong list does.
    expect(withAppFrameAncestors("default-src 'none'", APP_SOURCES)).toBe(
      "default-src 'none'; frame-ancestors https://magnacarta.esq https://*.magnacarta.esq",
    );
  });

  it("does not repeat a source the policy already names", () => {
    const merged = withAppFrameAncestors("frame-ancestors https://magnacarta.esq", APP_SOURCES);
    expect(merged).toBe("frame-ancestors https://magnacarta.esq https://*.magnacarta.esq");
  });

  it("matches the directive name case-insensitively, as the browser does", () => {
    const merged = withAppFrameAncestors("Frame-Ancestors 'self'", APP_SOURCES);
    expect(merged.match(/frame-ancestors/gi)).toHaveLength(1);
    expect(merged).toContain("'self'");
    expect(merged).toContain("https://magnacarta.esq");
  });

  it("returns the policy untouched when the deployment configured no app origins", () => {
    expect(withAppFrameAncestors(COOLWSD_POLICY, [])).toBe(COOLWSD_POLICY);
  });
});

describe("allowAppFraming", () => {
  it("rewrites the header on the container's response and keeps the body", async () => {
    const response = allowAppFraming(
      new Response("<html>the editor</html>", {
        headers: { "Content-Security-Policy": COOLWSD_POLICY, "Content-Type": "text/html" },
      }),
      APP_SOURCES,
    );

    expect(response.headers.get("Content-Security-Policy")).toContain("https://*.magnacarta.esq");
    expect(response.headers.get("Content-Type")).toBe("text/html");
    expect(await response.text()).toBe("<html>the editor</html>");
  });

  it("preserves the status the container answered with", () => {
    const response = allowAppFraming(
      new Response("nope", {
        status: 404,
        statusText: "Not Found",
        headers: { "Content-Security-Policy": COOLWSD_POLICY },
      }),
      APP_SOURCES,
    );
    expect(response.status).toBe(404);
    expect(response.statusText).toBe("Not Found");
  });

  it("hands a WebSocket upgrade back untouched, whatever headers it carries", () => {
    // The document's editing session rides this socket. The runtime refuses to construct a Response
    // with status 101, so rebuilding one throws and the editor never connects — and a rebuild would
    // drop the `webSocket` the upgrade carries even where it did not throw. A 101 cannot be built
    // here either, which is why the upgrade is stood in for rather than constructed.
    const socket = {};
    const upgrade = {
      status: 101,
      webSocket: socket,
      headers: new Headers({ "Content-Security-Policy": COOLWSD_POLICY }),
    } as unknown as Response;

    const response = allowAppFraming(upgrade, APP_SOURCES);

    expect(response).toBe(upgrade);
    expect((response as unknown as { webSocket: unknown }).webSocket).toBe(socket);
  });

  it("passes a response with no policy straight through, untouched", () => {
    // The editor page is what carries the policy; the assets and the WebSocket upgrade beside it never
    // had one, and giving them one would state a boundary the container never stated.
    const original = new Response("body", { headers: { "Content-Type": "text/css" } });
    const response = allowAppFraming(original, APP_SOURCES);
    expect(response).toBe(original);
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("passes the response through by identity when nothing needed adding", () => {
    const original = new Response("body", {
      headers: {
        "Content-Security-Policy":
          "frame-ancestors https://magnacarta.esq https://*.magnacarta.esq",
      },
    });
    expect(allowAppFraming(original, APP_SOURCES)).toBe(original);
  });
});
