// A MEETING GUEST'S TWO CREDENTIALS, and the one signed-token format they share with the support
// session. Every way a credential is not one answers the same null, and never a throw — a stranger
// guessing at a guest route must learn nothing, and a length mismatch must not become an Error ID.
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FirmId,
  MeetingGuestInvitationId,
  MeetingGuestStayId,
  MeetingId,
  PlatformStaffId,
  SupportGrantId,
  UserId,
} from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  GUEST_GRANT_TOKEN_TYPE,
  GUEST_INVITATION_TOKEN_TYPE,
  mintGuestGrantToken,
  mintGuestInvitationToken,
  verifyGuestCredential,
} from "../src/meetings/guest-token.ts";
import { mintSignedToken, verifySignedToken } from "../src/signed-token.ts";
import {
  mintSupportSessionToken,
  verifySupportSessionToken,
} from "../src/support/support-session-token.ts";

const SECRET = "guest-token-test-secret";
const FIRM = newIdentifier("firm") as FirmId;
const MEETING = newIdentifier("meeting") as MeetingId;
const INVITATION = newIdentifier("meetingGuestInvitation") as MeetingGuestInvitationId;
const STAY = newIdentifier("meetingGuestStay") as MeetingGuestStayId;

const NOW_SECONDS = Math.floor(Date.parse("2026-09-24T12:00:00.000Z") / 1000);
const LATER = "2026-09-24T15:00:00.000Z";
const EARLIER = "2026-09-24T11:00:00.000Z";

async function invitation(overrides: { expiresAt?: string; secretVersion?: number } = {}) {
  return await mintGuestInvitationToken(SECRET, {
    firmId: FIRM,
    meetingId: MEETING,
    invitationId: INVITATION,
    secretVersion: overrides.secretVersion ?? 1,
    secret: "the-link-secret",
    expiresAt: overrides.expiresAt ?? LATER,
  });
}

async function grant(overrides: { expiresAt?: string } = {}) {
  return await mintGuestGrantToken(SECRET, {
    firmId: FIRM,
    meetingId: MEETING,
    invitationId: INVITATION,
    secretVersion: 1,
    stayId: STAY,
    expiresAt: overrides.expiresAt ?? LATER,
  });
}

