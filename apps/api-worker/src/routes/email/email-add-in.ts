import { z, type OpenAPIHono } from "@hono/zod-openapi";
import {
  readCaptureOutcome,
  readLiveCaptureAddressesForMatters,
  readActiveCatchAllCaptureAddress,
  readFiledMattersForThreads,
  readRecentFilingTargets,
  findThreadIdsByMessageIds,
} from "@magna-carta/data-access/email-filing-statements";
import { readMatterPartiesForEmailAddresses } from "@magna-carta/directory/party";
import {
  candidateMatterNumbers,
  rankMatterSuggestions,
  type MatterSuggestionEvidence,
} from "@magna-carta/email-filing/matter-suggestion";
import { maskCaptureToken } from "@magna-carta/email-filing/capture-token";
import { DEFAULT_CAPTURE_ROOT_DOMAIN } from "@magna-carta/email-filing/capture-address";
import { normalizeAddress } from "@magna-carta/email-filing/record";
import { MAX_CAPTURED_MESSAGE_BYTES } from "@magna-carta/email-filing/message-format";
import { readInspectableSizeCap } from "@magna-carta/file-manager/upload-policy";
import { findMattersByNumbers, listMatters, readMattersByIds } from "@magna-carta/matters/queries";
import type { MatterListItem } from "@magna-carta/matters/queries";
import type { EmailThreadId, MatterId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables, FirmContext } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { filterAccessibleMatters } from "../../emails/matter-access.ts";

// The mail-client add-in's own surface: the three questions a Save & File pane asks that the
// matter-rooted email routes do not answer.
//
//   1. Where should this go?          -> POST /emails/matter-suggestions
//   2. What happened to what I filed? -> GET  /emails/captures/{captureJobId}
//   3. What do I show this member?    -> GET  /emails/filing-context
//
// Filing itself is unchanged and lives with the rest of the family in routes/email/emails.ts — the add-in
// posts the message bytes to POST /matters/{matterId}/emails and reads the wall-safe already-filed
// signal from GET /emails/already-filed, both of which already serve it.
//
// EVERY MATTER THESE ROUTES NAME PASSES THE ACCESS FILTER. A suggestion is the one place in the
// subsystem where the server proposes matters the member did not ask for by name, so it is also the
// one place where a leak would be handed over unprompted rather than guessed at: the ranking is
// computed over the firm's own data, then narrowed to what this member may see, and only then
// hydrated and returned. A matter the member cannot see contributes no suggestion, no reason, and no
// count — its absence is indistinguishable from having no evidence at all.

// A Message-ID header value, and the free-text fields the client reads off the open message. Bounded
// because they arrive from a mail client and land in bound parameters: a message with two hundred
// References entries must not turn one suggestion request into a two-hundred-parameter IN list.
const MAX_ANCESTOR_MESSAGE_IDS = 25;
const MAX_PARTICIPANT_ADDRESSES = 50;
const MAX_SUGGESTIONS = 25;
const DEFAULT_SUGGESTIONS = 5;

// HOW FAR TO OVER-FETCH BEFORE THE WALL FILTER NARROWS A RESULT SET.
//
// Signals 1 to 3 gather everything that matched, so filtering them loses nothing. The typed-query
// signal and the recent-filing-targets read are different: both ask the database for the top N, so a
// matter the member cannot see occupies one of those slots BEFORE the filter is applied — and with the
// default of five, five walled matches would silently reduce a member's own suggestions to none. That
// is exactly the property this module states it does not have: a matter the member cannot see must
// contribute no suggestion, no reason, and no count.
//
// Over-fetching a bounded multiple and then taking the limit restores it for every realistic case,
// without pushing an access predicate into a query that has no way to express one yet. The multiple is
// bounded rather than unbounded because the filter is not free either, and a firm where four in five
// matters are walled from a given member is a different problem from this one.
const WALL_FILTER_OVERFETCH_MULTIPLE = 5;
const MAX_RECENT_FILING_TARGETS = 20;
const DEFAULT_RECENT_FILING_TARGETS = 8;

const MatterSuggestionRequest = z
  .object({
    // The open message's own Message-ID. A reply the firm has already captured resolves through it
    // as directly as through an ancestor.
    messageId: z.string().max(998).nullish(),
    inReplyTo: z.string().max(998).nullish(),
    references: z.array(z.string().max(998)).max(MAX_ANCESTOR_MESSAGE_IDS).optional(),
    subject: z.string().max(2000).nullish(),
    // The from/to/cc addresses on the open message.
    participants: z.array(z.string().max(320)).max(MAX_PARTICIPANT_ADDRESSES).optional(),
    // What the member typed into the pane's matter box, if anything. The weakest signal, and the
    // only one that is about the member rather than the message.
    query: z.string().max(200).optional(),
    limit: z.number().int().positive().max(MAX_SUGGESTIONS).optional(),
  })
  .openapi("MatterSuggestionRequest");

