import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedCredentialedUser, signIn } from "./support/test-auth.ts";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

describe("session cookie isolation — standing fitness guard for per-firm subdomains", () => {
  it("the session cookie is host-only (no Domain), HttpOnly, SameSite=Lax", async () => {
    // Firms get branded per-firm subdomains (<firm>.magnacarta.esq) under a shared parent. A session
    // cookie scoped to that parent (Domain=.magnacarta.esq) would be sent to every sibling firm's
    // subdomain AND to the cookieless files.* delivery host — a cross-tenant session leak. Better Auth
    // defaults to a host-only cookie (crossSubDomainCookies off => no Domain); this guard pins that
    // invariant so enabling cross-subdomain cookies, or a library default change, fails loudly here
    // rather than silently widening session scope. Reasoning home: docs/conventions/security.md and
    // apps/api-worker/src/auth.ts (advanced.cookies note).
    // Lowercase literal: Better Auth lowercases the email on sign-in, so a mixed-case seed would miss.
    // This file runs one test against isolated storage, so a fixed address cannot collide.
    const email = "cookie-isolation@example.com";
    await seedCredentialedUser(email);

    const response = await signIn(email);
    expect(response.status).toBe(200);

    const sessionSetCookie = response.headers
      .getAll("set-cookie")
      .find((header) => header.includes("session_token"));
    expect(sessionSetCookie).toBeDefined();

    const header = sessionSetCookie ?? "";
    // The load-bearing assertion: NO Domain attribute means host-only, so the cookie cannot reach a
    // sibling firm subdomain or the cookieless files host.
    expect(header.toLowerCase()).not.toContain("domain=");
    // The attributes the isolation guarantee leans on, pinned alongside it. (Secure / __Secure- are
    // environment-adaptive — set over production https, off for http local dev — so not asserted here;
    // forcing them on would break the http dev login. The no-Domain invariant above is what carries
    // the cross-tenant guarantee, and it holds in every environment.)
    expect(header).toMatch(/;\s*HttpOnly/i);
    expect(header).toMatch(/;\s*SameSite=Lax/i);
  });
});
