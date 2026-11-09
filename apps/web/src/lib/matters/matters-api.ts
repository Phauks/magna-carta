/*
 * The matters surface's response shapes and calls. Mirrors the matters, matter-type, location and
 * session operations in apps/api-worker/openapi/openapi.json; the transport envelope lives in
 * $lib/api/request.ts.
 *
 * Two facts about this contract shape the screen above it, and both are recorded here rather than
 * rediscovered:
 *
 *   - The listing answers IDENTIFIERS for a matter's type, Location and responsible member, not
 *     names. Type and Location have their own firm-wide list endpoints, so those two are resolved
 *     once per screen and joined client-side. There is no member-directory read at all, so the
 *     responsible attorney's NAME cannot be shown on a listing without one request per row, which
 *     is the N+1 the platform forbids.
 *   - The listing serves `createdAt`, never `openedAt`. Those are different facts: a matter created
 *     as a consultation and opened months later has two dates, and only the detail read carries the
 *     second. The column that shows it therefore says "Created" and means it.
 */
import { meGetQueryKey } from "@magna-carta/api-client";
import { requestJson, type ApiOutcome, type Page } from "$lib/api/request.ts";
import { queryClient, SESSION_STABLE } from "$lib/api/screen-data.ts";
import type { MatterStatus } from "./matter-status.ts";

/** One matter as the firm's listing answers it. */
export interface MatterSummary {
  id: string;
  title: string;
  status: MatterStatus;
  /** The matter type's identifier; the name is resolved from the matter-type list. */
  matterTypeId: string | null;
  /** The Location's identifier; the name is resolved from the Location list. */
  locationId: string | null;
  responsibleMemberId: string;
  clientDisplayName: string | null;
  /** The directory entity linked as the client, or null on a matter that predates the link. */
  clientEntityId: string | null;
  /** Null until open draws it; frozen thereafter. A consultation has none until it is opened. */
  matterNumber: string | null;
  /**
   * The tentative number a consultation is created with, from the firm's consultation sequence. It
   * survives opening rather than being replaced by the matter number, so a file quoted under it
   * still resolves. Null on a matter opened outright, which never was a consultation.
   */
  consultationNumber: string | null;
  /**
   * The number the intake was written down under, from the firm's intake sequence. Like the
   * consultation number it survives every later rung rather than being replaced, so a note quoting
   * it still resolves. Null on a matter recorded as a consultation or opened outright, which never
   * was an intake, and on intakes recorded before the sequence existed.
   */
  intakeNumber: string | null;
  createdAt: string;
}

/** A firm matter type, as the firm's own vocabulary. */
export interface MatterTypeSummary {
  id: string;
  name: string;
  code: string | null;
  active: boolean;
}

/** A firm Location (an office), which may also supply a matter's number prefix. */
export interface LocationSummary {
  id: string;
  name: string;
  status: "active" | "closed";
  jurisdiction: string | null;
  numberCode: string | null;
}

/** What the session bootstrap tells a screen about who is asking and what they may do. */
export interface SessionBootstrap {
  user: { id: string; name: string; email: string };
  firm: { id: string; name: string } | null;
  permissions: readonly string[];
  /**
   * The firm's release channel, which the bootstrap has always carried and nothing read. It is a
   * fact about the FIRM rather than about this member, and it is here rather than behind a read of
   * its own because every session resolves it anyway to evaluate the feature flags below.
   *
   * `alpha` is platform-only: a firm cannot choose it and cannot leave it from inside the product,
   * which is why the write endpoint's vocabulary is the narrower {stable, beta}.
   */
  channel: "stable" | "beta" | "alpha";
  /** The flags this firm's channel resolves to, keyed by flag id. */
  flags: Record<string, boolean>;
}

/** The scope a listing is asked for. "caseload" names no status, which is the working docket. */
export type MatterScope = "caseload" | MatterStatus;

export interface MatterListQuery {
  scope: MatterScope;
  /** Free text over title, number and client — the server's own search, not a client-side narrow. */
  search?: string;
  cursor?: string;
}

