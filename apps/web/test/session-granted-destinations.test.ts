/*
 * A destination gated on a permission the member truly holds is a destination the member sees.
 *
 * The rail and the palette ask `grantedPermissions()` (tools/tool-permissions.ts), which began as a
 * fixed list of tool permissions. Meetings is gated on `meetings:join`, which that list never named,
 * so the row was filtered out for everybody — including every member the server had granted it to.
 * The sidebar test only checked that the row carries the key, never that anyone could hold it. This
 * file holds the other half: what the session says the member holds reaches the gate.
 */
import { afterEach, describe, expect, it } from "vitest";
import { sessionPermissions } from "../src/lib/access/session-permissions.svelte.ts";
import type { SessionBootstrap } from "../src/lib/matters/matters-api.ts";
import { grantedPermissions } from "../src/lib/tools/tool-permissions.ts";
import { visibleDestinations } from "../src/lib/navigation/destinations.ts";

function sessionHolding(permissions: readonly string[]): SessionBootstrap {
  return {
    user: { id: "user_test", name: "Test Member", email: "member@example.test" },
    firm: { id: "firm_test", name: "Test Firm" },
    permissions,
  } as unknown as SessionBootstrap;
}

const meetingsShown = () =>
  visibleDestinations(grantedPermissions()).some((destination) => destination.id === "meetings");

describe("session grants reach the destination gate", () => {
  afterEach(() => {
    sessionPermissions.session = null;
  });

  it("shows Meetings to a member whose session holds meetings:join", () => {
    sessionPermissions.session = sessionHolding(["meetings:join"]);
    expect(meetingsShown()).toBe(true);
  });

  it("keeps Meetings hidden from a member whose session does not hold it", () => {
    sessionPermissions.session = sessionHolding(["matters:read"]);
    expect(meetingsShown()).toBe(false);
  });

  it("adds nothing before the session has answered", () => {
    sessionPermissions.session = null;
    expect(meetingsShown()).toBe(false);
  });

  it("ignores a string the registry does not know", () => {
    sessionPermissions.session = sessionHolding(["not:aPermission"]);
    expect([...grantedPermissions()]).not.toContain("not:aPermission");
  });
});
