import type { RandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";

// The closed vocabularies and the bounds of the exhibits subsystem. Every vocabulary here matches a
// CHECK constraint on the per-firm tables (packages/database/src/per-firm-schema.ts), and the
// schema-sync test holds the two together.

/** Where an exhibit's file came from. Each is an ordinary matter file; the kind is provenance. */
export const EXHIBIT_SOURCE_KINDS = [
  "matterFile",
  "assembledDocument",
  "custodyItemScan",
  "discoveryDocument",
] as const;
export type ExhibitSourceKind = (typeof EXHIBIT_SOURCE_KINDS)[number];

/** How a set went out. The platform cannot observe a filing; this is what a member says happened. */
export const EXHIBIT_DISPOSITIONS = ["filed", "served", "exchanged", "lodged"] as const;
export type ExhibitDisposition = (typeof EXHIBIT_DISPOSITIONS)[number];

export const EXHIBIT_SET_STATES = ["draft", "issued"] as const;
export type ExhibitSetState = (typeof EXHIBIT_SET_STATES)[number];

export const EXHIBIT_MEMBER_STATUSES = ["active", "withdrawn"] as const;
export type ExhibitMemberStatus = (typeof EXHIBIT_MEMBER_STATUSES)[number];

/**
 * The most members one set holds. A trial set of several hundred exhibits is real; a set read is
 * one statement over all of them, and the issue batch writes all of them at once.
 */
export const MAX_MEMBERS_PER_SET = 1000;

/** The most exhibits one matter holds, so the register read is bounded. */
export const MAX_EXHIBITS_PER_MATTER = 5000;

/** The most links a supersession or continuation chain is followed through before refusing. */
export const MAX_CHAIN_DEPTH = 50;

/** The highest ordinal a set may start at: a defendant's run from 500 fits with room to spare. */
export const MAX_START_AT = 100_000;

export const MAX_TITLE_LENGTH = 500;
export const MAX_DESCRIPTION_LENGTH = 4000;
export const MAX_SET_NAME_LENGTH = 200;
export const MAX_NOUN_LENGTH = 40;
export const MAX_PREFIX_LENGTH = 12;
export const MAX_REFERENCE_NAME_LENGTH = 60;
export const MAX_BASIS_LENGTH = 2000;

/** What every service is handed: a clock, the acting member, and optionally a seeded id source. */
export interface ExhibitServiceOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}