/**
 * A page of the firm's matters. The scope maps to the endpoint's `status`, and "caseload" passes
 * none: the listing's own default is the working docket, which excludes unnumbered consultations.
 * A caller that wants a named slice of the record asks for it here; a caller that wants the whole
 * record calls `listEveryMatter` below, which is what the docket screen reads.
 */
export function listMatters(
  fetchImpl: typeof fetch,
  query: MatterListQuery,
): Promise<ApiOutcome<Page<MatterSummary>>> {
  const parameters = new URLSearchParams();
  if (query.scope !== "caseload") parameters.set("status", query.scope);
  const search = query.search?.trim() ?? "";
  if (search !== "") parameters.set("search", search);
  if (query.cursor !== undefined) parameters.set("cursor", query.cursor);
  const suffix = parameters.toString();
  return requestJson(fetchImpl, `/api/v1/matters${suffix === "" ? "" : `?${suffix}`}`);
}

/**
 * Every matter the firm has, as one paged listing.
 *
 * WHY THIS IS TWO READS. The listing endpoint's default omits the unnumbered rungs — it serves the
 * working docket — and its `status` parameter takes one status, never "all". So the docket is the
 * default listing (the numbered matters) plus the consultation stream, and there is no single
 * request that answers it. Intakes are deliberately NOT a third stream: an intake in flight lives
 * on the Intake desk until it becomes a consultation, and a docket that listed every phone call
 * would bury the firm's files under its own front door. Merging here rather than asking for an endpoint change keeps the
 * screen honest today; a listing that could serve the whole record in one read would replace this
 * with `listMatters` and nothing above it would change.
 *
 * WHY MERGING IS SAFE ACROSS PAGE BOUNDARIES. Each stream is ordered by the server; the two are not
 * ordered against each other, so a later page can carry a matter newer than one already on screen.
 * That is fine because the table sorts the rows it holds — order arrives from the column the reader
 * chose, never from the arrival order. It would NOT be safe for a surface that rendered rows in
 * fetch order, which is why the reason is written down rather than left to be rediscovered.
 *
 * EITHER STREAM FAILING FAILS THE READ. Returning half the docket while reporting success would
 * quietly drop a whole kind of matter, and the reader has no way to notice.
 */
export async function listEveryMatter(
  fetchImpl: typeof fetch,
  query: { search?: string; cursor?: string } = {},
): Promise<ApiOutcome<Page<MatterSummary>>> {
  const resume = docketCursorFromToken(query.cursor);
  const [numbered, consultation] = await Promise.all([
    docketStreamPage(fetchImpl, "caseload", query.search, resume.numbered),
    docketStreamPage(fetchImpl, "consultation", query.search, resume.consultation),
  ]);
  if (numbered.kind !== "ok") return numbered;
  if (consultation.kind !== "ok") return consultation;
  const next: DocketCursor = {
    numbered: numbered.value?.nextCursor ?? null,
    consultation: consultation.value?.nextCursor ?? null,
  };
  return {
    kind: "ok",
    value: {
      data: [...(numbered.value?.data ?? []), ...(consultation.value?.data ?? [])],
      nextCursor: docketCursorToken(next),
    },
  };
}

/**
 * Where each of the two streams has got to. A null means that stream is exhausted and must not be
 * read again — re-reading it from the top is how a "load more" starts serving page one for ever.
 */
interface DocketCursor {
  readonly numbered: string | null;
  readonly consultation: string | null;
}

/** The two server cursors carried as one token. Each half stays opaque: carried, never parsed. */
function docketCursorToken(cursor: DocketCursor): string | null {
  if (cursor.numbered === null && cursor.consultation === null) return null;
  return JSON.stringify(cursor);
}

/** Absent means "the first read", where both streams start from their own beginning. */
function docketCursorFromToken(token: string | undefined): {
  numbered: string | null | undefined;
  consultation: string | null | undefined;
} {
  if (token === undefined) return { numbered: undefined, consultation: undefined };
  const parsed = JSON.parse(token) as DocketCursor;
  return { numbered: parsed.numbered, consultation: parsed.consultation };
}

