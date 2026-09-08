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
  membership: { state: "active" },
};
// A firm that exists and has not finished admitting its owner. Activation attaches the account to
// the firm before the message mirroring it into the firm's OWN database as a member has landed, so
// this shape is the ordinary first few seconds of every new firm — and, until the guards read it,
// the shape that let somebody into a workspace where every screen refused.
const JOINED_BUT_NOT_MIRRORED = {
  user: { id: "usr_3", name: "Fay Founder", email: "fay@example.com" },
  firm: { id: "firm_2", name: "Founder and Co" },
  membership: { state: "provisioning" },
};
// A member record the relay has given up on. It goes the same way as one still landing: a screen
// that names the stopped step is worth more than a workspace that refuses everything without
// saying why.
const MIRROR_ABANDONED = {
  user: { id: "usr_5", name: "Priya Raman", email: "priya@example.com" },
  firm: { id: "firm_2", name: "Founder and Co" },
  membership: { state: "stalled" },
};
// A membership read that did not answer. NOT the same thing: a fault is not a verdict about the
// account, and bouncing a working member out of a working workspace on one would be worse than the
// gap the case above closes.
const MEMBERSHIP_UNREAD = {
  user: { id: "usr_4", name: "Member", email: "member@example.com" },
  firm: { id: "firm_1", name: "Goldsmith and Associates" },
  membership: { state: "unknown" },
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

  it("sends somebody whose member record has not landed back to the joining screen", async () => {
    // They have a firm and cannot use it: every permission read behind this layout resolves to
    // nothing, so every screen refuses for a reason that reads like an administrator has to grant
    // something. It is a wait, and the joining screen is where waits are shown.
    const redirect = await caught(() =>
      appLayoutLoad({ fetch: bootstrapFetch(200, JOINED_BUT_NOT_MIRRORED), url } as never),
    );
    expect(redirect.status).toBe(307);
    expect(redirect.location).toBe("/welcome");
  });

  it("sends somebody whose member record was given up on to the joining screen too", async () => {
    const redirect = await caught(() =>
      appLayoutLoad({ fetch: bootstrapFetch(200, MIRROR_ABANDONED), url } as never),
    );
    expect(redirect.status).toBe(307);
    expect(redirect.location).toBe("/welcome");
  });

  it("lets a person through when the membership read did not answer", async () => {
    await expect(
      Promise.resolve(
        appLayoutLoad({ fetch: bootstrapFetch(200, MEMBERSHIP_UNREAD), url } as never),
      ),
    ).resolves.toEqual({});
  });

  it("lets a person through when the bootstrap says nothing about membership at all", async () => {
    // A reply from a deployment older than the field. Absent is not provisioning — reading it as
    // one would strand every member of every firm on the joining screen across the deploy.
    const { membership: _omitted, ...withoutMembership } = IN_A_FIRM;
    await expect(
      Promise.resolve(
        appLayoutLoad({ fetch: bootstrapFetch(200, withoutMembership), url } as never),
      ),
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

  it("keeps somebody whose member record has not landed, so the wait finishes here", async () => {
    // The mirror of the (app) guard's redirect above. Sending them on to /home would put the two
    // guards in a loop; keeping them is what lets the waiting screen show that last step.
    await expect(
      Promise.resolve(
        welcomeLoad({ fetch: bootstrapFetch(200, JOINED_BUT_NOT_MIRRORED) } as never),
      ),
    ).resolves.toEqual({ bootstrap: JOINED_BUT_NOT_MIRRORED });
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
