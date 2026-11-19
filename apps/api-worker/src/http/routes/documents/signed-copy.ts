import type { OpenAPIHono } from "@hono/zod-openapi";
import type { SigningRequestId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../../../bindings.ts";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import { certificateFileName } from "../../../signing/seal-completed.ts";
import { signedCopyRefusalFor } from "../../../signing/signer-refusals.ts";
import {
  readFileForSigning,
  readMemberName,
  readRequest,
  readVersionObjectKey,
} from "../../../signing/statements.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointSignerGrant,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { problemJson } from "../../contracts/problem.ts";
import type { SignerContext } from "./signer-lanes.ts";
import {
  signedCopyCertificateRoute,
  signedCopyDocumentRoute,
  signedCopyRoute,
} from "./signed-copy-routes.ts";

// What the link in the completion email opens: the signed copy and its certificate, for each signer
// to keep. The chokepoint has already verified the link and found the request completed and sealed,
// so a handler here only reads. The copy served is the version the seal filed, never whatever the
// file's current version has since become.

type App = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

async function sealedRequest(c: SignerContext) {
  const grant = requireChokepointSignerGrant(c);
  const request = await readRequest(
    requireChokepointFirmContext(c).firmDatabase,
    grant.requestId as SigningRequestId,
  );
  return request === undefined ||
    request.sealedAt === null ||
    request.signedFileVersionId === null ||
    request.certificateFileId === null
    ? undefined
    : {
        ...request,
        sealedAt: request.sealedAt,
        signedFileVersionId: request.signedFileVersionId,
        certificateFileId: request.certificateFileId,
      };
}

function gone(c: SignerContext) {
  return problemJson(c, {
    type: "not-found",
    title: "Not found",
    status: 404,
    detail: "The signed copy is no longer available. Ask whoever sent you the document.",
  });
}

async function servePdf(c: SignerContext, key: string | undefined, fileName: string) {
  // A filed copy is held back until the ingest has scanned it; until then it is not ready, not gone.
  if (key === undefined) return problemJson(c, signedCopyRefusalFor("not-ready"));
  const firm = requireChokepointFirmContext(c);
  const object = await resolveFirmBucket(c.env, firm.bucketName).bucket.get(key);
  if (object === null) return gone(c);
  return new Response(object.body, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export function registerSignedCopyRoutes(app: App, chokepoint: Chokepoint): void {
  app.openapi(
    { ...signedCopyRoute, middleware: chokepointMiddleware(chokepoint, signedCopyRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = await sealedRequest(c);
      if (request === undefined) return gone(c) as never;
      const document = await readFileForSigning(firm.firmDatabase, request.fileId);
      const documentFileName = document?.name ?? `${request.title}.pdf`;
      return c.json(
        {
          title: request.title,
          firmName: await firm.readFirmName(),
          senderName: await readMemberName(firm.firmDatabase, request.createdByUserId),
          sealedAt: request.sealedAt,
          documentFileName,
          certificateFileName: certificateFileName(documentFileName),
        },
        200,
      );
    },
  );
  app.openapi(
    {
      ...signedCopyDocumentRoute,
      middleware: chokepointMiddleware(chokepoint, signedCopyDocumentRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = await sealedRequest(c);
      if (request === undefined) return gone(c) as never;
      const document = await readFileForSigning(firm.firmDatabase, request.fileId);
      const key = await readVersionObjectKey(firm.firmDatabase, request.signedFileVersionId);
      return (await servePdf(c, key, document?.name ?? `${request.title}.pdf`)) as never;
    },
  );
  app.openapi(
    {
      ...signedCopyCertificateRoute,
      middleware: chokepointMiddleware(chokepoint, signedCopyCertificateRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const request = await sealedRequest(c);
      if (request === undefined) return gone(c) as never;
      const certificate = await readFileForSigning(firm.firmDatabase, request.certificateFileId);
      return (await servePdf(
        c,
        certificate?.r2Key,
        certificate?.name ?? "Certificate.pdf",
      )) as never;
    },
  );
}
