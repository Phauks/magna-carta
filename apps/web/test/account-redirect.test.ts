/*
 * The two loads that decide where an /account visitor ends up: the bare-path redirect to the first
 * section, and the surface's own session guard. Pure node — a SvelteKit redirect is a thrown object.
 * The guard reads the session through the generated client and the one query cache, so each case
 * points the client at a fetch that answers and empties the cache first.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { client } from "@magna-carta/api-client/client";
import { queryClient } from "../src/lib/api/screen-data.ts";
import { load } from "../src/routes/account/+page.ts";
import { load as guard } from "../src/routes/account/+layout.ts";

interface RedirectLike {
  status?: number;
  location?: string;
}

// The guard reads one endpoint and nothing else, so the whole collaborator is a fetch that answers.
function answering(status: number): typeof fetch {
  const body =
    status === 200
      ? JSON.stringify({ user: { id: "usr_1" }, firm: null })
      : JSON.stringify({ status });
  return (() =>
    Promise.resolve(
      new Response(body, {
        status,
        headers: {
          "content-type": status === 200 ? "application/json" : "application/problem+json",
        },
      }),
    )) as unknown as typeof fetch;
}

beforeEach(() => {
  queryClient.clear();
});

afterEach(() => {
  client.setConfig({ baseUrl: "", fetch: globalThis.fetch });
});

const dead: typeof fetch = (() =>
  Promise.reject(new Error("no worker"))) as unknown as typeof fetch;

async function runGuard(
  fetchImpl: typeof fetch,
  pathname = "/account/sessions",
  search = "",
): Promise<RedirectLike | null> {
  client.setConfig({ baseUrl: "https://app.example", fetch: fetchImpl });
  try {
    // The load signature carries more than the guard reads; the cast keeps the fixture to the one
    // field it actually uses rather than assembling a whole SvelteKit load event.
    await (guard as unknown as (event: unknown) => Promise<unknown>)({
      url: { pathname, search },
    });
    return null;
  } catch (thrown) {
    return thrown as RedirectLike;
  }
}

describe("/account root", () => {
  it("redirects to /account/profile", () => {
    try {
      load();
      expect.unreachable("load should redirect");
    } catch (thrown) {
      const redirectLike = thrown as RedirectLike;
      expect(redirectLike.status).toBe(307);
      expect(redirectLike.location).toBe("/account/profile");
    }
  });
});

describe("the account session guard", () => {
  it("sends an unauthenticated visitor to sign in, carrying where they were going", async () => {
    const redirected = await runGuard(answering(401), "/account/sessions", "?from=email");
    expect(redirected?.status).toBe(307);
    expect(redirected?.location).toBe("/login?next=%2Faccount%2Fsessions%3Ffrom%3Demail");
  });

  it("lets a signed-in visitor through", async () => {
    expect(await runGuard(answering(200))).toBeNull();
  });

  // A firmless account still owns its own profile, credentials and devices — the (app) group's
  // guard sends such a person to /welcome, and this one deliberately does not.
  it("does not send anybody to /welcome, whatever the bootstrap says about their firm", async () => {
    expect(await runGuard(answering(404))).toBeNull();
  });

  // Same posture as the (app) guard: nothing answering is not a verdict about the session.
  it("renders anyway when nothing answers", async () => {
    expect(await runGuard(dead)).toBeNull();
  });
});
