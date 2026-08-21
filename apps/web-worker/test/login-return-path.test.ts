import { describe, expect, it } from "vitest";
import { DEFAULT_RETURN_PATH, safeReturnPath } from "../src/routes/login/return-path.ts";

// The open-redirect guard for the post-sign-in `next` return path. Security-relevant: a
// just-authenticated session must never be bounced off-site by a crafted `next`.
describe("safeReturnPath", () => {
  it("returns a local same-origin path unchanged, preserving query and fragment", () => {
    expect(safeReturnPath("/matters/abc/files")).toBe("/matters/abc/files");
    expect(safeReturnPath("/home?tab=recent")).toBe("/home?tab=recent");
    expect(safeReturnPath("/tools#top")).toBe("/tools#top");
  });

  it("falls back to the default when there is no usable local path", () => {
    expect(safeReturnPath(null)).toBe(DEFAULT_RETURN_PATH);
    expect(safeReturnPath("")).toBe(DEFAULT_RETURN_PATH);
    expect(safeReturnPath("home")).toBe(DEFAULT_RETURN_PATH); // relative, no leading slash
  });

  it("rejects anything that could leave the origin", () => {
    expect(safeReturnPath("https://evil.example/phish")).toBe(DEFAULT_RETURN_PATH);
    expect(safeReturnPath("http://evil.example")).toBe(DEFAULT_RETURN_PATH);
    expect(safeReturnPath("javascript:alert(1)")).toBe(DEFAULT_RETURN_PATH);
    expect(safeReturnPath("//evil.example")).toBe(DEFAULT_RETURN_PATH); // protocol-relative
    expect(safeReturnPath("/\\evil.example")).toBe(DEFAULT_RETURN_PATH); // backslash authority
  });
});
