// THE MEETING GUEST'S LANE THROUGH THE CHOKEPOINT, over fakes that record which ports ran.
//
// What is held here is structural, not behavioural: a guest route admits a signed credential INSTEAD
// of a session, so the session, the member-active check and the permission set are never consulted on
// it; what the handler is handed is a firm and the credential's names, never a user id and never the
// secret; and the other direction — a guest's credential presented anywhere else — meets the same
// reserved absence a stranger does. The credential check is the real one, over a test secret, so "a
// bad signature" means a token this deployment did not sign.
import { z } from "@hono/zod-openapi";
import type { Permission } from "@magna-carta/access-control/registry";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FirmId,
  MeetingGuestInvitationId,
  MeetingGuestStayId,
  MeetingId,
  UserId,
} from "@magna-carta/identifiers/types";
import { Hono, type Context } from "hono";
import { describe, expect, it } from "vitest";
import {
  createChokepoint,
  type ChokepointPorts,
  type GuestLaneRefusal,
} from "../src/chokepoint/chokepoint.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../src/contracts/route-meta.ts";
import {
  GUEST_CREDENTIAL_HEADER,
  GUEST_CREDENTIAL_QUERY_PARAMETER,
  mintGuestGrantToken,
  mintGuestInvitationToken,
  verifyGuestCredential,
} from "../src/meetings/guest-token.ts";

const SIGNING_SECRET = "guest-lane-test-signing-secret";
const OTHER_SECRET = "a-secret-this-deployment-does-not-hold";

const FIRM = newIdentifier("firm") as FirmId;
const MEETING = newIdentifier("meeting") as MeetingId;
const INVITATION = newIdentifier("meetingGuestInvitation") as MeetingGuestInvitationId;
const STAY = newIdentifier("meetingGuestStay") as MeetingGuestStayId;
const MEMBER = newIdentifier("user") as UserId;

const IN_AN_HOUR = new Date(Date.now() + 60 * 60 * 1000).toISOString();

interface FakeFirmContext {
  readonly firmId: FirmId;
}

interface Script {
  readonly firmAbsent?: boolean;
  readonly refusal?: GuestLaneRefusal;
  readonly rateLimitAllowed?: boolean;
  readonly withoutLane?: boolean;
}

function buildChokepoint(script: Script = {}) {
  const steps: string[] = [];
  const rateLimitKeys: string[] = [];
  const presented: (string | null)[] = [];
  const ports: ChokepointPorts<FakeFirmContext> = {
    resolveSession: async () => {
      steps.push("resolveSession");
      return { userId: MEMBER, firmId: FIRM };
    },
    resolveFirmContext: async () => {
      steps.push("resolveFirmContext");
      return { firmId: FIRM };
    },
    loadPermissions: async () => {
      steps.push("loadPermissions");
      return new Set<Permission>();
    },
    idempotency: { middlewareFor: () => null },
    rateLimiter: {
      check: (_bucket, key) => {
        steps.push("rateLimiter");
        rateLimitKeys.push(key);
        return (script.rateLimitAllowed ?? true)
          ? { allowed: true, limit: 20, remaining: 19 }
          : { allowed: false, retryAfterSeconds: 30, limit: 20, remaining: 0 };
      },
    },
    ...(script.withoutLane === true
      ? {}
      : {
          guestLane: {
            verifyGuestCredential: async (_c, credential, lane) => {
              steps.push("verifyGuestCredential");
              presented.push(credential);
              if (credential === null) return null;
              const verified = await verifyGuestCredential(
                SIGNING_SECRET,
                credential,
                lane,
                Math.floor(Date.now() / 1000),
              );
              return verified === null
                ? null
                : {
                    lane: verified.lane,
                    firmId: verified.firmId,
                    meetingId: verified.meetingId,
                    invitationId: verified.invitationId,
                    secretVersion: verified.secretVersion,
                    stayId: verified.stayId,
                    secret: verified.secret,
                  };
            },
            resolveGuestFirmContext: async (_c, grant) => {
              steps.push("resolveGuestFirmContext");
              return script.firmAbsent === true ? null : { firmId: grant.firmId };
            },
            confirmGuestCredentialIsLive: async () => {
              steps.push("confirmGuestCredentialIsLive");
              return script.refusal ?? null;
            },
          },
        }),
  };
  return { chokepoint: createChokepoint(ports), steps, rateLimitKeys, presented };
}