/** The same token with its payload segment rewritten, and its original signature kept. */
function withPayload(token: string, change: (payload: Record<string, unknown>) => void): string {
  const [body, signature] = token.split(".");
  const decoded = JSON.parse(atob((body ?? "").replace(/-/g, "+").replace(/_/g, "/"))) as Record<
    string,
    unknown
  >;
  change(decoded);
  const reencoded = btoa(JSON.stringify(decoded))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${reencoded}.${signature ?? ""}`;
}

describe("the invitation — what the e-mail carries", () => {
  it("verifies as what it names, carrying the secret and no stay", async () => {
    const verified = await verifyGuestCredential(
      SECRET,
      await invitation(),
      "invitation",
      NOW_SECONDS,
    );
    expect(verified).toEqual({
      lane: "invitation",
      firmId: FIRM,
      meetingId: MEETING,
      invitationId: INVITATION,
      secretVersion: 1,
      secret: "the-link-secret",
      stayId: null,
      expiresAt: Math.floor(Date.parse(LATER) / 1000),
    });
  });

  it("carries the version it was minted at — a rotation's check is the row's, not the token's", async () => {
    const verified = await verifyGuestCredential(
      SECRET,
      await invitation({ secretVersion: 3 }),
      "invitation",
      NOW_SECONDS,
    );
    expect(verified?.secretVersion).toBe(3);
  });

  it("is refused once past its own expiry", async () => {
    expect(
      await verifyGuestCredential(
        SECRET,
        await invitation({ expiresAt: EARLIER }),
        "invitation",
        NOW_SECONDS,
      ),
    ).toBeNull();
  });

  it("is refused when its payload was changed under the signature", async () => {
    const tampered = withPayload(await invitation(), (payload) => {
      payload["meetingId"] = newIdentifier("meeting");
    });
    expect(await verifyGuestCredential(SECRET, tampered, "invitation", NOW_SECONDS)).toBeNull();
  });

  it("is refused when its expiry was extended under the signature", async () => {
    const tampered = withPayload(await invitation({ expiresAt: EARLIER }), (payload) => {
      payload["exp"] = NOW_SECONDS + 86_400;
    });
    expect(await verifyGuestCredential(SECRET, tampered, "invitation", NOW_SECONDS)).toBeNull();
  });

  it("is refused when signed with a secret this deployment does not hold", async () => {
    const foreign = await mintGuestInvitationToken("another-deployment", {
      firmId: FIRM,
      meetingId: MEETING,
      invitationId: INVITATION,
      secretVersion: 1,
      secret: "the-link-secret",
      expiresAt: LATER,
    });
    expect(await verifyGuestCredential(SECRET, foreign, "invitation", NOW_SECONDS)).toBeNull();
  });

  it("is refused when correctly signed but naming no secret", async () => {
    const bare = await mintSignedToken(SECRET, GUEST_INVITATION_TOKEN_TYPE, {
      firmId: FIRM,
      meetingId: MEETING,
      invitationId: INVITATION,
      secretVersion: 1,
      exp: NOW_SECONDS + 600,
    });
    expect(await verifyGuestCredential(SECRET, bare, "invitation", NOW_SECONDS)).toBeNull();
  });
});

describe("the grant — what an arrival answers with", () => {
  it("verifies carrying the stay and no secret", async () => {
    const verified = await verifyGuestCredential(SECRET, await grant(), "grant", NOW_SECONDS);
    expect(verified?.stayId).toBe(STAY);
    expect(verified?.secret).toBeNull();
  });

  it("is refused once past its own expiry", async () => {
    expect(
      await verifyGuestCredential(
        SECRET,
        await grant({ expiresAt: EARLIER }),
        "grant",
        NOW_SECONDS,
      ),
    ).toBeNull();
  });

  it("is refused when correctly signed but naming no stay", async () => {
    const bare = await mintSignedToken(SECRET, GUEST_GRANT_TOKEN_TYPE, {
      firmId: FIRM,
      meetingId: MEETING,
      invitationId: INVITATION,
      secretVersion: 1,
      exp: NOW_SECONDS + 600,
    });
    expect(await verifyGuestCredential(SECRET, bare, "grant", NOW_SECONDS)).toBeNull();
  });
});

describe("one format, several kinds — the type is load-bearing", () => {
  it("a grant is not a link, and a link is not a grant", async () => {
    expect(
      await verifyGuestCredential(SECRET, await grant(), "invitation", NOW_SECONDS),
    ).toBeNull();
    expect(
      await verifyGuestCredential(SECRET, await invitation(), "grant", NOW_SECONDS),
    ).toBeNull();
  });

  it("a support-session token is neither, and neither guest credential is a support session", async () => {
    const support = await mintSupportSessionToken(SECRET, {
      grantId: newIdentifier("supportGrant") as SupportGrantId,
      principalId: newIdentifier("platformStaff") as PlatformStaffId,
      firmId: FIRM,
      requesterUserId: newIdentifier("user") as UserId,
      tier: "diagnostic",
      exp: NOW_SECONDS + 600,
    });
    expect(await verifyGuestCredential(SECRET, support, "invitation", NOW_SECONDS)).toBeNull();
    expect(await verifyGuestCredential(SECRET, support, "grant", NOW_SECONDS)).toBeNull();
    expect(await verifySupportSessionToken(SECRET, await invitation(), NOW_SECONDS)).toBeNull();
    expect(await verifySupportSessionToken(SECRET, await grant(), NOW_SECONDS)).toBeNull();
    // And the support session still verifies as itself over the shared format.
    expect((await verifySupportSessionToken(SECRET, support, NOW_SECONDS))?.firmId).toBe(FIRM);
  });

  it("the type cannot be overridden by the payload a caller hands the minter", async () => {
    const token = await mintSignedToken(SECRET, GUEST_GRANT_TOKEN_TYPE, {
      typ: GUEST_INVITATION_TOKEN_TYPE,
    });
    expect(await verifySignedToken(SECRET, token, GUEST_GRANT_TOKEN_TYPE)).not.toBeNull();
    expect(await verifySignedToken(SECRET, token, GUEST_INVITATION_TOKEN_TYPE)).toBeNull();
  });
});

describe("every malformed credential answers null, never a throw", () => {
  it.each([
    ["an empty string", ""],
    ["no separator", "abcdef"],
    ["an empty signature", "abc."],
    ["an empty payload", ".abc"],
    ["a signature of another length", "eyJ0eXAiOiJ4In0.x"],
    ["a payload that is not base64", "!!!!.abcd"],
    ["a very long value", "a".repeat(10_000) + "." + "b".repeat(10_000)],
  ])("%s", async (_label, presented) => {
    await expect(
      verifyGuestCredential(SECRET, presented, "invitation", NOW_SECONDS),
    ).resolves.toBeNull();
    await expect(
      verifyGuestCredential(SECRET, presented, "grant", NOW_SECONDS),
    ).resolves.toBeNull();
  });
});