/**
 * One stream's next page, or a settled empty answer where the stream is already exhausted (a null
 * cursor). `undefined` is the stream's first read; `null` is its end.
 */
async function docketStreamPage(
  fetchImpl: typeof fetch,
  scope: MatterScope,
  search: string | undefined,
  cursor: string | null | undefined,
): Promise<ApiOutcome<Page<MatterSummary> | null>> {
  if (cursor === null) return { kind: "ok", value: null };
  return listMatters(fetchImpl, { scope, search, cursor });
}

/** What opening a matter needs. Everything but the title, the status and the responsible member is
 * optional on the contract, and a firm with no types and no Locations can still open a matter. */
export interface CreateMatterRequest {
  title: string;
  /**
   * Where the matter starts. An intake draws nothing and walks the firm's procedure toward a
   * consultation; a consultation recorded outright draws its consultation number; an open matter
   * draws its matter number. "closed" is somewhere a matter arrives, never somewhere it starts.
   */
  status: "intake" | "consultation" | "open";
  description?: string | null;
  matterTypeId?: string | null;
  locationId?: string | null;
  responsibleMemberId: string;
  clientDisplayName?: string | null;
  clientCode?: string | null;
  /**
   * The directory entity the firm acts for. The server writes the client's party link in the same
   * batch as the matter, so the matter is never readable without its client.
   */
  clientEntityId?: string | null;
}

/** What the server answers: the matter, and the number it drew if the matter was opened. */
export interface CreateMatterResponse {
  matterId: string;
  /** Null until the matter opens: an intake has no number, and a consultation's is the one below. */
  matterNumber: string | null;
  /** The tentative number a consultation is created with; null on a matter opened outright. */
  consultationNumber: string | null;
}

/**
 * Create a matter. The number is the SERVER's to mint: `open` draws the firm's next matter number
 * from its own counter atomically, and nothing here may supply or suggest one. The idempotency key
 * is required by the contract, so a retried submit cannot open a second matter.
 */
