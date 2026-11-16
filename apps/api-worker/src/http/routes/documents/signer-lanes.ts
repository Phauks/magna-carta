import { GuardedWriteRefusedError } from "@magna-carta/data-access/effect-batch";
import type { FirmId, SigningRequestId, SigningSignerId } from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import { SigningRequestRefusal, readRequestDetail } from "../../../signing/request-service.ts";
import { signerLinkRefusal, signerLinkRefusalFor } from "../../../signing/signer-refusals.ts";
import {
  SignerStepRefusal,
  readSignerView,
  type Observed,
  type SignerView,
} from "../../../signing/signer-service.ts";
import type { GuestLaneRefusal } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointSignerGrant,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { problemJson, type ProblemResponse } from "../../contracts/problem.ts";

// The two ways a signer reaches their part of a request, and the answers both give when an act is
// refused. The handlers in ./signers.ts take a lane and never ask which one it is.

export type SignerContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

const MAXIMUM_USER_AGENT = 300;

export function observedFrom(c: SignerContext): Observed {
  const userAgent = c.req.header("user-agent");
  return {
    now: new Date().toISOString(),
    ip: c.req.header("cf-connecting-ip") ?? null,
    userAgent: userAgent === undefined ? null : userAgent.slice(0, MAXIMUM_USER_AGENT),
  };
}

/** How a lane finds the signer an act is for, and the firm it is in. */
export interface SignerLane {
  viewFor(c: SignerContext): Promise<SignerView>;
  firmIdOf(c: SignerContext): FirmId;
}

/** The outside signer: the request and the signer are facts of the verified link. */
export const LINK_LANE: SignerLane = {
  viewFor: async (c) => {
    const grant = requireChokepointSignerGrant(c);
    return await readSignerView(
      requireChokepointFirmContext(c).firmDatabase,
      grant.requestId as SigningRequestId,
      grant.signerId as SigningSignerId,
    );
  },
  firmIdOf: (c) => requireChokepointSignerGrant(c).firmId as FirmId,
};

/** A closed request, or a member who already signed, as the link lane would answer it. */
class MemberLaneRefusal extends Error {
  readonly refusal: GuestLaneRefusal;
  constructor(refusal: GuestLaneRefusal) {
    super(refusal.title);
    this.name = "MemberLaneRefusal";
    this.refusal = refusal;
  }
}

/**
 * The firm member: the session's user, found on the request as a signer the sender named as a
 * colleague. A request that names them only by email, or not at all, is not found.
 */
export const MEMBER_LANE: SignerLane = {
  viewFor: async (c) => {
    const database = requireChokepointFirmContext(c).firmDatabase;
    const userId = requireChokepointUserId(c);
    const requestId = c.req.param("requestId") as SigningRequestId;
    const detail = await readRequestDetail(database, requestId);
    const signer = detail?.signers.find(
      (one) => one.attributionLevel === "firm-authenticated" && one.userId === userId,
    );
    if (detail === undefined || signer === undefined) {
      throw new SigningRequestRefusal("not-found", "No such request.");
    }
    const code = signerLinkRefusal({
      found: true,
      secretMatches: true,
      storedVersion: 0,
      presentedVersion: 0,
      requestStatus: detail.request.status,
      expiresAt: detail.request.expiresAt,
      signerStatus: signer.status,
      now: new Date().toISOString(),
    });
    if (code !== null) throw new MemberLaneRefusal(signerLinkRefusalFor(code));
    return await readSignerView(database, requestId, signer.id);
  },
  firmIdOf: (c) => requireChokepointFirmId(c),
};

export function refusal(
  c: SignerContext,
  error: unknown,
):
  | ProblemResponse<404>
  | ProblemResponse<409>
  | ProblemResponse<410>
  | ProblemResponse<422>
  | undefined {
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
  if (error instanceof MemberLaneRefusal) {
    return problemJson(c, { ...error.refusal, status: 410 });
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
