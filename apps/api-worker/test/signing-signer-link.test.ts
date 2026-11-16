// A signer's link: what it carries, and every way a presented one is not one. Runs in the Workers
// runtime because the token's comparison is the runtime's constant-time one.
import { describe, expect, it } from "vitest";
import type { FirmId, SigningRequestId, SigningSignerId } from "@magna-carta/identifiers/types";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { mintGuestInvitationToken } from "../src/meetings/guest-token.ts";
import {
  hashAccessCode,
  hashSignerSecret,
  mintSignerLink,
  newAccessCode,
  readSignerLink,
  signerLinkSecret,
} from "../src/signing/signer-link.ts";

const KEY = "a-test-signing-key-that-is-long-enough";
const FIRM: FirmId = newIdentifier("firm");
const REQUEST: SigningRequestId = newIdentifier("signingRequest");
const SIGNER: SigningSignerId = newIdentifier("signingSigner");
const LATER = "2030-01-01T00:00:00.000Z";
const NOW_SECONDS = Math.floor(Date.parse("2026-11-13T12:00:00.000Z") / 1000);

async function link(expiresAt = LATER, secretVersion = 1): Promise<string> {
  return await mintSignerLink(KEY, {
    firmId: FIRM,
    requestId: REQUEST,
    signerId: SIGNER,
    secretVersion,
    expiresAt,
  });
}

describe("a signer's link", () => {
  it("names the firm, the request, the signer and the version, and carries the derived secret", async () => {
    const read = await readSignerLink(KEY, await link(), NOW_SECONDS);
    expect(read?.outcome).toBe("verified");
    expect(read?.link).toEqual({
      firmId: FIRM,
      requestId: REQUEST,
      signerId: SIGNER,
      secretVersion: 1,
      secret: await signerLinkSecret(KEY, FIRM, SIGNER, 1),
    });
  });

  it("is the same link each time it is minted, so a reminder does not replace the first mail's", async () => {
    expect(await link()).toBe(await link());
    expect(await signerLinkSecret(KEY, FIRM, SIGNER, 2)).not.toBe(
      await signerLinkSecret(KEY, FIRM, SIGNER, 1),
    );
  });

  it("is refused flat when tampered, signed with another key, or another kind of token", async () => {
    const token = await link();
    const tampered = `${token.slice(0, -2)}${token.endsWith("A") ? "B" : "A"}x`;
    expect(await readSignerLink(KEY, tampered, NOW_SECONDS)).toBeNull();
    expect(await readSignerLink("another-key-entirely-and-long", token, NOW_SECONDS)).toBeNull();
    const guest = await mintGuestInvitationToken(KEY, {
      firmId: FIRM,
      meetingId: newIdentifier("meeting"),
      invitationId: newIdentifier("meetingGuestInvitation"),
      secretVersion: 1,
      secret: "s",
      expiresAt: LATER,
    });
    expect(await readSignerLink(KEY, guest, NOW_SECONDS)).toBeNull();
    expect(await readSignerLink(KEY, "not-a-token", NOW_SECONDS)).toBeNull();
  });

  it("says it has expired, rather than nothing, once the request's last moment has passed", async () => {
    const read = await readSignerLink(KEY, await link("2026-11-01T00:00:00.000Z"), NOW_SECONDS);
    expect(read?.outcome).toBe("expired");
  });

  it("stores only digests: the secret's, and a keyed one of the code", async () => {
    const secret = await signerLinkSecret(KEY, FIRM, SIGNER, 1);
    expect(await hashSignerSecret(secret)).toMatch(/^[0-9a-f]{64}$/);
    const code = newAccessCode();
    expect(code).toMatch(/^\d{6}$/);
    const digest = await hashAccessCode(KEY, SIGNER, code);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashAccessCode("another-key-entirely-and-long", SIGNER, code)).not.toBe(digest);
  });
});
