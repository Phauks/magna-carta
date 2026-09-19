import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { PASSWORD, seedCredentialedUser } from "./support/test-auth.ts";

// WHERE A SESSION'S CLIENT ADDRESS COMES FROM.
//
// This is a one-line configuration (advanced.ipAddress.ipAddressHeaders in src/auth.ts) with a
// silent failure mode, which is exactly the combination worth a test. Better Auth's default reads
// `x-forwarded-for` alone and — with no trusted-proxy list — REFUSES any value carrying more than
// one hop, because the leftmost token of a forwarded chain is whatever the client claimed.
// Cloudflare sends exactly such a chain. So every session this deployment recorded stored an empty
// address, and the signed-in-devices screen had no address to show on any row.
//
// The behaviour is invisible from the application's own surfaces — nothing authorizes on the
// address, and the screen simply leaves the clause out — so nothing but a test of the stored row
// would notice the configuration going away.

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

async function signInFrom(email: string, headers: Record<string, string>): Promise<Response> {
  return SELF.fetch("https://example.com/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.com", ...headers },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
}

async function recordedAddress(userId: string): Promise<string | null> {
  const row = await env.DB_CONTROL.prepare(
    "SELECT ip_address FROM session WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 1",
  )
    .bind(userId)
    .first<{ ip_address: string | null }>();
  return row?.ip_address ?? null;
}

describe("the address a session records", () => {
  // The header the Workers runtime sets from the connection it terminated. It cannot be spoofed by
  // a client, because Cloudflare overwrites whatever arrived under that name.
  it("reads the Cloudflare client address", async () => {
    const { userId } = await seedCredentialedUser("address-cf@example.com");
    expect(
      (await signInFrom("address-cf@example.com", { "cf-connecting-ip": "203.0.113.7" })).status,
    ).toBe(200);
    expect(await recordedAddress(userId)).toBe("203.0.113.7");
  });

  // THE CASE THE DEFAULT GOT WRONG. A forwarded chain is what Cloudflare sends alongside its own
  // header, and the library declines to trust any hop in it. Behind the Cloudflare header, that
  // does not matter — which is the whole point of reading that one first.
  it("prefers it over a forwarded chain the library will not trust", async () => {
    const { userId } = await seedCredentialedUser("address-chain@example.com");
    const response = await signInFrom("address-chain@example.com", {
      "cf-connecting-ip": "203.0.113.7",
      "x-forwarded-for": "198.51.100.4, 203.0.113.7",
    });
    expect(response.status).toBe(200);
    expect(await recordedAddress(userId)).toBe("203.0.113.7");
  });

  // The fallback, for a deployment reached through a front door that is not Cloudflare. A single
  // value is the one shape the library trusts without a proxy list.
  it("falls back to a single-hop forwarded address", async () => {
    const { userId } = await seedCredentialedUser("address-forwarded@example.com");
    expect(
      (await signInFrom("address-forwarded@example.com", { "x-forwarded-for": "198.51.100.4" }))
        .status,
    ).toBe(200);
    expect(await recordedAddress(userId)).toBe("198.51.100.4");
  });
});
