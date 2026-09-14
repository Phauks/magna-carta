/*
 * The firm's offices, as the contract answers them — the one module every office surface reads and
 * writes through.
 *
 * An OFFICE is what the contract calls a Location: the firm's place of business with a name, a
 * jurisdiction, a time zone, a numbering code, its addresses and who staffs it. The word "office"
 * is what a reader sees everywhere; "location" survives only on the wire, where it is the route's
 * name and not something anybody reads.
 *
 * Mirrors the `locations.*` operations in apps/api-worker/openapi/openapi.json. apps/web does not
 * depend on @magna-carta/api-client, so the shapes are written here by hand.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

/** The permission every office write names. A member without it reads the register as a table. */
export const MANAGE_OFFICES_PERMISSION = "locations:manage";

export type OfficeStatus = "active" | "closed";
export type OfficeAddressKind = "physical" | "mailing";

/** One of an office's addresses: the international field set plus the line the office answers on. */
export interface OfficeAddress {
  kind: OfficeAddressKind;
  street: string | null;
  streetTwo: string | null;
  dependentLocality: string | null;
  city: string | null;
  region: string | null;
  postal: string | null;
  sortingCode: string | null;
  /** ISO 3166-1 alpha-2, or null on an address recorded before the country was asked for. */
  country: string | null;
  /** The international form the record stores (+17755550148, an extension after an x). */
  phone: string | null;
}

/** An office as the register lists it. */
export interface OfficeSummary {
  id: string;
  name: string;
  status: OfficeStatus;
  jurisdiction: string | null;
  timeZone: string | null;
  numberCode: string | null;
  email: string | null;
  addresses: OfficeAddress[];
  /** How many members staff it. A member at two offices counts at both. */
  members: number;
  /** Whether it prints a mark of its own rather than the firm's. */
  hasLetterheadLogo: boolean;
  /** The one office a matter with no office of its own numbers and prints against. */
  firmDefault: boolean;
}

export interface OfficeMember {
  userId: string;
  displayName: string;
  status: "active" | "deactivated";
  isPrimary: boolean;
}

/** What the office record says about its own letterhead logo — never the bytes. */
export interface OfficeLetterheadLogo {
  contentType: string;
  sizeBytes: number;
  widthPixels: number;
  heightPixels: number;
  printedWidthPoints: number;
  updatedAt: string | null;
}

export interface OfficeDetail extends Omit<OfficeSummary, "members" | "hasLetterheadLogo"> {
  addressBlock: string | null;
  footer: string | null;
  remitTo: string | null;
  members: OfficeMember[];
  letterheadLogo: OfficeLetterheadLogo | null;
  /** Where the mark this office prints comes from: its own logo, the firm's primary mark, or nowhere. */
  letterheadSource: "office" | "firm" | "none";
  createdAt: string;
  updatedAt: string;
}

/** The fields an office is created or corrected with. Every one but the name may be empty. */
export interface OfficeFieldsRequest {
  name: string;
  jurisdiction: string | null;
  timeZone: string | null;
  numberCode: string | null;
  email: string | null;
  addressBlock: string | null;
  footer: string | null;
  remitTo: string | null;
}

export type OfficeAddressRequest = OfficeAddress;

/** The firm's offices, whole: a firm opens them one at a time, and a picker missing one says it does not exist. */
export function listOffices(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<{ data: OfficeSummary[] }>> {
  return requestJson(fetchImpl, "/api/v1/locations");
}

export function readOffice(fetchImpl: typeof fetch, id: string): Promise<ApiOutcome<OfficeDetail>> {
  return requestJson(fetchImpl, `/api/v1/locations/${id}`);
}

export function createOffice(
  fetchImpl: typeof fetch,
  request: OfficeFieldsRequest,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, "/api/v1/locations", {
    method: "POST",
    body: request,
    idempotencyKey,
  });
}

export function updateOffice(
  fetchImpl: typeof fetch,
  id: string,
  request: Partial<OfficeFieldsRequest>,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, `/api/v1/locations/${id}`, {
    method: "PATCH",
    body: request,
    idempotencyKey,
  });
}

/** Replaces the office's whole address set: at most one physical and one mailing. */
export function setOfficeAddresses(
  fetchImpl: typeof fetch,
  id: string,
  addresses: readonly OfficeAddressRequest[],
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, `/api/v1/locations/${id}/addresses`, {
    method: "PUT",
    body: { addresses },
    idempotencyKey,
  });
}

/** Soft-closes an office. The firm's default is refused until another office takes that role. */
export function closeOffice(
  fetchImpl: typeof fetch,
  id: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, `/api/v1/locations/${id}/close`, {
    method: "POST",
    idempotencyKey,
  });
}

export function setFirmDefaultOffice(
  fetchImpl: typeof fetch,
  id: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, `/api/v1/locations/${id}/firm-default`, {
    method: "PUT",
    idempotencyKey,
  });
}

export function addOfficeMember(
  fetchImpl: typeof fetch,
  id: string,
  userId: string,
  isPrimary: boolean,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, `/api/v1/locations/${id}/members/${userId}`, {
    method: "PUT",
    body: { isPrimary },
    idempotencyKey,
  });
}

export function removeOfficeMember(
  fetchImpl: typeof fetch,
  id: string,
  userId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, `/api/v1/locations/${id}/members/${userId}`, {
    method: "DELETE",
    idempotencyKey,
  });
}

/**
 * Sets the office's letterhead logo from the image's bytes. The server reads what the bytes are;
 * only the printed width is given, and the height follows from the image's own proportions.
 */
export function setOfficeLetterheadLogo(
  fetchImpl: typeof fetch,
  id: string,
  imageBase64: string,
  printedWidthPoints: number,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, `/api/v1/locations/${id}/letterhead-logo`, {
    method: "PUT",
    body: { imageBase64, printedWidthPoints },
    idempotencyKey,
  });
}

export function clearOfficeLetterheadLogo(
  fetchImpl: typeof fetch,
  id: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, `/api/v1/locations/${id}/letterhead-logo`, {
    method: "DELETE",
    idempotencyKey,
  });
}

/**
 * Where the mark an office prints is served from, for an image element. Rides the session like
 * every other read; `version` busts the browser's cache after a change, since the path itself
 * does not move when the mark does.
 */
export function officeLetterheadLogoHref(id: string, version: string | null): string {
  const query = version === null ? "" : `?v=${encodeURIComponent(version)}`;
  return `/api/v1/locations/${id}/letterhead-logo${query}`;
}

/** Base64 of a chosen file, for the inline image routes. */
export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}
