import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  commitEffectBatch,
  GuardedWriteRefusedError,
  type EffectWrite,
} from "@magna-carta/data-access/effect-batch";
import type { SigningRequestId, SigningSignerId } from "@magna-carta/identifiers/types";
import { matterScopedObjectDimensions } from "@magna-carta/object-dimensions";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import { constantTimeStringEquals } from "../../../constant-time.ts";
import { sendMessage } from "../../../email-delivery.ts";
import type { SendEmail } from "../../../email-port.ts";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import { SigningRequestRefusal } from "../../../signing/request-service.ts";
import {
  MAXIMUM_MARK_BYTES,
  maskedAddress,
  signerViewBody,
} from "../../../signing/signer-contract.ts";
import { linkStatements, mailSigners } from "../../../signing/signer-delivery.ts";
import { hashAccessCode, newAccessCode } from "../../../signing/signer-link.ts";
import {
  ACCESS_CODE_LIFETIME_MINUTES,
  SignerStepRefusal,
  adoptSignature,
  checkAccessCode,
  declineSigning,
  finishSigning,
  giveConsent,
  issueAccessCode,
  needsCode,
  openRequest,
  readSignerView,
  type Observed,
  type SignerView,
} from "../../../signing/signer-service.ts";
import {
  SIGNING_ACCESS_CODE_MESSAGE_CLASS,
  accessCodeEmail,
} from "../../../signing/signing-mail.ts";
import { readMemberName, readVersionObjectKey } from "../../../signing/statements.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointSignerGrant,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import {
  adoptRoute,
  checkCodeRoute,
  consentRoute,
  declineRoute,
  documentRoute,
  finishRoute,
  openRoute,
  readRoute,
  sendCodeRoute,
} from "./signer-routes.ts";

// An outside signer's side of a signing request, on the chokepoint's signer lane. The lane has
// already verified the link and checked it against the signer's row; every handler reads the
// request afresh, asks the signer service (../../../signing/signer-service.ts) whether the act is
// the signer's to take now, and commits what it returns. The IP address and browser recorded with
// each act are the edge's own reading of the request, never anything the page sends.
//
// Nothing here logs, echoes or stores the link, the code, or an adopted image's bytes beyond the
// firm's own bucket.

type App = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;
type SignerContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAXIMUM_USER_AGENT = 300;

function observedFrom(c: SignerContext): Observed {
  const userAgent = c.req.header("user-agent");
  return {
    now: new Date().toISOString(),
    ip: c.req.header("cf-connecting-ip") ?? null,
    userAgent: userAgent === undefined ? null : userAgent.slice(0, MAXIMUM_USER_AGENT),
  };
}

async function viewFor(c: SignerContext): Promise<SignerView> {
  const grant = requireChokepointSignerGrant(c);
  return await readSignerView(
    requireChokepointFirmContext(c).firmDatabase,
    grant.requestId as SigningRequestId,
    grant.signerId as SigningSignerId,
  );
}

async function namesFor(
  c: SignerContext,
  view: SignerView,
): Promise<{ firmName: string; senderName: string }> {
  const firm = requireChokepointFirmContext(c);
  return {
    firmName: await firm.readFirmName(),
    senderName: await readMemberName(firm.firmDatabase, view.detail.request.createdByUserId),
  };
}

async function freshViewBody(c: SignerContext) {
  const view = await viewFor(c);
  return signerViewBody(view, await namesFor(c, view));
}

async function commit(c: SignerContext, effect: EffectWrite, now: string): Promise<void> {
  await commitEffectBatch(requireChokepointFirmContext(c).firmDatabase, effect, { now: () => now });
}

function refusal(
  c: SignerContext,
  error: unknown,
): ProblemResponse<404> | ProblemResponse<409> | ProblemResponse<422> | undefined {
  if (error instanceof GuardedWriteRefusedError) {
    return problemJson(c, {
      type: "signing-request-moved",
      title: "The request changed",
      status: 409,
      detail: "Something changed while you were signing. Reload the page and try again.",
    });
  }
  if (error instanceof SignerStepRefusal) {
    return problemJson(c, {
      type: "signing-step-refused",
      title: error.status === 422 ? "Something is missing" : "Not yet",
      status: error.status,
      detail: error.message,
    });
  }
  if (error instanceof SigningRequestRefusal) {
    return problemJson(c, {
      type: "not-found",
      title: "Not found",
      status: 404,
      detail: "No such resource in this firm.",
    });
  }
  return undefined;
}

