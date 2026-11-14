import { describe, expect, it } from "vitest";

import {
  decodeSealRequest,
  decodeSealResponse,
  encodeSealRequest,
  encodeSealResponse,
  type SealRequest,
  type SealResponse,
} from "../src/port.ts";
import type { CertificateOfCompletion, SignerCompletion } from "../src/esign.ts";

const signer: SignerCompletion = {
  intent: { signerId: "usr_1", adoption: "typed", affirmedAt: "2026-07-18T12:00:00Z" },
  consent: { disclosureVersion: "v1", consentedAt: "2026-07-18T11:59:00Z" },
  attribution: { level: "firm-authenticated" },
};

describe("SealPort wire codec", () => {
  it("round-trips a request, preserving the document bytes exactly", () => {
    const request: SealRequest = {
      document: new Uint8Array([0, 1, 2, 253, 254, 255, 0x25, 0x50, 0x44, 0x46]),
      signers: [signer],
      signingTime: "2026-07-18T12:00:01Z",
      seal: { reason: "Engagement letter", contentsCapacity: 8192 },
    };
    const decoded = decodeSealRequest(encodeSealRequest(request));
    expect(decoded.document).toEqual(request.document);
    expect(decoded.signers).toEqual(request.signers);
    expect(decoded.signingTime).toBe(request.signingTime);
    expect(decoded.seal).toEqual(request.seal);
  });

  it("round-trips a response, preserving the sealed bytes exactly", () => {
    const certificate: CertificateOfCompletion = {
      documentHashSha256: "a".repeat(64),
      reference: "MC-AAAA-AAAA-AAAA",
      sealedAt: "2026-07-18T12:00:01Z",
      signers: [signer],
    };
    const response: SealResponse = {
      sealedPdf: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 255, 128]),
      documentHashSha256: "a".repeat(64),
      certificate,
      certificateText: "CERTIFICATE OF COMPLETION\n",
      certificatePdf: new Uint8Array([0x25, 0x50, 0x44, 0x46, 7, 0, 200]),
    };
    const decoded = decodeSealResponse(encodeSealResponse(response));
    expect(decoded.sealedPdf).toEqual(response.sealedPdf);
    expect(decoded.documentHashSha256).toBe(response.documentHashSha256);
    expect(decoded.certificate).toEqual(certificate);
    expect(decoded.certificateText).toBe(response.certificateText);
    expect(decoded.certificatePdf).toEqual(response.certificatePdf);
  });

  it("carries the envelope and the observed steps to the sealing service", () => {
    const request: SealRequest = {
      document: new Uint8Array([1, 2, 3]),
      signers: [signer],
      signingTime: "2026-07-18T12:00:01Z",
      envelope: { id: "env_0001", title: "Engagement letter.pdf" },
      events: [{ kind: "sent", at: "2026-07-18T11:50:00Z", actor: "Bob Sender" }],
    };
    const decoded = decodeSealRequest(encodeSealRequest(request));
    expect(decoded.envelope).toEqual(request.envelope);
    expect(decoded.events).toEqual(request.events);
  });

  it("carries each signature's picture byte for byte, and none when none was given", () => {
    const request: SealRequest = {
      document: new Uint8Array([1, 2, 3]),
      signers: [signer],
      signingTime: "2026-07-18T12:00:01Z",
      signatureImages: [
        { signerId: "usr_1", image: new Uint8Array([0x89, 0x50, 0, 255, 128]), pages: [1, 3] },
        { signerId: "usr_1", image: new Uint8Array([0x89, 0x50, 9]) },
      ],
      initialsImages: [{ signerId: "usr_1", image: new Uint8Array([0x89, 0x50, 7, 0, 200]) }],
    };
    const decoded = decodeSealRequest(encodeSealRequest(request));
    expect(decoded.signatureImages).toEqual(request.signatureImages);
    expect(decoded.initialsImages).toEqual(request.initialsImages);
    const { signatureImages: _signatures, initialsImages: _initials, ...bare } = request;
    expect(decodeSealRequest(encodeSealRequest(bare)).signatureImages).toBeUndefined();
    expect(decodeSealRequest(encodeSealRequest(bare)).initialsImages).toBeUndefined();
  });
});