const MatterSuggestionItem = z.object({
  matterId: z.string(),
  matterNumber: z.string().nullable(),
  title: z.string(),
  clientDisplayName: z.string().nullable(),
  status: z.string(),
  // A relative ordering weight, not a probability. Compare candidates with it; do not read it as a
  // percentage.
  score: z.number(),
  confidence: z.enum(["high", "medium", "low"]),
  signals: z.array(
    z.enum(["threadContinuation", "subjectMatterNumber", "participantParty", "searchTerm"]),
  ),
  // Why this matter was proposed, in plain language, strongest reason first.
  reasons: z.array(z.string()),
});

const MatterSuggestionList = z
  .object({
    data: z.array(MatterSuggestionItem),
    // Two or more candidates tie for the top score, so there is no single best answer. A client that
    // would otherwise pre-select the first suggestion should ask instead.
    ambiguous: z.boolean(),
  })
  .openapi("MatterSuggestionList");

const CaptureStatusResponse = z
  .object({
    captureJobId: z.string(),
    // `pending` covers both "the capture has not finished" and "it finished long enough ago that the
    // job record has been swept" — this read cannot tell them apart, and a client that has an
    // emailMessageId should read the message instead of polling.
    status: z.enum(["pending", "completed"]),
    emailMessageId: z.string().nullable(),
    matterId: z.string().nullable(),
    // `filed` is on the matter; `staged` is captured and waiting for a person to accept it; `none`
    // means the capture landed with no matter to link (the firm catch-all path).
    linkState: z.enum(["filed", "staged", "none"]),
    // The firm already held this message and the capture converged on the existing record rather
    // than writing a second one.
    deduplicated: z.boolean(),
  })
  .openapi("EmailCaptureStatus");

const RecentFilingTargetItem = z.object({
  matterId: z.string(),
  matterNumber: z.string().nullable(),
  title: z.string(),
  clientDisplayName: z.string().nullable(),
  status: z.string(),
  lastFiledAt: z.string(),
  filedCount: z.number(),
  // Whether this matter has a live forward/CC capture address. The address itself is never returned:
  // the token IS the credential and is shown exactly once, at mint. This says the door exists.
  captureAddressAvailable: z.boolean(),
  captureAddressPreview: z.string().nullable(),
});

const FilingContextResponse = z
  .object({
    recentMatters: z.array(RecentFilingTargetItem),
    firmCaptureAddress: z.object({
      available: z.boolean(),
      tokenPreview: z.string().nullable(),
      createdAt: z.string().nullable(),
    }),
    // The zone forward/CC capture addresses live under, for the client's own help text.
    captureRootDomain: z.string(),
    // The ceiling a filed message must fit under — the firm's inspectable-size cap or the platform
    // capture limit, whichever is lower. A client that checks this refuses a too-large message
    // locally instead of uploading it to be refused.
    maxMessageBytes: z.number(),
  })
  .openapi("EmailFilingContext");

// ── RouteMeta. All three are reads bound to emails:read — the capability that already means "see the
// firm's captured mail and where it is filed", which is exactly what each of these reports. None of
// them mints, files, links, or unlinks anything, so none needs emails:file or emails:manageLinks, and
// a member who can read filed mail must be able to be told where to put the next message.
//
// resource "matter" for all three (the emails:* family precedent — email is matter-rooted). The
// filing-context read also reports the firm catch-all's existence, which is firm-scoped, but its
// subject is the member's matters; binding it to "firm" would understate what it names.

