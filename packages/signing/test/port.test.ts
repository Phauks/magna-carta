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
      sealedAt: "2026-07-18T12:00:01Z",
      signers: [signer],
    };
    const response: SealResponse = {
      sealedPdf: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 255, 128]),
      documentHashSha256: "a".repeat(64),
      certificate,
      certificateText: "CERTIFICATE OF COMPLETION\n",
    };
    const decoded = decodeSealResponse(encodeSealResponse(response));
    expect(decoded.sealedPdf).toEqual(response.sealedPdf);
    expect(decoded.documentHashSha256).toBe(response.documentHashSha256);
    expect(decoded.certificate).toEqual(certificate);
    expect(decoded.certificateText).toBe(response.certificateText);
  });
});
