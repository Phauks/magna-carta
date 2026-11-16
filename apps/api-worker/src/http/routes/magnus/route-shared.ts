import type { OpenAPIHono } from "@hono/zod-openapi";
import { assertPermission } from "@magna-carta/access-control/registry";
import type { MagnusConversationId } from "@magna-carta/identifiers/types";
import type { ShelfRow } from "@magna-carta/magnus/shelf";
import { readConversation } from "@magna-carta/magnus/statements";
import type { ConversationRow, TurnRow } from "@magna-carta/magnus/types";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import {
  requireChokepointFirmContext,
  requireChokepointPermissions,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import type { RouteMeta } from "../../contracts/route-meta.ts";
import type { MagnusConsent } from "../../../magnus/consent.ts";

// What every Magnus route module shares: the two permissions, the route metadata, the errors every
// route can answer, the consent refusals, and the reads that decide whether the caller may write to
// or read a conversation. One home, so the conversation routes (magnus.ts) and the shelf routes
// (shelf.ts) can never disagree about who may touch a conversation.

export const CONVERSE = "magnus:converse";
const READ_ALL = "magnus:readAllConversations";
// The branded form, resolved once: the effective-permission set is a set of branded keys, and a raw
// string is not assignable to one without going through the registry's own narrower.
export const READ_ALL_PERMISSION = assertPermission(READ_ALL);

export const DEFAULT_PAGE_SIZE = 50;

const authErrors = {
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the permission, or the firm has not opted in",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description: "The firm is unreachable, the member is deactivated, or the record does not exist",
    content: { "application/problem+json": { schema: Problem } },
  },
  409: {
    description:
      "The member has not accepted the current disclosure, or a request with this Idempotency-Key " +
      "is still in progress",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description: "The request is well-formed but a rule refuses it",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
};

// Every route in this module can answer any of these: the consent gates produce 403 and 409, the
// idempotency chokepoint produces 409 and 422, and the record reads produce 404. Declared once so a
// handler and its contract cannot drift apart.
export const commonErrors = {
  401: authErrors[401],
  403: authErrors[403],
  404: authErrors[404],
  409: authErrors[409],
  422: authErrors[422],
  429: authErrors[429],
};

export function readMeta(action: string): RouteMeta {
  return {
    operationId: `magnus.${action}`,
    surface: "app",
    authenticated: true,
    permission: CONVERSE,
    // A conversation may carry an optional matter link but exists without one, so the firm is its
    // tenancy root.
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

export function mutationMeta(action: string, audited: boolean): RouteMeta {
  return {
    operationId: `magnus.${action}`,
    surface: "app",
    authenticated: true,
    permission: CONVERSE,
    resource: "firm",
    audited,
    // Required: a retried submit must not put a second question to the model, which is both a second
    // spend and a transcript that says the member asked twice.
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

export type MagnusApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

// The refusal every route shares. Each closed gate gets its own problem type: a firm administrator
// reading "the firm has not enabled Magnus" knows what to do, where a generic permission denial sends
// them looking at roles.
export function firmGateRefusal(c: Context, consent: MagnusConsent): ProblemResponse<403> | null {
  if (consent.state === "firm-ineligible") {
    return problemJson(c, {
      type: "magnus-firm-not-eligible",
      title: "This firm has not enabled AI processing",
      status: 403,
      detail:
        "The firm has not consented to sending its content to a third-party model provider. An " +
        "administrator enables that in firm settings.",
    });
  }
  if (consent.state === "feature-disabled") {
    return problemJson(c, {
      type: "magnus-not-enabled",
      title: "The assistant is not enabled for this firm",
      status: 403,
      detail: "An administrator enables the assistant in firm settings.",
    });
  }
  return null;
}

export function consentRefusal(
  c: Context,
  consent: MagnusConsent,
): ProblemResponse<403> | ProblemResponse<409> | null {
  const firmRefusal = firmGateRefusal(c, consent);
  if (firmRefusal !== null) return firmRefusal;
  if (consent.state === "acknowledgement-required") {
    return problemJson(c, {
      type: "magnus-acknowledgement-required",
      title: "The disclosure has not been accepted",
      status: 409,
      detail:
        "Accept the current disclosure before using the assistant. What it can see and do has " +
        "changed since it was last accepted, or it has not been accepted at all.",
    });
  }
  return null;
}

// A conversation the caller may WRITE to: their own, and not deleted. Somebody else's is reported as
// absent rather than forbidden — a member has no business learning that another member's conversation
// exists.
export async function requireOwnConversation(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
  conversationId: MagnusConversationId,
  userId: string,
): Promise<true | null> {
  const firm = requireChokepointFirmContext(c);
  const conversation = await readConversation(firm.firmDatabase, conversationId);
  if (conversation === undefined || conversation.state === "deleted") return null;
  return conversation.createdBy === userId ? true : null;
}

// A conversation the caller may READ: their own, or anyone's under the administrative permission.
export async function requireReadableConversation(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
  conversationId: MagnusConversationId,
  userId: string,
): Promise<true | null> {
  const firm = requireChokepointFirmContext(c);
  const conversation = await readConversation(firm.firmDatabase, conversationId);
  if (conversation === undefined || conversation.state === "deleted") return null;
  if (conversation.createdBy === userId) return true;
  return requireChokepointPermissions(c).has(READ_ALL_PERMISSION) ? true : null;
}

export function notFound(c: Context): ProblemResponse<404> {
  return problemJson(c, { type: "not-found", status: 404, title: "Conversation not found" });
}

// A conversation on the wire, with where the READER keeps it. A conversation the reader has never
// moved or pinned is in General and unpinned.
export function conversationBody(row: ConversationRow, shelf: ShelfRow) {
  return {
    id: row.id,
    title: row.title,
    createdBy: row.createdBy,
    matterId: row.matterId,
    state: row.state,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    folderId: shelf.folderId,
    pinnedAt: shelf.pinnedAt,
  };
}

// A turn on the wire. A message its author removed is withheld from the AUTHOR, who took it back, and
// shown to a reader holding the supervisory read: the text is kept on the record (a transcript is
// erased only with its whole conversation), and the supervisor's read of it is already audited. A
// turn set aside by an edit keeps its text for everyone, as the earlier version of the conversation.
export function turnBody(turn: TurnRow, authorReading: boolean) {
  return {
    id: turn.id,
    sequence: turn.sequence,
    speaker: turn.speaker,
    content: turn.removedAt !== null && authorReading ? null : turn.content,
    status: turn.status,
    failureLabel: turn.failureLabel,
    modelId: turn.modelId,
    snapshotId: turn.snapshotId,
    contextTruncated: turn.contextTruncated,
    effort: turn.effort,
    thinking: turn.thinking,
    removedAt: turn.removedAt,
    supersededAt: turn.supersededAt,
    replacesTurnId: turn.replacesTurnId,
    createdAt: turn.createdAt,
    completedAt: turn.completedAt,
  };
}
