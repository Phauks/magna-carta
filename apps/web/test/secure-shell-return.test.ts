/*
 * Where the Secure Shell's Close goes (src/lib/components/secure-shell-return.ts) — pure, node.
 *
 * The case that matters is the first one: a direct load of an account page. SvelteKit hands the
 * entry navigation a `from` whose `url` is null, which its types say cannot happen, and reading a
 * pathname off it threw on every such load.
 */
import { describe, expect, it } from "vitest";
import {
  SECURE_SHELL_FALLBACK_RETURN,
  secureShellReturnTarget,
} from "../src/lib/components/secure-shell-return.ts";

describe("where Close returns to", () => {
  it("goes Home from a full page load, whose origin SvelteKit reports with a null url", () => {
    expect(secureShellReturnTarget({ type: "enter", from: { url: null } })).toBe(
      SECURE_SHELL_FALLBACK_RETURN,
    );
    expect(secureShellReturnTarget({ type: "enter", from: null })).toBe(
      SECURE_SHELL_FALLBACK_RETURN,
    );
  });

  it("goes back to the in-app screen the member came from", () => {
    const from = { url: new URL("https://example.test/matters/matter_1?tab=notes") };
    expect(secureShellReturnTarget({ type: "link", from })).toBe("/matters/matter_1");
    expect(secureShellReturnTarget({ type: "goto", from })).toBe("/matters/matter_1");
  });

  it("goes Home when a later navigation carries no usable origin", () => {
    expect(secureShellReturnTarget({ type: "link", from: null })).toBe(
      SECURE_SHELL_FALLBACK_RETURN,
    );
    expect(secureShellReturnTarget({ type: "popstate", from: { url: null } })).toBe(
      SECURE_SHELL_FALLBACK_RETURN,
    );
  });
});
