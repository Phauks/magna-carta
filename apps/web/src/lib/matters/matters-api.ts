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
import { requestJson, type ApiOutcome, type Page } from "$lib/api/request.ts";
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
  /** Null until open draws it; frozen thereafter. A consultation is unnumbered by design. */
  matterNumber: string | null;
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
 * WHY THIS IS TWO READS. The listing endpoint's default omits unnumbered consultations — it serves
 * the working docket — and its `status` parameter takes one status, never "all". So the whole
 * record is the default listing (the numbered matters) plus the prospective one, and there is no
 * single request that answers it. Merging here rather than asking for an endpoint change keeps the
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
  const [numbered, prospective] = await Promise.all([
    docketStreamPage(fetchImpl, "caseload", query.search, resume.numbered),
    docketStreamPage(fetchImpl, "prospective", query.search, resume.prospective),
  ]);
  if (numbered.kind !== "ok") return numbered;
  if (prospective.kind !== "ok") return prospective;
  const next: DocketCursor = {
    numbered: numbered.value?.nextCursor ?? null,
    prospective: prospective.value?.nextCursor ?? null,
  };
  return {
    kind: "ok",
    value: {
      data: [...(numbered.value?.data ?? []), ...(prospective.value?.data ?? [])],
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
  readonly prospective: string | null;
}

/** The two server cursors carried as one token. Each half stays opaque: carried, never parsed. */
function docketCursorToken(cursor: DocketCursor): string | null {
  if (cursor.numbered === null && cursor.prospective === null) return null;
  return JSON.stringify(cursor);
}

/** Absent means "the first read", where both streams start from their own beginning. */
function docketCursorFromToken(token: string | undefined): {
  numbered: string | null | undefined;
  prospective: string | null | undefined;
} {
  if (token === undefined) return { numbered: undefined, prospective: undefined };
  const parsed = JSON.parse(token) as DocketCursor;
  return { numbered: parsed.numbered, prospective: parsed.prospective };
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
  /** Only these two: "closed" is somewhere a matter arrives, never somewhere it starts. */
  status: "prospective" | "open";
  description?: string | null;
  matterTypeId?: string | null;
  locationId?: string | null;
  responsibleMemberId: string;
  clientDisplayName?: string | null;
  clientCode?: string | null;
}

/** What the server answers: the matter, and the number it drew if the matter was opened. */
export interface CreateMatterResponse {
  matterId: string;
  /** Null for a prospective consultation — unnumbered by design, not a failure to number. */
  matterNumber: string | null;
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

/** Who is asking, and what they are allowed to do. */
export function readSession(fetchImpl: typeof fetch): Promise<ApiOutcome<SessionBootstrap>> {
  return requestJson(fetchImpl, "/api/v1/me");
}

/** The permission the create endpoint names. A member without it is refused server-side. */
export const CREATE_MATTER_PERMISSION = "matters:create";

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
 * Open a prospective matter. The number is the SERVER's to mint: the firm's next matter number is
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
 * carries a number, prospective if it does not — which is why the acknowledgement carries only the
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

/** The permissions the three lifecycle endpoints name. A member without one is refused server-side. */
export const OPEN_MATTER_PERMISSION = "matters:open";
export const CLOSE_MATTER_PERMISSION = "matters:close";
export const REOPEN_MATTER_PERMISSION = "matters:reopen";

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
export function readMatterCloseReadiness(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<MatterCloseReadiness>> {
  return requestJson(fetchImpl, `/api/v1/matters/${encodeURIComponent(matterId)}/close-readiness`);
}
