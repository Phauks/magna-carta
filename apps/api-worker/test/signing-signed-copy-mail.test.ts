// Mailing each outside signer the link to their signed copy once a request is sealed: who is mailed,
// and that the link is the copy's own kind, good for 30 days from the sealing.
import { describe, expect, it } from "vitest";
import type {
  FirmId,
  SigningRequestId,
  SigningSignerId,
  UserId,
} from "@magna-carta/identifiers/types";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { mailSignedCopies } from "../src/signing/signer-delivery.ts";
import { SIGNED_COPY_TOKEN_TYPE, readSignerLink } from "../src/signing/signer-link.ts";
import type { SigningRequestRow, SigningSignerRow } from "../src/signing/statements.ts";

const KEY = "a-test-signing-key-that-is-long-enough";
const FIRM: FirmId = newIdentifier("firm");
const REQUEST: SigningRequestId = newIdentifier("signingRequest");
const SEALED = "2026-11-19T18:00:00.000Z";

function signer(
  name: string,
  attributionLevel: SigningSignerRow["attributionLevel"],
  status: SigningSignerRow["status"] = "signed",
): SigningSignerRow {
  return {
    id: newIdentifier("signingSigner") as SigningSignerId,
    requestId: REQUEST,
    position: 0,
    name,
    email: `${name.toLowerCase()}@example.com`,
    attributionLevel,
    userId: attributionLevel === "firm-authenticated" ? (newIdentifier("user") as UserId) : null,
    codeChannel: attributionLevel === "access-code" ? "email" : null,
    mobileNumber: null,
    status,
    notifiedAt: null,
    openedAt: null,
    signedAt: SEALED,
    declinedAt: null,
    declineReason: null,
    secretVersion: 1,
    consentDisclosureVersion: null,
    consentedAt: null,
    adoption: null,
    signatureObjectKey: null,
    initialsObjectKey: null,
  };
}

const request = {
  id: REQUEST,
  title: "Engagement.pdf",
  sealedAt: SEALED,
} as unknown as SigningRequestRow & {
  readonly sealedAt: string;
};

describe("mailing the signed copies", () => {
  it("mails each outside signer a copy link and leaves colleagues to the app", async () => {
    const sent: { to: string; subject: string; text: string; messageClass?: string }[] = [];
    const outside = signer("Jordan", "email-link");
    const coded = signer("Casey", "access-code");
    const colleague = signer("Robin", "firm-authenticated");
    const result = await mailSignedCopies(
      {
        send: (message) => {
          sent.push(message);
          return Promise.resolve();
        },
        key: KEY,
        firmId: FIRM,
        firmName: "Goldsmith Law",
        senderName: "Trevor Goldsmith",
        origin: "https://app.example.com",
      },
      request,
      [outside, coded, colleague],
    );
    expect(result).toEqual({ mailed: 2, failed: 0 });
    expect(sent.map((message) => message.to)).toEqual(["jordan@example.com", "casey@example.com"]);
    expect(sent.every((message) => message.messageClass === "signing-completed")).toBe(true);

    const token = /\/sign\/copy\/([^\s]+)/.exec(sent[0]?.text ?? "")?.[1] ?? "";
    const sealedSeconds = Math.floor(Date.parse(SEALED) / 1000);
    const read = await readSignerLink(
      KEY,
      decodeURIComponent(token),
      sealedSeconds,
      SIGNED_COPY_TOKEN_TYPE,
    );
    expect(read?.outcome).toBe("verified");
    expect(read?.link.signerId).toBe(outside.id);
    const after = sealedSeconds + 30 * 24 * 60 * 60;
    expect(
      (await readSignerLink(KEY, decodeURIComponent(token), after, SIGNED_COPY_TOKEN_TYPE))
        ?.outcome,
    ).toBe("expired");
  });

  it("counts a mail the service refused, and mails the rest", async () => {
    let calls = 0;
    const result = await mailSignedCopies(
      {
        send: () => {
          calls += 1;
          return calls === 1 ? Promise.reject(new Error("refused")) : Promise.resolve();
        },
        key: KEY,
        firmId: FIRM,
        firmName: "",
        senderName: "Trevor Goldsmith",
        origin: "https://app.example.com",
      },
      request,
      [signer("Jordan", "email-link"), signer("Casey", "email-link")],
    );
    expect(result).toEqual({ mailed: 1, failed: 1 });
  });
});