function decodePng(base64: string): Uint8Array<ArrayBuffer> | null {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const binary = atob(base64);
    bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  } catch {
    return null;
  }
  if (bytes.length > MAXIMUM_MARK_BYTES || bytes.length < PNG_SIGNATURE.length) return null;
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte) ? bytes : null;
}

export function registerSignerRoutes(
  app: App,
  chokepoint: Chokepoint,
  sendEmail: (env: Bindings) => SendEmail,
): void {
  app.openapi(
    { ...readRoute, middleware: chokepointMiddleware(chokepoint, readRoute) },
    async (c) => {
      try {
        return c.json(await freshViewBody(c), 200);
      } catch (error) {
        const answer = refusal(c, error);
        if (answer !== undefined) return answer;
        throw error;
      }
    },
  );

  app.openapi(
    { ...documentRoute, middleware: chokepointMiddleware(chokepoint, documentRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const view = await viewFor(c);
      const key = await readVersionObjectKey(firm.firmDatabase, view.detail.request.fileVersionId);
      const object =
        key === undefined ? null : await resolveFirmBucket(c.env, firm.bucketName).bucket.get(key);
      if (object === null) {
        return problemJson(c, {
          type: "not-found",
          title: "Not found",
          status: 404,
          detail: "The document is no longer available. Ask whoever sent it.",
        });
      }
      return new Response(object.body, {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      }) as never;
    },
  );

  app.openapi(
    { ...openRoute, middleware: chokepointMiddleware(chokepoint, openRoute) },
    async (c) => {
      const observed = observedFrom(c);
      try {
        const view = await viewFor(c);
        await commit(
          c,
          openRequest(requireChokepointFirmContext(c).firmDatabase, view, observed),
          observed.now,
        );
        return c.json(await freshViewBody(c), 200);
      } catch (error) {
        const answer = refusal(c, error);
        if (answer !== undefined) return answer;
        throw error;
      }
    },
  );

  app.openapi(
    { ...sendCodeRoute, middleware: chokepointMiddleware(chokepoint, sendCodeRoute) },
    async (c) => {
      const observed = observedFrom(c);
      const firm = requireChokepointFirmContext(c);
      let view: SignerView;
      const digits = newAccessCode();
      try {
        view = await viewFor(c);
        const codeHash = await hashAccessCode(c.env.AUTH_SECRET, view.signer.id, digits);
        await commit(c, issueAccessCode(firm.firmDatabase, view, codeHash, observed), observed.now);
      } catch (error) {
        const answer = refusal(c, error);
        if (answer !== undefined) return answer;
        throw error;
      }
      const { subject, text } = accessCodeEmail({
        firmName: await firm.readFirmName(),
        code: digits,
        minutes: ACCESS_CODE_LIFETIME_MINUTES,
      });
      const logger = c.get("logger");
      const delivery = await sendMessage({
        send: sendEmail(c.env),
        surface: "signing.access-code",
        ...(logger === undefined ? {} : { logger }),
        correlationId: c.get("correlationId") ?? "",
        message: {
          to: view.signer.email,
          subject,
          text,
          messageClass: SIGNING_ACCESS_CODE_MESSAGE_CLASS,
        },
      });
      if (!delivery.delivered) {
        return problemJson(c, {
          type: "mail-undeliverable",
          title: "The code was not sent",
          status: 503,
          detail: `The code could not be emailed. Try again in a minute. Error ID ${delivery.errorId}.`,
        });
      }
      return c.json({ sentTo: maskedAddress(view.signer.email) }, 202);
    },
  );

  app.openapi(
    { ...checkCodeRoute, middleware: chokepointMiddleware(chokepoint, checkCodeRoute) },
    async (c) => {
      const observed = observedFrom(c);
      const { code } = c.req.valid("json");
      try {
        const view = await viewFor(c);
        const stored = view.progress.accessCodeHash;
        const matches =
          stored !== null &&
          (await constantTimeStringEquals(
            await hashAccessCode(c.env.AUTH_SECRET, view.signer.id, code),
            stored,
          ));
        const checked = checkAccessCode(
          requireChokepointFirmContext(c).firmDatabase,
          view,
          matches,
          observed,
        );
        await commit(c, checked.effect, observed.now);
        if (!checked.verified) {
          return problemJson(c, {
            type: "signing-step-refused",
            title: "That code is not right",
            status: 422,
            detail: "Check the code in your email and try again, or ask for a new one.",
          });
        }
        return c.json(await freshViewBody(c), 200);
      } catch (error) {
        const answer = refusal(c, error);
        if (answer !== undefined) return answer;
        throw error;
      }
    },
  );

  app.openapi(
    { ...consentRoute, middleware: chokepointMiddleware(chokepoint, consentRoute) },
    async (c) => {
      const observed = observedFrom(c);
      try {
        const view = await viewFor(c);
        await commit(
          c,
          giveConsent(requireChokepointFirmContext(c).firmDatabase, view, observed),
          observed.now,
        );
        return c.json(await freshViewBody(c), 200);
      } catch (error) {
        const answer = refusal(c, error);
        if (answer !== undefined) return answer;
        throw error;
      }
    },
  );

  app.openapi(
    { ...adoptRoute, middleware: chokepointMiddleware(chokepoint, adoptRoute) },
    async (c) => {
      const observed = observedFrom(c);
      const body = c.req.valid("json");
      const signature = decodePng(body.signaturePng);
      const initials = body.initialsPng === null ? null : decodePng(body.initialsPng);
      if (signature === null || (body.initialsPng !== null && initials === null)) {
        return problemJson(c, {
          type: "signing-step-refused",
          title: "The image cannot be used",
          status: 422,
          detail: "A signature must be a PNG image smaller than 200 KB.",
        });
      }
      const firm = requireChokepointFirmContext(c);
      try {
        const view = await viewFor(c);
        if (needsCode(view) || view.signer.consentedAt === null) {
          throw new SignerStepRefusal(409, "Agree to sign electronically first.");
        }
        const bucket = resolveFirmBucket(c.env, firm.bucketName).bucket;
        const stamp = observed.now.replace(/[^0-9]/g, "");
        const prefix = `signing/${view.detail.request.id}/${view.signer.id}`;
        const signatureKey = `${prefix}/signature-${stamp}.png`;
        const initialsKey = initials === null ? null : `${prefix}/initials-${stamp}.png`;
        await bucket.put(signatureKey, signature, {
          httpMetadata: { contentType: "image/png" },
          customMetadata: matterScopedObjectDimensions({
            matterId: view.detail.request.matterId,
            objectClass: "signing-mark",
          }),
        });
        if (initials !== null && initialsKey !== null) {
          await bucket.put(initialsKey, initials, {
            httpMetadata: { contentType: "image/png" },
            customMetadata: matterScopedObjectDimensions({
              matterId: view.detail.request.matterId,
              objectClass: "signing-mark",
            }),
          });
        }
        await commit(
          c,
          adoptSignature(
            firm.firmDatabase,
            view,
            { how: body.how, signatureKey, initialsKey },
            observed,
          ),
          observed.now,
        );
        return c.json(await freshViewBody(c), 200);
      } catch (error) {
        const answer = refusal(c, error);
        if (answer !== undefined) return answer;
        throw error;
      }
    },
  );

  app.openapi(
    { ...finishRoute, middleware: chokepointMiddleware(chokepoint, finishRoute) },
    async (c) => {
      const observed = observedFrom(c);
      const { answers } = c.req.valid("json");
      const firm = requireChokepointFirmContext(c);
      const grant = requireChokepointSignerGrant(c);
      try {
        const view = await viewFor(c);
        const finished = finishSigning(firm.firmDatabase, view, answers, observed);
        const links = await linkStatements(
          firm.firmDatabase,
          c.env.AUTH_SECRET,
          grant.firmId,
          finished.notify,
          observed.now,
        );
        await commit(
          c,
          { ...finished.effect, statements: [...finished.effect.statements, ...links] },
          observed.now,
        );
        if (finished.notify.length > 0) {
          const names = await namesFor(c, view);
          const logger = c.get("logger");
          await mailSigners(
            {
              send: sendEmail(c.env),
              key: c.env.AUTH_SECRET,
              firmId: grant.firmId,
              firmName: names.firmName,
              senderName: names.senderName,
              origin: new URL(c.req.url).origin,
              ...(logger === undefined ? {} : { logger }),
              correlationId: c.get("correlationId") ?? "",
            },
            view.detail.request,
            finished.notify,
            "request",
          );
        }
        return c.json({ status: "signed" as const }, 200);
      } catch (error) {
        const answer = refusal(c, error);
        if (answer !== undefined) return answer;
        throw error;
      }
    },
  );

  app.openapi(
    { ...declineRoute, middleware: chokepointMiddleware(chokepoint, declineRoute) },
    async (c) => {
      const observed = observedFrom(c);
      const { reason } = c.req.valid("json");
      try {
        const view = await viewFor(c);
        await commit(
          c,
          declineSigning(requireChokepointFirmContext(c).firmDatabase, view, reason, observed),
          observed.now,
        );
        return c.json({ status: "declined" as const }, 200);
      } catch (error) {
        const answer = refusal(c, error);
        if (answer !== undefined) return answer;
        throw error;
      }
    },
  );
}
