import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { UserId } from "@magna-carta/identifiers/types";
import type { RandomSource } from "@magna-carta/identifiers/random";
import {
  deleteFirmBrandImageStatement,
  demoteFirmPrimaryBrandImageStatement,
  readFirmBrandImage,
  readFirmBrandImages,
  updateFirmBrandImageStatement,
  upsertFirmBrandImageStatement,
  type FirmBrandImageRole,
  type FirmBrandImageRow,
} from "./brand-image-statements.ts";
import { SUPPORTED_LETTERHEAD_LOGO_CONTENT_TYPES } from "./location-service.ts";
import { LocationValidationError } from "./validation.ts";

// The firm's own marks — the images that brand the product and print into generated documents.
//
// FIRM-WIDE, AND THE OFFICE'S LETTERHEAD LOGO FALLS BACK TO THEM. An office that has set a mark of
// its own prints that; an office that has not prints the firm's primary mark. So a single-office
// firm sets its mark once, here, and never learns there are two places — and a multi-office firm
// overrides per office only where an office genuinely prints differently. That fallback is the
// reason these live in the same package as the office: the two are one family of facts, read
// together wherever a letterhead is drawn.
//
// Same discipline as the office's own logo: validate in memory, read before composing, return an
// EffectWrite the caller commits. The BYTES never come through here — the route sniffs them,
// writes them to the firm's bucket, and hands this module the facts it read. This module holds no
// I/O and reports the object key it stops pointing at, so the caller can sweep the bucket.

export interface BrandImageClockPort {
  now(): string;
}

export interface BrandImageServiceOptions {
  readonly clock: BrandImageClockPort;
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

/**
 * How many additional marks a firm may hold beside its primary. A bound by construction rather
 * than a page: a firm's marks are a seal, a wordmark, a monogram — a handful — and a set that could
 * grow without bound would need a cursor on a read that a letterhead resolves in one go.
 */
export const MAX_ADDITIONAL_BRAND_IMAGES = 12;

export interface SetFirmBrandImageInput {
  /** The SHA-256 hex of the bytes, which is the image's identity. */
  readonly sha256: string;
  readonly role: FirmBrandImageRole;
  readonly label: string | null;
  readonly objectKey: string;
  /** Sniffed from the bytes by the caller, never taken from an upload's declared type. */
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly widthPixels: number;
  readonly heightPixels: number;
}

function auditStatement(
  database: SqlDatabase,
  options: BrandImageServiceOptions,
  event: string,
  subjectId: string,
  metadata?: Record<string, unknown>,
) {
  return domainAuditStatement(database, {
    event,
    subjectId,
    actorUserId: options.actorUserId,
    clock: options.clock,
    randomSource: options.randomSource,
    ...(metadata === undefined ? {} : { metadata }),
  });
}

function normalizeLabel(label: string | null): string | null {
  if (label === null) return null;
  const trimmed = label.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Record a mark the firm uploaded. The same bytes again is the same row — the role and the label
 * are what change — so a firm that re-uploads its seal to make it primary gets exactly that.
 */
export async function setFirmBrandImage(
  database: SqlDatabase,
  input: SetFirmBrandImageInput,
  options: BrandImageServiceOptions,
): Promise<{ effect: EffectWrite }> {
  if (!SUPPORTED_LETTERHEAD_LOGO_CONTENT_TYPES.includes(input.contentType)) {
    throw new LocationValidationError(
      "unsupported-logo-format",
      `a brand image is a PNG or a JPEG; ${input.contentType} is neither`,
    );
  }
  const held = await readFirmBrandImages(database);
  const existing = held.find((row) => row.id === input.sha256);
  if (input.role === "additional" && existing === undefined) {
    const additional = held.filter((row) => row.role === "additional").length;
    if (additional >= MAX_ADDITIONAL_BRAND_IMAGES) {
      throw new LocationValidationError(
        "too-many-brand-images",
        `the firm already holds ${MAX_ADDITIONAL_BRAND_IMAGES} additional images; remove one before adding another`,
      );
    }
  }
  const now = options.clock.now();
  return {
    effect: {
      statements: [
        // Promoting demotes the standing primary rather than removing it: choosing a new mark is
        // not a reason to lose the old one.
        ...(input.role === "primary" ? [demoteFirmPrimaryBrandImageStatement(database, now)] : []),
        upsertFirmBrandImageStatement(database, {
          id: input.sha256,
          role: input.role,
          label: normalizeLabel(input.label),
          objectKey: input.objectKey,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          widthPixels: input.widthPixels,
          heightPixels: input.heightPixels,
          createdAt: now,
        }),
        auditStatement(database, options, "firm.brand_image_set", input.sha256, {
          role: input.role,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
        }),
      ],
      outboxMessages: [{ topic: "firm.brand_images_changed", payload: { sha256: input.sha256 } }],
    },
  };
}

export interface FirmBrandImagePatch {
  readonly role?: FirmBrandImageRole;
  readonly label?: string | null;
}

/** Change what a held mark is: make it the primary, or give it a different caption. */
export async function updateFirmBrandImage(
  database: SqlDatabase,
  sha256: string,
  patch: FirmBrandImagePatch,
  options: BrandImageServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const existing = await readFirmBrandImage(database, sha256);
  if (existing === undefined) {
    throw new LocationValidationError("unknown-brand-image", `no such brand image: ${sha256}`);
  }
  const role = patch.role ?? existing.role;
  const label = patch.label !== undefined ? normalizeLabel(patch.label) : existing.label;
  const now = options.clock.now();
  const promoting = role === "primary" && existing.role !== "primary";
  return {
    effect: {
      statements: [
        ...(promoting ? [demoteFirmPrimaryBrandImageStatement(database, now)] : []),
        updateFirmBrandImageStatement(database, sha256, { role, label }, now),
        auditStatement(database, options, "firm.brand_image_updated", sha256, {
          from: { role: existing.role },
          to: { role },
        }),
      ],
      outboxMessages: [{ topic: "firm.brand_images_changed", payload: { sha256 } }],
    },
  };
}

/**
 * Forget a mark. The row goes; the object key is REPORTED so the route can sweep the bucket after
 * the row is gone — reported rather than deleted here, because this package performs no I/O and an
 * orphaned object is a cost, not a correctness problem.
 */
export async function removeFirmBrandImage(
  database: SqlDatabase,
  sha256: string,
  options: BrandImageServiceOptions,
): Promise<{ effect: EffectWrite; removedObjectKey: string }> {
  const existing = await readFirmBrandImage(database, sha256);
  if (existing === undefined) {
    throw new LocationValidationError("unknown-brand-image", `no such brand image: ${sha256}`);
  }
  return {
    effect: {
      statements: [
        deleteFirmBrandImageStatement(database, sha256),
        auditStatement(database, options, "firm.brand_image_removed", sha256, {
          role: existing.role,
        }),
      ],
      outboxMessages: [{ topic: "firm.brand_images_changed", payload: { sha256 } }],
    },
    removedObjectKey: existing.objectKey,
  };
}

/** The firm's primary mark, or undefined where the firm has set none. */
export async function readFirmPrimaryBrandImage(
  database: SqlDatabase,
): Promise<FirmBrandImageRow | undefined> {
  const held = await readFirmBrandImages(database);
  return held.find((row) => row.role === "primary");
}
