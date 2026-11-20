import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  commitEffectBatch,
  GuardedWriteRefusedError,
  type EffectWrite,
} from "@magna-carta/data-access/effect-batch";
import type {
  FileId,
  FirmId,
  SigningRequestId,
  SigningSignerId,
} from "@magna-carta/identifiers/types";
import { matterScopedObjectDimensions } from "@magna-carta/object-dimensions";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import { constantTimeStringEquals } from "../../../constant-time.ts";
import type { SendEmail } from "../../../email-port.ts";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import { SigningRequestRefusal, readRequestDetail } from "../../../signing/request-service.ts";
import { MAXIMUM_MARK_BYTES, signerViewBody } from "../../../signing/signer-contract.ts";
import { linkStatements, mailSigners } from "../../../signing/signer-delivery.ts";
import { hashAccessCode, newAccessCode } from "../../../signing/signer-link.ts";
import { deliverAccessCode } from "../../../signing/access-code-delivery.ts";
import { signerLinkRefusal, signerLinkRefusalFor } from "../../../signing/signer-refusals.ts";
import {
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
  listWaitingOnMember,
  readMemberName,
  readVersionObjectKey,
} from "../../../signing/statements.ts";
import type { Chokepoint, GuestLaneRefusal } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointSignerGrant,
  requireChokepointUserId,
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
import {
  LINK_LANE,
  MEMBER_LANE,
  observedFrom,
  refusal,
  type SignerContext,
  type SignerLane,
} from "./signer-lanes.ts";
import {
  myAdoptRoute,
  myConsentRoute,
  myDeclineRoute,
  myDocumentRoute,
  myFinishRoute,
  myOpenRoute,
  myReadRoute,
  myRequestsRoute,
} from "./my-signing-routes.ts";

// A signer's side of a signing request, for both kinds of signer. An outside signer comes in on the
// chokepoint's signer lane, which has already verified the link and checked it against the signer's
// row. A firm member comes in with their session on the routes in ./my-signing-routes.ts, and is
// found on the request by their user id. Past that one difference every act is the same code: each
// handler reads the request afresh, asks the signer service (../../../signing/signer-service.ts)
// whether the act is the signer's to take now, and commits what it returns. The IP address and browser recorded with
// each act are the edge's own reading of the request, never anything the page sends.
//
// Nothing here logs, echoes or stores the link, the code, or an adopted image's bytes beyond the
// firm's own bucket.

type App = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

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

async function freshViewBody(c: SignerContext, lane: SignerLane) {
  const view = await lane.viewFor(c);
  return signerViewBody(view, await namesFor(c, view));
}

async function commit(c: SignerContext, effect: EffectWrite, now: string): Promise<void> {
  await commitEffectBatch(requireChokepointFirmContext(c).firmDatabase, effect, { now: () => now });
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

type SignerAdoptionBody = {
  readonly how: "typed" | "drawn" | "uploaded";
  readonly signaturePng: string;
  readonly initialsPng: string | null;
};

async function answered(c: SignerContext, act: () => Promise<Response>): Promise<Response> {
  try {
    return await act();
  } catch (error) {
    const answer = refusal(c, error);
    if (answer !== undefined) return answer;
    throw error;
  }
}

async function readDocument(c: SignerContext, lane: SignerLane): Promise<Response> {
  return await answered(c, async () => {
    const firm = requireChokepointFirmContext(c);
    const view = await lane.viewFor(c);
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
    });
  });
}

async function openPart(c: SignerContext, lane: SignerLane): Promise<Response> {
  const observed = observedFrom(c);
  return await answered(c, async () => {
    const view = await lane.viewFor(c);
    await commit(
      c,
      openRequest(requireChokepointFirmContext(c).firmDatabase, view, observed),
      observed.now,
    );
    return c.json(await freshViewBody(c, lane), 200);
  });
}

async function consent(c: SignerContext, lane: SignerLane): Promise<Response> {
  const observed = observedFrom(c);
  return await answered(c, async () => {
    const view = await lane.viewFor(c);
    await commit(
      c,
      giveConsent(requireChokepointFirmContext(c).firmDatabase, view, observed),
      observed.now,
    );
    return c.json(await freshViewBody(c, lane), 200);
  });
}

async function adopt(
  c: SignerContext,
  lane: SignerLane,
  body: SignerAdoptionBody,
): Promise<Response> {
  const observed = observedFrom(c);
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
  return await answered(c, async () => {
    const view = await lane.viewFor(c);
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
    return c.json(await freshViewBody(c, lane), 200);
  });
}

