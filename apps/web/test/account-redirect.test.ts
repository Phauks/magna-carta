/*
 * Bare /account lands on the first section rather than a 404 — mirroring /settings, which
 * redirects to its first section. Pure node: the load throws a SvelteKit redirect object.
 */
import { describe, expect, it } from "vitest";
import { load } from "../src/routes/account/+page.ts";

describe("/account root", () => {
  it("redirects to /account/profile", () => {
    try {
      load();
      expect.unreachable("load should redirect");
    } catch (thrown) {
      const redirectLike = thrown as { status?: number; location?: string };
      expect(redirectLike.status).toBe(307);
      expect(redirectLike.location).toBe("/account/profile");
    }
  });
});