function guestMeta(lane: "invitation" | "grant"): RouteMeta {
  return {
    operationId: lane === "grant" ? "guest.meetingSocket" : "guest.meetingSummary",
    surface: "app",
    authenticated: false,
    permission: null,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
    guestLane: lane,
  };
}

const memberMeta: RouteMeta = {
  operationId: "meetings.get",
  surface: "app",
  authenticated: true,
  permission: null,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

/** What the handler saw on the context — the part of the contract a later handler relies on. */
interface Seen {
  userId: unknown;
  firmId: unknown;
  grant: unknown;
}

function mounted(
  chokepoint: ReturnType<typeof createChokepoint>,
  meta: RouteMeta,
  steps: string[],
  path = "/api/v1/guest/meeting",
): { app: Hono; seen: Seen[] } {
  const app = new Hono();
  const seen: Seen[] = [];
  app.get(path, chokepoint.forRoute(meta), (c: Context) => {
    steps.push("handler");
    seen.push({
      userId: c.get("chokepointUserId"),
      firmId: c.get("chokepointFirmId"),
      grant: c.get("chokepointGuestGrant"),
    });
    return c.json({ ok: true }, 200);
  });
  return { app, seen };
}

async function invitationToken(secret = SIGNING_SECRET): Promise<string> {
  return await mintGuestInvitationToken(secret, {
    firmId: FIRM,
    meetingId: MEETING,
    invitationId: INVITATION,
    secretVersion: 1,
    secret: "the-link-secret-itself",
    expiresAt: IN_AN_HOUR,
  });
}

async function grantToken(): Promise<string> {
  return await mintGuestGrantToken(SIGNING_SECRET, {
    firmId: FIRM,
    meetingId: MEETING,
    invitationId: INVITATION,
    secretVersion: 1,
    stayId: STAY,
    expiresAt: IN_AN_HOUR,
  });
}

async function problemType(response: Response): Promise<string> {
  const problem = (await response.json()) as { type: string };
  return problem.type;
}

describe("the guest lane — the flat refusal", () => {
  it("answers the reserved 404 to a request carrying no credential, and reads nothing", async () => {
    const { chokepoint, steps, rateLimitKeys } = buildChokepoint();
    const { app } = mounted(chokepoint, guestMeta("invitation"), steps);
    const response = await app.request("/api/v1/guest/meeting", {
      headers: { "cf-connecting-ip": "203.0.113.9" },
    });
    expect(response.status).toBe(404);
    expect(await problemType(response)).toMatch(/\/not-found$/);
    // The limiter is spent against the caller's ADDRESS, and no firm, session or row was touched.
    expect(steps).toEqual(["verifyGuestCredential", "rateLimiter"]);
    expect(rateLimitKeys).toEqual(["ip:203.0.113.9"]);
  });

  it("answers the same 404 to a token this deployment did not sign", async () => {
    const { chokepoint, steps } = buildChokepoint();
    const { app } = mounted(chokepoint, guestMeta("invitation"), steps);
    const response = await app.request("/api/v1/guest/meeting", {
      headers: { [GUEST_CREDENTIAL_HEADER]: await invitationToken(OTHER_SECRET) },
    });
    expect(response.status).toBe(404);
    expect(steps).toEqual(["verifyGuestCredential", "rateLimiter"]);
  });

  it("answers the same 404 to the other lane's credential — a grant is not a link, and a link is not a grant", async () => {
    const { chokepoint, steps } = buildChokepoint();
    const summary = mounted(chokepoint, guestMeta("invitation"), steps);
    const onSummary = await summary.app.request("/api/v1/guest/meeting", {
      headers: { [GUEST_CREDENTIAL_HEADER]: await grantToken() },
    });
    expect(onSummary.status).toBe(404);

    const grantRoute = mounted(chokepoint, guestMeta("grant"), steps, "/api/v1/guest/departures");
    const onGrantRoute = await grantRoute.app.request("/api/v1/guest/departures", {
      headers: { [GUEST_CREDENTIAL_HEADER]: await invitationToken() },
    });
    expect(onGrantRoute.status).toBe(404);
    expect(summary.seen).toHaveLength(0);
    expect(grantRoute.seen).toHaveLength(0);
  });

  it("rate-limits somebody guessing at the route, keyed by their address", async () => {
    const { chokepoint, steps } = buildChokepoint({ rateLimitAllowed: false });
    const { app } = mounted(chokepoint, guestMeta("invitation"), steps);
    const response = await app.request("/api/v1/guest/meeting", {
      headers: { [GUEST_CREDENTIAL_HEADER]: "not.a-token" },
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
  });

  it("answers the reserved 404 when this deployment wired no lane at all — fail closed, never the session path", async () => {
    const { chokepoint, steps } = buildChokepoint({ withoutLane: true });
    const { app } = mounted(chokepoint, guestMeta("invitation"), steps);
    const response = await app.request("/api/v1/guest/meeting", {
      headers: { [GUEST_CREDENTIAL_HEADER]: await invitationToken() },
    });
    expect(response.status).toBe(404);
    expect(steps).toEqual([]);
  });

  it("answers the reserved 404 when the credential's firm is one this deployment does not serve", async () => {
    const { chokepoint, steps } = buildChokepoint({ firmAbsent: true });
    const { app } = mounted(chokepoint, guestMeta("invitation"), steps);
    const response = await app.request("/api/v1/guest/meeting", {
      headers: { [GUEST_CREDENTIAL_HEADER]: await invitationToken() },
    });
    expect(response.status).toBe(404);
    expect(steps).toEqual(["verifyGuestCredential", "resolveGuestFirmContext"]);
  });
});

describe("the guest lane — a signed credential the row refuses", () => {
  it("says the specific refusal, because only somebody the firm sent a link to can present a signed one", async () => {
    const { chokepoint, steps } = buildChokepoint({
      refusal: {
        type: "guest-link-revoked",
        status: 410,
        title: "This link was withdrawn",
        detail: "The firm withdrew this link.",
      },
    });
    const { app, seen } = mounted(chokepoint, guestMeta("invitation"), steps);
    const response = await app.request("/api/v1/guest/meeting", {
      headers: { [GUEST_CREDENTIAL_HEADER]: await invitationToken() },
    });
    expect(response.status).toBe(410);
    expect(await problemType(response)).toMatch(/\/guest-link-revoked$/);
    expect(seen).toHaveLength(0);
    expect(steps).toEqual([
      "verifyGuestCredential",
      "resolveGuestFirmContext",
      "confirmGuestCredentialIsLive",
    ]);
  });
});

describe("the guest lane — an admitted credential", () => {
  it("runs the lane INSTEAD of the session path: no session, no member-active check, no permission load", async () => {
    const { chokepoint, steps, rateLimitKeys } = buildChokepoint();
    const { app } = mounted(chokepoint, guestMeta("invitation"), steps);
    const response = await app.request("/api/v1/guest/meeting", {
      headers: { [GUEST_CREDENTIAL_HEADER]: await invitationToken() },
    });
    expect(response.status).toBe(200);
    expect(steps).toEqual([
      "verifyGuestCredential",
      "resolveGuestFirmContext",
      "confirmGuestCredentialIsLive",
      "rateLimiter",
      "handler",
    ]);
    expect(steps).not.toContain("loadPermissions");
    expect(steps).not.toContain("resolveSession");
    // One shared link is one bucket, however many people hold it — and never the firm's.
    expect(rateLimitKeys).toEqual([`guest:${INVITATION}`]);
  });

  it("stashes the firm and the credential's names, never a user id and never the secret", async () => {
    const { chokepoint, steps } = buildChokepoint();
    const { app, seen } = mounted(chokepoint, guestMeta("invitation"), steps);
    await app.request("/api/v1/guest/meeting", {
      headers: { [GUEST_CREDENTIAL_HEADER]: await invitationToken() },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.userId).toBeUndefined();
    expect(seen[0]?.firmId).toBe(FIRM);
    expect(seen[0]?.grant).toEqual({
      lane: "invitation",
      firmId: FIRM,
      meetingId: MEETING,
      invitationId: INVITATION,
      secretVersion: 1,
      stayId: null,
    });
    expect(JSON.stringify(seen[0]?.grant)).not.toContain("the-link-secret-itself");
  });

  it("admits a grant on a grant route, carrying the guest's own stay", async () => {
    const { chokepoint, steps } = buildChokepoint();
    const { app, seen } = mounted(
      chokepoint,
      guestMeta("grant"),
      steps,
      "/api/v1/guest/departures",
    );
    const response = await app.request("/api/v1/guest/departures", {
      headers: { [GUEST_CREDENTIAL_HEADER]: await grantToken() },
    });
    expect(response.status).toBe(200);
    expect(seen[0]?.userId).toBeUndefined();
    const grant = seen[0]?.grant as { stayId: string } | undefined;
    expect(grant?.stayId).toBe(STAY);
  });
});

describe("the guest query parameter — the socket upgrade alone", () => {
  const socketPath = "/api/v1/guest/meeting/socket";

  it("is read on a grant route's WebSocket upgrade", async () => {
    const { chokepoint, steps, presented } = buildChokepoint();
    const { app } = mounted(chokepoint, guestMeta("grant"), steps, socketPath);
    const grant = await grantToken();
    const response = await app.request(
      `${socketPath}?${GUEST_CREDENTIAL_QUERY_PARAMETER}=${encodeURIComponent(grant)}`,
      { headers: { upgrade: "websocket" } },
    );
    expect(response.status).toBe(200);
    expect(presented).toEqual([grant]);
  });

  it("is never read on an ordinary request to the same route — no address somebody clicked drives a request", async () => {
    const { chokepoint, steps, presented } = buildChokepoint();
    const { app } = mounted(chokepoint, guestMeta("grant"), steps, socketPath);
    const response = await app.request(
      `${socketPath}?${GUEST_CREDENTIAL_QUERY_PARAMETER}=${encodeURIComponent(await grantToken())}`,
    );
    expect(response.status).toBe(404);
    expect(presented).toEqual([null]);
  });

  it("is never read on an invitation route, upgrade or not", async () => {
    const { chokepoint, steps, presented } = buildChokepoint();
    const { app } = mounted(chokepoint, guestMeta("invitation"), steps);
    const response = await app.request(
      `/api/v1/guest/meeting?${GUEST_CREDENTIAL_QUERY_PARAMETER}=${encodeURIComponent(await invitationToken())}`,
      { headers: { upgrade: "websocket" } },
    );
    expect(response.status).toBe(404);
    expect(presented).toEqual([null]);
  });
});

describe("a guest's credential is never a key to a member route", () => {
  it("answers the reserved 404 before a session is looked for, when the header carries one", async () => {
    const { chokepoint, steps } = buildChokepoint();
    const { app, seen } = mounted(chokepoint, memberMeta, steps, "/api/v1/meetings");
    const response = await app.request("/api/v1/meetings", {
      headers: { [GUEST_CREDENTIAL_HEADER]: await grantToken(), cookie: "session=a-member" },
    });
    expect(response.status).toBe(404);
    expect(steps).toEqual([]);
    expect(seen).toHaveLength(0);
  });

  it("answers the reserved 404 to a member socket upgrade carrying the guest parameter", async () => {
    const { chokepoint, steps } = buildChokepoint();
    const { app } = mounted(chokepoint, memberMeta, steps, "/api/v1/meetings/socket");
    const response = await app.request(
      `/api/v1/meetings/socket?${GUEST_CREDENTIAL_QUERY_PARAMETER}=${encodeURIComponent(await grantToken())}`,
      { headers: { upgrade: "websocket" } },
    );
    expect(response.status).toBe(404);
    expect(steps).toEqual([]);
  });

  it("leaves a member route alone when no guest credential rides it", async () => {
    const { chokepoint, steps } = buildChokepoint();
    const { app } = mounted(chokepoint, memberMeta, steps, "/api/v1/meetings");
    const response = await app.request("/api/v1/meetings");
    expect(response.status).toBe(200);
    // A read naming no capability loads none; the session path is otherwise the ordinary one.
    expect(steps).toEqual(["resolveSession", "resolveFirmContext", "rateLimiter", "handler"]);
  });
});

describe("a guest route can claim nothing a session would carry — refused at registration", () => {
  const routeConfig = {
    method: "get" as const,
    path: "/api/v1/guest/meeting",
    description: "A guest route.",
    responses: {
      200: {
        description: "OK",
        content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
      },
    },
  };

  it.each<[string, Partial<RouteMeta>]>([
    // Authenticated as well, so the guard answering is the lane's own rather than the older one
    // that refuses any unauthenticated route naming a capability.
    ["names a permission", { permission: "meetings:host", authenticated: true }],
    ["is authenticated", { authenticated: true }],
    ["is on the public surface", { surface: "public" }],
    ["is rooted in a matter", { resource: "matter" }],
    ["admits a firmless session", { firmlessSession: "allow" }],
    ["tolerates an unreachable firm database", { firmDatabaseOutage: "tolerate" }],
  ])("throws when a guest route %s", (_label, overrides) => {
    expect(() =>
      defineOpenAPIRoute({ ...guestMeta("invitation"), ...overrides } as RouteMeta, routeConfig),
    ).toThrowError(/guestLane/);
  });

  it("registers the lane as declared, and says so in the contract", () => {
    expect(() => defineOpenAPIRoute(guestMeta("grant"), routeConfig)).not.toThrow();
  });
});
