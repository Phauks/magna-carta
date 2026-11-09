/*
 * The firm's own identity: its name, as its clients read it, and its marks.
 *
 * THE NAME'S READ IS THE SESSION, like the release channel's. The bootstrap already returns the
 * firm's display name as `firm.name` — the chokepoint resolves it for every request anyway — so
 * there is no GET here and no second answer for a screen to reconcile against the session it
 * already holds.
 *
 * What the server stores behind that name is two columns, and only one of them is this. `firm.name`
 * is the provisioning handle: unique, and for a self-serve firm generated rather than chosen.
 * `firm.display_name` is the human-facing one, and it is what this writes.
 *
 * THE MARKS ARE THEIR OWN READ. A primary mark and the additional images a firm keeps beside it — a
 * seal, a wordmark — answered whole, because the set is small by construction. An office's
 * letterhead prints the primary mark unless the office has set a logo of its own.
 *
 * Mirrors the `firmProfile.*` operations in apps/api-worker/openapi/openapi.json.
 */
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

/** The permission the writes name — Admin by seed, never the member-administration key. */
export const MANAGE_FIRM_PROFILE_PERMISSION = "firm:manageProfile";

/** The server's own bound, mirrored so the page refuses a too-long name where it is typed. */
export const MAX_FIRM_DISPLAY_NAME_LENGTH = 200;

/** The server's own bound on a mark's caption, mirrored for the same reason. */
export const MAX_BRAND_IMAGE_LABEL_LENGTH = 80;

export function setFirmProfile(
  fetchImpl: typeof fetch,
  displayName: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ displayName: string }>> {
  return requestJson(fetchImpl, "/api/v1/firm/profile", {
    method: "PUT",
    body: { displayName },
    idempotencyKey,
  });
}

// ---- the firm's marks --------------------------------------------------------------------------

export type BrandImageRole = "primary" | "additional";

/** One of the firm's marks, described — never its bytes. */
export interface BrandImage {
  /** The image's identity: the SHA-256 of its bytes. */
  sha256: string;
  role: BrandImageRole;
  label: string | null;
  contentType: string;
  sizeBytes: number;
  widthPixels: number;
  heightPixels: number;
  updatedAt: string;
}

export interface BrandImages {
  primary: BrandImage | null;
  additional: BrandImage[];
  /** How many additional images the firm may hold, stated so the screen can say when the set is full. */
  additionalLimit: number;
}

export function listBrandImages(fetchImpl: typeof fetch): Promise<ApiOutcome<BrandImages>> {
  return requestJson(fetchImpl, "/api/v1/firm/profile/brand-images");
}

/**
 * Adds a mark from the image's bytes, or re-files one the firm already holds. The server reads what
 * the bytes are; adding a primary demotes the previous one rather than removing it.
 */
export function setBrandImage(
  fetchImpl: typeof fetch,
  request: { imageBase64: string; role: BrandImageRole; label: string | null },
  idempotencyKey: string,
): Promise<ApiOutcome<{ sha256: string }>> {
  return requestJson(fetchImpl, "/api/v1/firm/profile/brand-images", {
    method: "PUT",
    body: request,
    idempotencyKey,
  });
}

export function updateBrandImage(
  fetchImpl: typeof fetch,
  sha256: string,
  patch: { role?: BrandImageRole; label?: string | null },
  idempotencyKey: string,
): Promise<ApiOutcome<{ sha256: string }>> {
  return requestJson(fetchImpl, `/api/v1/firm/profile/brand-images/${sha256}`, {
    method: "PATCH",
    body: patch,
    idempotencyKey,
  });
}

export function removeBrandImage(
  fetchImpl: typeof fetch,
  sha256: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ sha256: string }>> {
  return requestJson(fetchImpl, `/api/v1/firm/profile/brand-images/${sha256}`, {
    method: "DELETE",
    idempotencyKey,
  });
}

/** Where a mark's bytes are served from, for an image element. Rides the session like every read. */
export function brandImageHref(sha256: string): string {
  return `/api/v1/firm/profile/brand-images/${sha256}/content`;
}

/** What a mark is called on screen: its caption, or its role where it has none. */
export function brandImageName(image: BrandImage): string {
  if (image.label !== null && image.label !== "") return image.label;
  return image.role === "primary" ? "Primary mark" : "Image";
}
