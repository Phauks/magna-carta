/*
 * WHERE A SIGNED-IN PERSON LANDS, which after the account-first reflow is a question with three
 * answers rather than two: signed out, signed in with a firm, and signed in with none.
 *
 * The third is the whole point of the reflow and the state most likely to be broken by a later
 * change, because it is invisible to anybody who already has a firm — a person testing by hand
 * cannot reach it without making a fresh account. So both guards are driven directly here, with a
 * fetch that answers what the bootstrap would.
 *
 * Pure node: a SvelteKit `load` throws its redirect, which is what these assert on.
 */
import { describe, expect, it } from "vitest";
import { load as appLayoutLoad } from "../src/routes/(app)/+layout.ts";
import { load as welcomeLoad } from "../src/routes/welcome/+page.ts";

type Thrown = { status?: number; location?: string };

/** A fetch answering one canned bootstrap reply, for the one call these loads make. */
function bootstrapFetch(status: number, body?: unknown): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    )) as unknown as typeof fetch;
}

const deadFetch = (() => Promise.reject(new Error("no worker"))) as unknown as typeof fetch;

const FIRMLESS = {
  user: { id: "usr_1", name: "Ada Orphan", email: "ada@example.com" },
  firm: null,
  joining: { state: "chooseFirm" },
};
const IN_A_FIRM = {
  user: { id: "usr_2", name: "Member", email: "member@example.com" },
  firm: { id: "firm_1", name: "Goldsmith and Associates" },
};

// A SvelteKit `load` is typed as returning MaybePromise, so it is awaited through Promise.resolve
// rather than assumed to be one — these guards happen to be async, and the helper should not care.
async function caught(run: () => unknown): Promise<Thrown> {
  try {
    await Promise.resolve(run());
    expect.unreachable("the load should have redirected");
  } catch (thrown) {
    return thrown as Thrown;
  }
  return {};
}

describe("the (app) guard", () => {
  const url = new URL("https://app.example/matters?tab=open");

  it("sends an unauthenticated visitor to sign in, carrying where they were going", async () => {
    const redirect = await caught(() =>
      appLayoutLoad({ fetch: bootstrapFetch(401), url } as never),
    );
    expect(redirect.status).toBe(307);
    expect(redirect.location).toBe("/login?next=%2Fmatters%3Ftab%3Dopen");
  });

  it("sends a signed-in person with no firm to the joining screen", async () => {
    // Not to /login: they ARE signed in. And no `next`, because there is nothing to return to —
    // the screen they are being sent to stands between them and every path in this group.
    const redirect = await caught(() =>
      appLayoutLoad({ fetch: bootstrapFetch(200, FIRMLESS), url } as never),
    );
    expect(redirect.status).toBe(307);
    expect(redirect.location).toBe("/welcome");
  });

  it("lets a person who has a firm through", async () => {
    await expect(
      Promise.resolve(appLayoutLoad({ fetch: bootstrapFetch(200, IN_A_FIRM), url } as never)),
    ).resolves.toEqual({});
  });

  it("renders anyway when nothing answers", async () => {
    // A frontend-only dev server with no Worker behind it is not a statement about the session, and
    // treating it as one would make the SPA unrunnable without a backend.
    await expect(
      Promise.resolve(appLayoutLoad({ fetch: deadFetch, url } as never)),
    ).resolves.toEqual({});
  });
});

describe("the /welcome guard", () => {
  it("sends an unauthenticated visitor to sign in", async () => {
    const redirect = await caught(() => welcomeLoad({ fetch: bootstrapFetch(401) } as never));
    expect(redirect.status).toBe(307);
    expect(redirect.location).toBe("/login");
  });

  it("sends somebody who has already joined a firm into the app", async () => {
    // The mirror image of the (app) guard. A screen asking them to choose a firm would be offering
    // to undo something the tenancy model does not undo.
    const redirect = await caught(() =>
      welcomeLoad({ fetch: bootstrapFetch(200, IN_A_FIRM) } as never),
    );
    expect(redirect.status).toBe(307);
    expect(redirect.location).toBe("/home");
  });

  it("keeps a firmless person, handing the screen the state to open in", async () => {
    await expect(
      Promise.resolve(welcomeLoad({ fetch: bootstrapFetch(200, FIRMLESS) } as never)),
    ).resolves.toEqual({
      bootstrap: FIRMLESS,
    });
  });

  it("renders anyway when nothing answers", async () => {
    await expect(Promise.resolve(welcomeLoad({ fetch: deadFetch } as never))).resolves.toEqual({
      bootstrap: null,
    });
  });
});
