import type { OpenAPIHono } from "@hono/zod-openapi";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { readInspectableSizeCap } from "@magna-carta/file-manager/upload-policy";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { DocumentSealRequest, DocumentSealResponse } from "@magna-carta/signing/contract";
import type { SignerCompletion } from "@magna-carta/signing/esign";
import type { SealPort, SealRequest } from "@magna-carta/signing/port";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import {
  resolveSealPort,
  SealFailedError,
  SealNotConfiguredError,
} from "../../../documents/seal-port-binding.ts";

// atob -> Uint8Array.
function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Uint8Array -> base64, chunked so large files do not blow the argument stack of String.fromCharCode.
function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export const documentSealMeta: RouteMeta = {
  operationId: "esign.seal",
  surface: "app",
  authenticated: true,
  permission: "esign:seal",
  resource: "firm",
  // Writes an esign.sealed audit row to the per-firm audit_log — the chain-of-custody record that the
  // seal was applied, who applied it, and to what document (by digest). Never the document content.
  audited: true,
  idempotency: "optional",
  rateLimit: "expensive",
};

const sealRoute = defineOpenAPIRoute(documentSealMeta, {
  method: "post",
  path: "/api/v1/documents/seal",
  description:
    "Apply the platform seal to a PDF (base64): the sign service embeds a PAdES CMS signature over " +
    "the document with the platform signing identity, returning the sealed PDF, the sealed-range " +
    "digest, and a Certificate of Completion assembled from the supplied signer records: the " +
    "structured record, its plain text, and a sealed PDF sheet listing each signer and the audit " +
    "log (consent, signature and seal, each with its server-observed time and address). The seal " +
    "makes the completed record tamper-evident; it is not a per-signer certificate. Nothing is " +
    "stored here; only a redacted audit record is written.",
  request: {
    body: {
      content: { "application/json": { schema: DocumentSealRequest } },
      required: true,
    },
  },
  responses: {
    200: {
      description:
        "The sealed PDF (base64), the sealed-range SHA-256, and the Certificate of Completion",
      content: { "application/json": { schema: DocumentSealResponse } },
    },
    400: {
      description: "File too large to seal, or the document bytes could not be decoded",
      content: { "application/problem+json": { schema: Problem } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated but the member lacks esign:seal",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "The document could not be sealed (unparseable, no page to anchor, capacity)",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
    503: {
      description:
        "The platform seal is not configured (the sign service has no signing identity yet)",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerDocumentSealRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
  // Tests inject a fake SealPort to drive the sealed-response path without a live sign worker (the
  // local pool has no signing identity). Production resolves the port from the SIGN_SERVICE binding.
  sealPortOverride?: SealPort,
): void {
  // POST /api/v1/documents/seal — apply the platform seal to a submitted PDF via the dedicated sign
  // worker (which alone holds the signing key). The document is never stored; only a redacted audit
  // row is committed (digest, signer count, actor — no content).
  app.openapi(
    { ...sealRoute, middleware: chokepointMiddleware(chokepoint, sealRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { documentBase64, signers, seal, documentTitle } = c.req.valid("json");

      // Enforce the firm's inspectable-size cap before decoding the base64 body. The base64
      // representation is ~33% larger than the binary, so the decoded byte count is approximately
      // documentBase64.length × 0.75. Apply the cap conservatively against this estimate.
      const estimatedBytes = Math.ceil((documentBase64.length * 3) / 4);
      const cap = await readInspectableSizeCap(firm.firmDatabase);
      if (estimatedBytes > cap) {
        return problemJson(c, {
          type: "upload-not-allowed",
          status: 400,
          title: "File too large to seal",
          detail: `The document exceeds this firm's inspectable-size cap (${cap} bytes).`,
        });
      }

      // Guard against malformed base64: atob() throws DOMException on invalid input, which would
      // otherwise escape as an unhandled 500. Catch it here and return a 400 that carries no echo
      // of the submitted value.
      let document: Uint8Array;
      try {
        document = decodeBase64(documentBase64);
      } catch {
        return problemJson(c, {
          type: "validation",
          status: 400,
          title: "Document bytes could not be decoded",
          detail: "The submitted document could not be decoded. Ensure the body is valid base64.",
        });
      }

      // The signing time is server-authoritative (never client-supplied), and observedIp is the
      // server-observed connecting IP, not a client self-report (see @magna-carta/signing/esign).
      const signingTime = new Date().toISOString();
      const observedIp = c.req.header("CF-Connecting-IP");
      const userAgent = c.req.header("User-Agent");
      const attributedSigners: SignerCompletion[] = signers.map((signer) => ({
        intent: signer.intent,
        consent: signer.consent,
        attribution: {
          level: signer.attribution.level,
          ...(observedIp !== undefined ? { observedIp } : {}),
          ...(userAgent !== undefined ? { userAgent } : {}),
          ...(signer.attribution.proofReference !== undefined
            ? { proofReference: signer.attribution.proofReference }
            : {}),
        },
      }));

      // The certificate's reference is the identifier of the audit row this seal is logged under,
      // so the sheet a firm files and the firm's own audit trail name the same record.
      const auditLogId = newIdentifier("auditLog");
      const request: SealRequest = {
        document,
        signers: attributedSigners,
        signingTime,
        ...(seal !== undefined ? { seal } : {}),
        envelope: {
          id: auditLogId,
          ...(documentTitle !== undefined ? { title: documentTitle } : {}),
        },
      };

      const sealPort = sealPortOverride ?? resolveSealPort(c.env.SIGN_SERVICE);
      let sealed: Awaited<ReturnType<typeof sealPort.seal>>;
      try {
        sealed = await sealPort.seal(request);
      } catch (error) {
        if (error instanceof SealNotConfiguredError) {
          return problemJson(c, {
            type: "service-unavailable",
            status: 503,
            title: "Platform seal not configured",
            detail: "The platform seal is not currently available. Try again shortly.",
          });
        }
        if (error instanceof SealFailedError) {
          // Permanent for these bytes — a 503 would invite an endless retry against a document that
          // will never seal. Carry no echo of the document content in the response.
          return problemJson(c, {
            type: "validation",
            status: 422,
            title: "Document could not be sealed",
            detail:
              "The document could not be sealed. Ensure it is a valid PDF with at least one page.",
          });
        }
        throw error;
      }

      // Write the chain-of-custody audit row before returning. Metadata carries the actor id, the
      // sealed-range digest, and the signer count — never the document content or the sealed bytes.
      const now = new Date().toISOString();
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            insertAuditLogStatement(firm.firmDatabase, {
              id: auditLogId,
              event: "esign.sealed",
              actorUserId: userId,
              // No persistent document record for this stateless seal operation — the digest in
              // metadata is the traceability anchor, not a database subject id.
              subjectId: null,
              metadata: {
                actorUserId: userId,
                documentHashSha256: sealed.documentHashSha256,
                signerCount: sealed.certificate.signers.length,
                outcome: "sealed",
              },
              now,
            }),
          ],
          outboxMessages: [],
        },
        { now: () => now },
      );

      return c.json(
        {
          sealedPdfBase64: encodeBase64(sealed.sealedPdf),
          documentHashSha256: sealed.documentHashSha256,
          // The certificate models an immutable record, so its signer list is a readonly array;
          // the response body is a plain JSON value, so copy it into a mutable one here rather
          // than weakening the record's own type.
          certificate: {
            ...sealed.certificate,
            signers: [...sealed.certificate.signers],
            events: [...(sealed.certificate.events ?? [])],
          },
          certificateText: sealed.certificateText,
          certificatePdfBase64: encodeBase64(sealed.certificatePdf),
        },
        200,
      );
    },
  );
}