async function finish(
  c: SignerContext,
  lane: SignerLane,
  answers: Record<string, string | boolean>,
  sendEmail: (env: Bindings) => SendEmail,
): Promise<Response> {
  const observed = observedFrom(c);
  const firm = requireChokepointFirmContext(c);
  const firmId = lane.firmIdOf(c);
  return await answered(c, async () => {
    const view = await lane.viewFor(c);
    const finished = finishSigning(firm.firmDatabase, view, answers, observed);
    const links = await linkStatements(
      firm.firmDatabase,
      c.env.AUTH_SECRET,
      firmId,
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
          firmId,
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
  });
}

async function decline(c: SignerContext, lane: SignerLane, reason: string): Promise<Response> {
  const observed = observedFrom(c);
  return await answered(c, async () => {
    const view = await lane.viewFor(c);
    await commit(
      c,
      declineSigning(requireChokepointFirmContext(c).firmDatabase, view, reason, observed),
      observed.now,
    );
    return c.json({ status: "declined" as const }, 200);
  });
}

export function registerSignerRoutes(
  app: App,
  chokepoint: Chokepoint,
  sendEmail: (env: Bindings) => SendEmail,
): void {
  // The outside signer's lane: the link names the request and the signer.
  app.openapi(
    { ...readRoute, middleware: chokepointMiddleware(chokepoint, readRoute) },
    async (c) =>
      (await answered(c, async () => c.json(await freshViewBody(c, LINK_LANE), 200))) as never,
  );
  app.openapi(
    { ...documentRoute, middleware: chokepointMiddleware(chokepoint, documentRoute) },
    async (c) => (await readDocument(c, LINK_LANE)) as never,
  );
  app.openapi(
    { ...openRoute, middleware: chokepointMiddleware(chokepoint, openRoute) },
    async (c) => (await openPart(c, LINK_LANE)) as never,
  );
  app.openapi(
    { ...sendCodeRoute, middleware: chokepointMiddleware(chokepoint, sendCodeRoute) },
    async (c) => {
      const observed = observedFrom(c);
      const firm = requireChokepointFirmContext(c);
      let view: SignerView;
      const digits = newAccessCode();
      try {
        view = await LINK_LANE.viewFor(c);
        const codeHash = await hashAccessCode(c.env.AUTH_SECRET, view.signer.id, digits);
        await commit(c, issueAccessCode(firm.firmDatabase, view, codeHash, observed), observed.now);
      } catch (error) {
        const answer = refusal(c, error);
        if (answer !== undefined) return answer;
        throw error;
      }
      const logger = c.get("logger");
      const delivery = await deliverAccessCode({
        env: c.env,
        sendEmail,
        signer: view.signer,
        firmName: await firm.readFirmName(),
        digits,
        ...(logger === undefined ? {} : { logger }),
        correlationId: c.get("correlationId") ?? "",
      });
      if (!delivery.delivered) {
        return problemJson(c, {
          type: delivery.channel === "text" ? "text-undeliverable" : "mail-undeliverable",
          title: "The code was not sent",
          status: 503,
          detail:
            delivery.channel === "text"
              ? `The code could not be texted. Try again in a minute, or ask the sender to send it by email. Error ID ${delivery.errorId}.`
              : `The code could not be emailed. Try again in a minute. Error ID ${delivery.errorId}.`,
        });
      }
      return c.json({ sentTo: delivery.sentTo }, 202);
    },
  );

  app.openapi(
    { ...checkCodeRoute, middleware: chokepointMiddleware(chokepoint, checkCodeRoute) },
    async (c) => {
      const observed = observedFrom(c);
      const { code } = c.req.valid("json");
      try {
        const view = await LINK_LANE.viewFor(c);
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
            detail: "Check the code you were sent and try again, or ask for a new one.",
          });
        }
        return c.json(await freshViewBody(c, LINK_LANE), 200);
      } catch (error) {
        const answer = refusal(c, error);
        if (answer !== undefined) return answer;
        throw error;
      }
    },
  );

  app.openapi(
    { ...consentRoute, middleware: chokepointMiddleware(chokepoint, consentRoute) },
    async (c) => (await consent(c, LINK_LANE)) as never,
  );
  app.openapi(
    { ...adoptRoute, middleware: chokepointMiddleware(chokepoint, adoptRoute) },
    async (c) => (await adopt(c, LINK_LANE, c.req.valid("json"))) as never,
  );
  app.openapi(
    { ...finishRoute, middleware: chokepointMiddleware(chokepoint, finishRoute) },
    async (c) => (await finish(c, LINK_LANE, c.req.valid("json").answers, sendEmail)) as never,
  );
  app.openapi(
    { ...declineRoute, middleware: chokepointMiddleware(chokepoint, declineRoute) },
    async (c) => (await decline(c, LINK_LANE, c.req.valid("json").reason)) as never,
  );

  // A firm member's own part, on their session: the same acts, found by who is signed in.
  app.openapi(
    { ...myRequestsRoute, middleware: chokepointMiddleware(chokepoint, myRequestsRoute) },
    async (c) => {
      const { id } = c.req.valid("param");
      const requestIds = await listWaitingOnMember(
        requireChokepointFirmContext(c).firmDatabase,
        id as FileId,
        requireChokepointUserId(c),
      );
      return c.json({ requestIds }, 200);
    },
  );
  app.openapi(
    { ...myReadRoute, middleware: chokepointMiddleware(chokepoint, myReadRoute) },
    async (c) =>
      (await answered(c, async () => c.json(await freshViewBody(c, MEMBER_LANE), 200))) as never,
  );
  app.openapi(
    { ...myDocumentRoute, middleware: chokepointMiddleware(chokepoint, myDocumentRoute) },
    async (c) => (await readDocument(c, MEMBER_LANE)) as never,
  );
  app.openapi(
    { ...myOpenRoute, middleware: chokepointMiddleware(chokepoint, myOpenRoute) },
    async (c) => (await openPart(c, MEMBER_LANE)) as never,
  );
  app.openapi(
    { ...myConsentRoute, middleware: chokepointMiddleware(chokepoint, myConsentRoute) },
    async (c) => (await consent(c, MEMBER_LANE)) as never,
  );
  app.openapi(
    { ...myAdoptRoute, middleware: chokepointMiddleware(chokepoint, myAdoptRoute) },
    async (c) => (await adopt(c, MEMBER_LANE, c.req.valid("json"))) as never,
  );
  app.openapi(
    { ...myFinishRoute, middleware: chokepointMiddleware(chokepoint, myFinishRoute) },
    async (c) => (await finish(c, MEMBER_LANE, c.req.valid("json").answers, sendEmail)) as never,
  );
  app.openapi(
    { ...myDeclineRoute, middleware: chokepointMiddleware(chokepoint, myDeclineRoute) },
    async (c) => (await decline(c, MEMBER_LANE, c.req.valid("json").reason)) as never,
  );
}