export function createMatter(
  fetchImpl: typeof fetch,
  request: CreateMatterRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<CreateMatterResponse>> {
  return requestJson(fetchImpl, "/api/v1/matters", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

/** What creating one of the firm's matter types takes. The code feeds numbering schemes. */
export interface CreateMatterTypeRequest {
  name: string;
  code?: string | null;
}

/**
 * Create one of the firm's matter types.
 *
 * This is how a practice area the firm does not hold yet becomes the firm's own: the row is created
 * against the firm, and from then on it is renamed, coded and deactivated in the firm's settings
 * like any other. The idempotency key is required by the contract, so a double-press cannot leave
 * the firm holding the same area twice.
 */
export function createMatterType(
  fetchImpl: typeof fetch,
  request: CreateMatterTypeRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, "/api/v1/matter-types", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

/** The firm's matter types. Un-paged on the contract: a firm's vocabulary is a short list. */
export function listMatterTypes(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<{ data: MatterTypeSummary[] }>> {
  return requestJson(fetchImpl, "/api/v1/matter-types");
}

/** The firm's Locations. Un-paged on the contract, for the same reason. */
export function listLocations(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<{ data: LocationSummary[] }>> {
  return requestJson(fetchImpl, "/api/v1/locations");
}

/** How a caller asks for the session: from the cache when it is current, or from the server now. */
export interface SessionReadOptions {
  /**
   * Skip the cache and ask the server, then refresh the cache with the answer. For the one kind of
   * caller that knows the session has just changed under it — a write that moves the firm's release
   * channel, whose flag set is part of the session — and nobody else.
   */
  readonly fresh?: boolean;
}

/**
 * Who is asking, and what they are allowed to do — answered from the one query cache when it holds
 * a current answer, and from the server when it does not.
 *
 * WHY THE CACHE. Forty-odd surfaces read the session for themselves on mount, and each of those
 * reads used to be its own request: a control-plane read, a firm Durable Object wake, a permissions
 * join, the channel and flags. The (app) guard has already read the same answer into the cache on
 * the way in, so a screen asking a moment later was paying a full round trip, in series in front of
 * its own data, for something it already had. That serial round trip is a large part of why a
 * screen's loading shape showed at all. The answer is held at the session-stable ceiling the guard
 * itself uses (`SESSION_STABLE`, src/lib/api/screen-data.ts): a permission or a channel changes when
 * an administrator changes it, which is a page-load-scale event.
 *
 * The outcome stays the `ApiOutcome` every caller already branches on. A refusal is never cached as
 * an answer: the cache keeps only a session that was read, and a failed read is asked again by the
 * next caller. When the cache joins a read somebody else started and that read fails, the failure
 * arrives without the outcome this function promises, so it asks once more for itself to report it
 * in the shape the caller reads.
 */
export async function readSession(
  fetchImpl: typeof fetch,
  options: SessionReadOptions = {},
): Promise<ApiOutcome<SessionBootstrap>> {
  let refused: ApiOutcome<SessionBootstrap> | null = null;
  try {
    const value = await queryClient.fetchQuery({
      // The generated key, so this read and the guard's `meGetOptions()` read are one cache entry.
      queryKey: meGetQueryKey() as readonly unknown[],
      staleTime: options.fresh === true ? 0 : SESSION_STABLE,
      queryFn: async (): Promise<SessionBootstrap> => {
        const outcome = await requestJson<SessionBootstrap>(fetchImpl, "/api/v1/me");
        if (outcome.kind === "ok") return outcome.value;
        refused = outcome;
        throw new Error("The session could not be read.");
      },
    });
    return { kind: "ok", value };
  } catch {
    return refused ?? requestJson(fetchImpl, "/api/v1/me");
  }
}

/**
 * Drop the cached session, so the next reader asks the server. For a caller that has just learned
 * the cached answer no longer describes the person — the (app) guard sending somebody with no firm
 * to the joining screen, who will come back with one.
 */
export function forgetSession(): void {
  queryClient.removeQueries({ queryKey: meGetQueryKey() as readonly unknown[], exact: true });
}

/** The permission the create endpoint names. A member without it is refused server-side. */
export const CREATE_MATTER_PERMISSION = "matters:create";

/** The permission the patch endpoint names: correcting a matter's own fields. */
export const EDIT_MATTER_PERMISSION = "matters:edit";

/**
 * What the matter read answers about the two offices a matter names, and nothing else.
 *
 * TWO OFFICES, NEVER ONE. `locationId` is the office the matter is RUN OUT OF — the fact the
 * header's citation states. `physicalFileLocationId` is the office the firm's own paper file for
 * this matter is KEPT AT, which is the status window's Physical File. A folder travels, so the two
 * are commonly the same office and are never the same fact; collapsing them would tell somebody the
 * file is in a building it left.
 */
export interface MatterOffices {
  locationId: string | null;
  locationName: string | null;
  physicalFileLocationId: string | null;
  physicalFileLocationName: string | null;
}

/**
 * Read the two offices from the matter itself.
 *
 * The status window asks for this when it opens, every time, for the same reason it re-reads the
 * engagement: a file moved from another surface between two openings must not leave this window
 * stating where it used to be.
 */
export async function readMatterOffices(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<MatterOffices>> {
  // Every key optional on the wire, not in the contract. The contract requires all four; a Worker
  // deployed before the paper file's office landed answers without two of them, and this app is
  // served from the same origin as one specific Worker but cached independently of it.
  const outcome = await requestJson<Partial<MatterOffices>>(
    fetchImpl,
    `/api/v1/matters/${encodeURIComponent(matterId)}`,
  );
  if (outcome.kind !== "ok") return outcome;
  return {
    kind: "ok",
    value: {
      locationId: outcome.value.locationId ?? null,
      locationName: outcome.value.locationName ?? null,
      physicalFileLocationId: outcome.value.physicalFileLocationId ?? null,
      physicalFileLocationName: outcome.value.physicalFileLocationName ?? null,
    },
  };
}

/**
 * The matter fields a correction may set. Every one is optional and an absent key is left alone,
 * which is what lets a surface that owns one fact write only that fact.
 */
export interface MatterPatch {
  title?: string;
  description?: string | null;
  matterTypeId?: string | null;
  locationId?: string | null;
  /** Where the firm's paper file is kept. Null is a real answer: nobody has recorded it. */
  physicalFileLocationId?: string | null;
  responsibleMemberId?: string;
  clientDisplayName?: string | null;
  clientCode?: string | null;
}

/**
 * Correct a matter's own fields. The idempotency key is required by the contract, so a retried
 * submit writes once; the status and the number are not reachable from here by construction.
 */
export function updateMatter(
  fetchImpl: typeof fetch,
  matterId: string,
  patch: MatterPatch,
  idempotencyKey: string,
): Promise<ApiOutcome<{ matterId: string }>> {
  return requestJson(fetchImpl, `/api/v1/matters/${encodeURIComponent(matterId)}`, {
    method: "PATCH",
    body: patch,
    idempotencyKey,
  });
}

/**
 * The permission that governs the firm's matter types. A member without it can choose any practice
 * area the firm already holds and cannot add one, which is exactly what the server enforces — so
 * the control says so up front rather than letting somebody pick and be refused.
 */
export const MANAGE_MATTER_TYPES_PERMISSION = "matters:manageTypes";

// ---- the lifecycle steps ---------------------------------------------------------------------
//
// Three operations, one per status a matter can be in, and each is a POST with no body: the step a
// matter takes next is decided by the status it is already in, never by a value the client sends.
// That is why there is no "set the status to X" call here and never will be — a status is where a
// matter arrives by being opened, closed or reopened, and a surface that could write one directly
// could write one the lifecycle does not allow.
//
// Every one of them requires an idempotency key. A double-press must not draw a second matter
// number or stamp a second close date, and the server refuses the call outright without the header.

/** What opening answers: the matter, and the number the firm's counter drew for it. */
export interface OpenMatterResult {
  matterId: string;
  matterNumber: string;
}

/**
 * One thing worth knowing about a matter that was just closed — physical originals the firm still
 * holds against it, say. A notice is INFORMATION and never a refusal: a close that produced notices
 * still closed, and the matter in the response is closed.
 */
export interface MatterCloseNotice {
  code: string;
  message: string;
}

/** What closing answers: the matter, and any advisory notices the close raised. */
export interface CloseMatterResult {
  matterId: string;
  notices: MatterCloseNotice[];
}

/**
 * Open a consultation. The number is the SERVER's to mint: the firm's next matter number is
 * drawn from its own counter atomically at this moment, and nothing here may supply or suggest one.
 */
export function openMatter(
  fetchImpl: typeof fetch,
  matterId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<OpenMatterResult>> {
  return requestJson(fetchImpl, `/api/v1/matters/${encodeURIComponent(matterId)}/open`, {
    method: "POST",
    idempotencyKey,
  });
}

/**
 * Close a matter: archived-but-additive, so it leaves the firm's active lists and still accepts
 * entries against it.
 *
 * The server runs the close preconditions first, and a refusal comes back as a 409 problem document
 * whose `errors` name each rule that refused and what clears it. That refusal is the useful half of
 * this call, so a caller renders those reasons rather than a generic failure.
 */
export function closeMatter(
  fetchImpl: typeof fetch,
  matterId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<CloseMatterResult>> {
  return requestJson(fetchImpl, `/api/v1/matters/${encodeURIComponent(matterId)}/close`, {
    method: "POST",
    idempotencyKey,
  });
}

/**
 * Reopen a closed matter. The status it returns to is the server's to decide — open if the matter
 * carries a number, consultation if it does not — which is why the acknowledgement carries only the
 * identifier and the screen re-reads the matter rather than assuming.
 */
export function reopenMatter(
  fetchImpl: typeof fetch,
  matterId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ matterId: string }>> {
  return requestJson(fetchImpl, `/api/v1/matters/${encodeURIComponent(matterId)}/reopen`, {
    method: "POST",
    idempotencyKey,
  });
}

/**
 * Put an active matter on hold: the firm stops working it without closing it, for the reason given.
 * The matter keeps its number. The acknowledgement carries only the identifier; the screen re-reads
 * the matter, which now carries the reason and the instant.
 */
export function holdMatter(
  fetchImpl: typeof fetch,
  matterId: string,
  reason: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ matterId: string }>> {
  return requestJson(fetchImpl, `/api/v1/matters/${encodeURIComponent(matterId)}/hold`, {
    method: "POST",
    idempotencyKey,
    body: { reason },
  });
}

/** Release a hold: the matter is active again, and the reason and the instant are cleared. */
export function releaseMatter(
  fetchImpl: typeof fetch,
  matterId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ matterId: string }>> {
  return requestJson(fetchImpl, `/api/v1/matters/${encodeURIComponent(matterId)}/release`, {
    method: "POST",
    idempotencyKey,
  });
}

/** What completing an intake answers: the matter, and the consultation number the firm's sequence drew. */
export interface GraduateMatterResult {
  matterId: string;
  consultationNumber: string;
}

/**
 * Complete an intake: it becomes a consultation and draws its consultation number. The server runs
 * the firm's intake procedure as the gate first, and a refusal comes back as a 409 problem document
 * whose `errors` name each outstanding step in the words of whoever should answer it.
 */
export function graduateMatter(
  fetchImpl: typeof fetch,
  matterId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<GraduateMatterResult>> {
  return requestJson(fetchImpl, `/api/v1/matters/${encodeURIComponent(matterId)}/graduate`, {
    method: "POST",
    idempotencyKey,
  });
}

/** The permissions the lifecycle endpoints name. A member without one is refused server-side. */
export const GRADUATE_MATTER_PERMISSION = "matters:create";
export const OPEN_MATTER_PERMISSION = "matters:open";
export const CLOSE_MATTER_PERMISSION = "matters:close";
export const REOPEN_MATTER_PERMISSION = "matters:reopen";
/** One authority in two directions: whoever may pause the firm's work on a matter may resume it. */
export const HOLD_MATTER_PERMISSION = "matters:hold";

/** One rule standing in the way of a close, in the words of the subsystem that owns it. */
export interface MatterCloseBlocker {
  code: string;
  message: string;
}

/** Whether a matter would close right now, and what stands in the way if it would not. */
export interface MatterCloseReadiness {
  matterId: string;
  status: MatterStatus;
  closable: boolean;
  blockers: MatterCloseBlocker[];
}

/**
 * Ask whether the matter would close, without closing it.
 *
 * The close rules are pure reads with their own commit guard, so the server can run them read-only:
 * this is the same question the close asks and none of the write. It is a reading of the present and
 * never a promise — a balance can move a second later, which is why the close re-asserts every rule
 * inside its own batch — so a screen states what it says and still lets the close have the last word.
 */
/** Whether a consultation would open right now, and what stands in the way if it would not. */
export interface MatterOpenReadiness {
  matterId: string;
  status: MatterStatus;
  openable: boolean;
  blockers: MatterCloseBlocker[];
}

/**
 * Ask whether the consultation would open, without opening it. The open rules are reads, so the
 * server runs them read-only. The intake procedure gates the step before this one, so today the one
 * blocker an open can report is that the matter is not yet a consultation.
 */
export function readMatterOpenReadiness(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<MatterOpenReadiness>> {
  return requestJson(fetchImpl, `/api/v1/matters/${encodeURIComponent(matterId)}/open-readiness`);
}

/** Whether an intake would become a consultation right now, and what stands in the way if not. */
export interface MatterGraduateReadiness {
  matterId: string;
  status: MatterStatus;
  graduable: boolean;
  blockers: MatterCloseBlocker[];
}

/**
 * Ask whether the intake would complete, without completing it: the required steps of the firm's
 * intake procedure that have no satisfying answer, each in the words of whoever should answer it.
 */
export function readMatterGraduateReadiness(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<MatterGraduateReadiness>> {
  return requestJson(
    fetchImpl,
    `/api/v1/matters/${encodeURIComponent(matterId)}/graduate-readiness`,
  );
}

export function readMatterCloseReadiness(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<MatterCloseReadiness>> {
  return requestJson(fetchImpl, `/api/v1/matters/${encodeURIComponent(matterId)}/close-readiness`);
}
