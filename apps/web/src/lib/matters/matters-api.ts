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
 * That exclusion is why the scope control exists at all — a prospective matter is otherwise
 * unreachable from this screen.
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