const suggestMattersMeta: RouteMeta = {
  operationId: "emails.suggestMatters",
  surface: "app",
  authenticated: true,
  permission: "emails:read",
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const captureStatusMeta: RouteMeta = {
  operationId: "emails.captureStatus",
  surface: "app",
  authenticated: true,
  permission: "emails:read",
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const filingContextMeta: RouteMeta = {
  operationId: "emails.filingContext",
  surface: "app",
  authenticated: true,
  permission: "emails:read",
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const sharedResponses = {
  401: {
    description: "No session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "Missing emails:read",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const suggestMattersRoute = defineOpenAPIRoute(suggestMattersMeta, {
  method: "post",
  path: "/api/v1/emails/matter-suggestions",
  description:
    "Rank the matters an open message probably belongs to, so a mail client can pre-select one " +
    "instead of asking the member to search. Four signals combine, strongest first: the conversation " +
    "is already filed to a matter, the subject line carries a matter number, a correspondent is a " +
    "party on a matter, and whatever the member typed. Every candidate is filtered to the matters " +
    "this member can access — a matter they cannot see contributes no suggestion and no count. Each " +
    "suggestion carries its confidence and the reasons behind it; `ambiguous` warns that the top " +
    "candidates tie, so nothing should be pre-selected. A POST rather than a GET because the message " +
    "facts it takes — subject line, correspondent addresses — are the firm's mail and do not belong " +
    "in a URL.",
  request: {
    body: { content: { "application/json": { schema: MatterSuggestionRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The ranked matter candidates (possibly empty — no signal fired)",
      content: { "application/json": { schema: MatterSuggestionList } },
    },
    ...sharedResponses,
  },
});

const captureStatusRoute = defineOpenAPIRoute(captureStatusMeta, {
  method: "get",
  path: "/api/v1/emails/captures/{captureJobId}",
  description:
    "Read what became of a filing. Filing a message returns a job identifier and completes off the " +
    "request path, so this is how a client learns whether the message landed, which record it became, " +
    "and whether it was filed outright or staged for a person to accept. A job whose result names a " +
    "matter this member cannot access is reported as absent, never as someone else's matter. A job " +
    "that has not finished — or finished long enough ago to have been swept — reads as pending; a " +
    "client that already holds an emailMessageId should read the message rather than keep polling.",
  request: { params: z.object({ captureJobId: z.string().min(1).max(64) }) },
  responses: {
    200: {
      description: "The capture job's current state",
      content: { "application/json": { schema: CaptureStatusResponse } },
    },
    ...sharedResponses,
    404: {
      description: "No such capture job, or its result is on a matter the caller cannot access",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const filingContextRoute = defineOpenAPIRoute(filingContextMeta, {
  method: "get",
  path: "/api/v1/emails/filing-context",
  description:
    "What a mail client shows the signed-in member before they choose anything: the matters they have " +
    "most recently filed email to (their own filings, never the firm's), whether each has a live " +
    "forward/CC capture address, whether the firm has a catch-all, the zone those addresses live " +
    "under, and the size ceiling a message must fit under. Capture tokens are never returned — the " +
    "token is the credential and is shown once, at mint; this reports that an address exists, not " +
    "what it is.",
  request: {
    query: z.object({
      limit: z.coerce.number().int().positive().max(MAX_RECENT_FILING_TARGETS).optional(),
    }),
  },
  responses: {
    200: {
      description: "The member's filing context",
      content: { "application/json": { schema: FilingContextResponse } },
    },
    ...sharedResponses,
  },
});

// The distinct, non-empty ancestor identifiers a client offered, bounded. The message's own
// Message-ID is included: a reply the firm captured through another recipient resolves through it.
function ancestorMessageIds(input: {
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: readonly string[];
}): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const raw of [input.messageId, input.inReplyTo, ...(input.references ?? [])]) {
    if (raw === null || raw === undefined) continue;
    const value = raw.trim();
    if (value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
    if (values.length >= MAX_ANCESTOR_MESSAGE_IDS) break;
  }
  return values;
}

function normalizedParticipants(addresses: readonly string[] | undefined): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const raw of addresses ?? []) {
    const value = normalizeAddress(raw);
    if (value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
    if (values.length >= MAX_PARTICIPANT_ADDRESSES) break;
  }
  return values;
}

// Narrow a matter set to what this member may see, preserving the caller's order. The one place the
// ethical-wall filter is applied to a suggestion set — the ranking above it is computed over the
// firm's data, and everything below it only ever sees what survived here.
async function accessibleMatterIds(
  firm: FirmContext,
  userId: string,
  matterIds: readonly MatterId[],
): Promise<Set<MatterId>> {
  const visible = await filterAccessibleMatters(firm, userId, matterIds);
  return new Set(visible);
}

export function registerEmailAddInRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  // POST /emails/matter-suggestions — gather the evidence, narrow it to what the member may see, rank.
  //
  // Every gather below is a bounded index walk and there is at most one per signal: the thread lookup
  // resolves all claimed ancestors in one statement and their matters in a second, the subject
  // candidates resolve in one exact-match statement over the matter-number index, and the
  // correspondents resolve in one statement that joins the address index to the party index. Nothing
  // here loops over a result set issuing further reads.
  app.openapi(
    { ...suggestMattersRoute, middleware: chokepointMiddleware(chokepoint, suggestMattersRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const body = c.req.valid("json");
      const limit = body.limit ?? DEFAULT_SUGGESTIONS;
      const evidence: MatterSuggestionEvidence[] = [];

      // 1. Thread continuation — this message answers a conversation the firm has already placed.
      const ancestors = ancestorMessageIds(body);
      if (ancestors.length > 0) {
        const threadIds = await findThreadIdsByMessageIds(firm.firmDatabase, ancestors);
        const distinctThreadIds = [...new Set(threadIds.values())] as EmailThreadId[];
        for (const hit of await readFiledMattersForThreads(firm.firmDatabase, distinctThreadIds)) {
          evidence.push({
            matterId: hit.matterId,
            signal: "threadContinuation",
            detail: `last filed ${hit.lastFiledAt}`,
          });
        }
      }

      // 2. Subject matter number — the firm's own number, written where a person put it.
      const numbers = candidateMatterNumbers(body.subject ?? null);
      const numberMatches = await findMattersByNumbers(firm.firmDatabase, numbers);
      for (const matter of numberMatches) {
        evidence.push({
          matterId: matter.id,
          signal: "subjectMatterNumber",
          detail: matter.matterNumber,
        });
      }

      // 3. Correspondents who are parties — who is talking, matched to who is on the matter.
      const participants = normalizedParticipants(body.participants);
      for (const match of await readMatterPartiesForEmailAddresses(
        firm.firmDatabase,
        participants,
      )) {
        evidence.push({
          matterId: match.matterId,
          signal: "participantParty",
          detail: `${match.normalizedAddress} (${match.role})`,
        });
      }

      // 4. What the member typed — delegated to the same free-text matter search the caseload list
      // uses, so "search" means one thing across the product.
      const query = body.query?.trim() ?? "";
      if (query.length > 0) {
        // Over-fetched, because this gather truncates in the database: asking for exactly `limit`
        // would let walled matters consume the member's own slots before the filter below runs. The
        // ranking still takes `limit` from what survives.
        const page = await listMatters(firm.firmDatabase, {
          search: query,
          pageSize: limit * WALL_FILTER_OVERFETCH_MULTIPLE,
        });
        for (const matter of page.data) {
          evidence.push({ matterId: matter.id, signal: "searchTerm", detail: query });
        }
      }

      // The wall filter runs BEFORE the ranking, not after it: a matter the member cannot see must
      // not occupy a slot, tip `ambiguous`, or shift the confidence of the matters they can see.
      const visible = await accessibleMatterIds(firm, userId, [
        ...new Set(evidence.map((item) => item.matterId as MatterId)),
      ]);
      const ranking = rankMatterSuggestions(
        evidence.filter((item) => visible.has(item.matterId as MatterId)),
        limit,
      );

      const hydrated = await readMattersByIds(
        firm.firmDatabase,
        ranking.suggestions.map((suggestion) => suggestion.matterId as MatterId),
      );
      const matterById = new Map<string, MatterListItem>(
        hydrated.map((matter) => [matter.id, matter]),
      );

      return c.json(
        {
          // A ranked matter with no row behind it is a matter deleted between the ranking and the
          // hydrate; drop it rather than report a half-populated candidate.
          data: ranking.suggestions.flatMap((suggestion) => {
            const matter = matterById.get(suggestion.matterId);
            return matter === undefined
              ? []
              : [
                  {
                    matterId: suggestion.matterId,
                    matterNumber: matter.matterNumber,
                    title: matter.title,
                    clientDisplayName: matter.clientDisplayName,
                    status: matter.status,
                    score: suggestion.score,
                    confidence: suggestion.confidence,
                    signals: [...suggestion.signals],
                    reasons: [...suggestion.reasons],
                  },
                ];
          }),
          ambiguous: ranking.ambiguous,
        },
        200,
      );
    },
  );

  // GET /emails/filing-context — the member's own view.
  //
  // This bundle is registered ahead of routes/email/emails.ts in app.ts and must stay that way: that module
  // owns /api/v1/emails/{emailMessageId}, and a parameterized route registered first swallows every
  // static sibling on its prefix, so "filing-context" would arrive as a message handle and 422.
  app.openapi(
    { ...filingContextRoute, middleware: chokepointMiddleware(chokepoint, filingContextRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { limit } = c.req.valid("query");
      const targetLimit = limit ?? DEFAULT_RECENT_FILING_TARGETS;

      // Over-fetched for the same reason the typed-query signal is: this read truncates in the
      // database, so filtering afterwards would return a list short by however many of the member's
      // most recent targets they can no longer see.
      const recent = await readRecentFilingTargets(
        firm.firmDatabase,
        userId,
        targetLimit * WALL_FILTER_OVERFETCH_MULTIPLE,
      );
      // A member's own past filings still pass the wall filter: access can be withdrawn after the
      // fact, and a shortcut list is not an exemption from the current answer.
      const visible = await accessibleMatterIds(
        firm,
        userId,
        recent.map((target) => target.matterId),
      );
      const visibleTargets = recent
        .filter((target) => visible.has(target.matterId))
        .slice(0, targetLimit);
      const visibleMatterIds = visibleTargets.map((target) => target.matterId);

      // Three bounded reads over the SAME small set of matters — never one read per matter.
      const [matters, captureAddresses, catchAll, sizeCap] = await Promise.all([
        readMattersByIds(firm.firmDatabase, visibleMatterIds),
        readLiveCaptureAddressesForMatters(firm.firmDatabase, visibleMatterIds),
        readActiveCatchAllCaptureAddress(firm.firmDatabase),
        readInspectableSizeCap(firm.firmDatabase),
      ]);
      const matterById = new Map<string, MatterListItem>(
        matters.map((matter) => [matter.id, matter]),
      );
      const addressByMatterId = new Map<string, string>();
      for (const address of captureAddresses) {
        if (address.matterId !== null && !addressByMatterId.has(address.matterId)) {
          addressByMatterId.set(address.matterId, maskCaptureToken(address.token));
        }
      }

      return c.json(
        {
          recentMatters: visibleTargets.flatMap((target) => {
            const matter = matterById.get(target.matterId);
            if (matter === undefined) return [];
            const preview = addressByMatterId.get(target.matterId) ?? null;
            return [
              {
                matterId: target.matterId,
                matterNumber: matter.matterNumber,
                title: matter.title,
                clientDisplayName: matter.clientDisplayName,
                status: matter.status,
                lastFiledAt: target.lastFiledAt,
                filedCount: target.filedCount,
                captureAddressAvailable: preview !== null,
                captureAddressPreview: preview,
              },
            ];
          }),
          firmCaptureAddress: {
            available: catchAll !== null,
            tokenPreview: catchAll === null ? null : maskCaptureToken(catchAll.token),
            createdAt: catchAll?.createdAt ?? null,
          },
          // The zone, never an address: composing a token into a full address is the mint response's
          // job and is deliberately not done here.
          captureRootDomain: c.env.CAPTURE_ROOT_DOMAIN ?? DEFAULT_CAPTURE_ROOT_DOMAIN,
          maxMessageBytes: Math.min(sizeCap, MAX_CAPTURED_MESSAGE_BYTES),
        },
        200,
      );
    },
  );

  // GET /emails/captures/{captureJobId} — what became of one filing.
  app.openapi(
    { ...captureStatusRoute, middleware: chokepointMiddleware(chokepoint, captureStatusRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { captureJobId } = c.req.valid("param");
      const outcome = await readCaptureOutcome(firm.firmDatabase, captureJobId);
      if (outcome === null) {
        return c.json(
          {
            captureJobId,
            status: "pending" as const,
            emailMessageId: null,
            matterId: null,
            linkState: "none" as const,
            deduplicated: false,
          },
          200,
        );
      }
      // The result names a matter, so the answer is only this member's to have if the matter is.
      //
      // This 404 IS distinguishable from the pending answer above, and that is deliberate rather
      // than overlooked. A job id is either minted at random or derived by hashing the caller's own
      // Idempotency-Key with the firm and matter, so it is not a value anyone can guess or
      // enumerate: the only way to hold one is to have filed it, which required access to the matter
      // at the time. So the only reader who can ever see this 404 is someone who already knew the
      // job existed, and answering "pending" instead would tell them nothing they did not have while
      // leaving a client polling a job that will never move. What the reply withholds is what
      // matters — the matter, the record, and the link state — and that it withholds completely.
      if (outcome.matterId !== null) {
        const visible = await accessibleMatterIds(firm, userId, [outcome.matterId]);
        if (!visible.has(outcome.matterId)) {
          return problemJson(c, {
            type: "not-found",
            title: "Capture job not found",
            status: 404,
            detail: "No such capture job, or you cannot access what it filed.",
          });
        }
      }
      return c.json(
        {
          captureJobId,
          status: "completed" as const,
          emailMessageId: outcome.emailMessageId,
          matterId: outcome.matterId,
          linkState: outcome.linkState,
          deduplicated: outcome.deduplicated,
        },
        200,
      );
    },
  );
}
