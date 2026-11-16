import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { RATE_CARD_TABLE, RATE_TABLE, type RateTier } from "./rate-statements.ts";

// The capture-time inputs the rate engine needs. clientId is derived from the matter and roleId from
// the timekeeper's member record at the call site (re-derivable for an audit of rate_source, not
// snapshotted separately). rateCardId names which card resolves the rate (a matter may be on a capped
// card); overrideE4 is a per-entry manual rate that sits above every stored tier.
export interface RateResolutionContext {
  readonly matterId: string;
  readonly clientId: string | null;
  readonly timekeeperUserId: string;
  readonly roleId: string | null;
  // The parent of roleId where roleId is a sub-role (Partner under Attorney), so a card that prices
  // Attorney but not Partner still prices a Partner. Absent or null where there is no parent.
  readonly parentRoleId?: string | null;
  readonly workDate: string; // PlainDate
  readonly rateCardId?: string;
  readonly overrideE4?: number;
}

// A superset of rate.tier: `override` and `card_default` are resolution outcomes, not stored rows.
export type RateSource = "override" | "matter" | "client" | "timekeeper" | "role" | "card_default";

export type RateResolution =
  | { rateE4: number; rateCardId: string; rateSource: RateSource; currency: string }
  | { noRate: true };

// The precedence order, most-specific first. Each entry names the rate.tier to query and the
// scoped_id to match (from the context); the resolution source recorded on the entry. The card_default
// is the role tier with a null scoped_id — the card-wide fallback for the tier. The first candidate
// with a version in force on work_date wins.
interface Candidate {
  readonly tier: RateTier;
  readonly scopedId: string | null;
  readonly source: Exclude<RateSource, "override">;
}

function candidatesFor(context: RateResolutionContext): Candidate[] {
  const candidates: Candidate[] = [];
  candidates.push({ tier: "matter", scopedId: context.matterId, source: "matter" });
  if (context.clientId !== null) {
    candidates.push({ tier: "client", scopedId: context.clientId, source: "client" });
  }
  candidates.push({ tier: "timekeeper", scopedId: context.timekeeperUserId, source: "timekeeper" });
  if (context.roleId !== null) {
    candidates.push({ tier: "role", scopedId: context.roleId, source: "role" });
  }
  if (context.parentRoleId !== undefined && context.parentRoleId !== null) {
    candidates.push({ tier: "role", scopedId: context.parentRoleId, source: "role" });
  }
  candidates.push({ tier: "role", scopedId: null, source: "card_default" });
  return candidates;
}

// The one statement of "this rate version is in force on that date", over the parameter that holds
// the date: valid_from inclusive, valid_to exclusive, an open row open-ended. The prefix names the
// table alias where the statement joins.
function rateInForceOn(dateParameter: string, columnPrefix = ""): string {
  const from = `${columnPrefix}valid_from`;
  const to = `${columnPrefix}valid_to`;
  return `${from} <= ${dateParameter} AND (${to} IS NULL OR ${to} > ${dateParameter})`;
}

// Resolution filters rate rows to the one version whose [valid_from, valid_to) contains work_date:
// valid_from is inclusive, valid_to is exclusive (an open row has valid_to NULL). PlainDate strings
// (YYYY-MM-DD) compare correctly under lexical ordering, so the interval test is a string comparison.
async function resolveTier(
  database: SqlDatabase,
  rateCardId: string,
  candidate: Candidate,
  workDate: string,
): Promise<{ rateE4: number; currency: string } | undefined> {
  const { results } = await database
    .prepare(
      `SELECT rate_e4, currency FROM ${RATE_TABLE} WHERE rate_card_id = ?1 AND tier = ?2 AND scoped_id IS ?3 AND ${rateInForceOn("?4")} LIMIT 1`,
    )
    .bind(rateCardId, candidate.tier, candidate.scopedId, workDate)
    .all<{ rate_e4: number; currency: string }>();
  const row = results[0];
  return row === undefined ? undefined : { rateE4: row.rate_e4, currency: row.currency };
}

export async function resolveRate(
  database: SqlDatabase,
  context: RateResolutionContext,
): Promise<RateResolution> {
  // No card chosen = non-billable internal time: there is nothing to resolve against. An override with
  // no card is treated the same — the override is only meaningful as a rate ON a card.
  if (context.rateCardId === undefined) return { noRate: true };
  const rateCardId = context.rateCardId;

  if (context.overrideE4 !== undefined) {
    // An override sits above every stored tier; it carries no stored currency, so it inherits the
    // card's resolved currency (the most-specific in-force version), falling back to the firm seed.
    const resolved = await firstInForce(database, rateCardId, context);
    return {
      rateE4: context.overrideE4,
      rateCardId,
      rateSource: "override",
      // The platform is single-currency (USD) today — every account and entry pins USD; multi-currency
      // is a future schema change. USD is therefore the correct base when no stored row is in force.
      currency: resolved?.currency ?? "USD",
    };
  }

  for (const candidate of candidatesFor(context)) {
    const hit = await resolveTier(database, rateCardId, candidate, context.workDate);
    if (hit !== undefined) {
      return {
        rateE4: hit.rateE4,
        rateCardId,
        rateSource: candidate.source,
        currency: hit.currency,
      };
    }
  }
  return { noRate: true };
}

// The currency carried alongside an override: the first stored tier in force on work_date (so the
// override is denominated like the card it overrides). Undefined when the card has no version yet.
async function firstInForce(
  database: SqlDatabase,
  rateCardId: string,
  context: RateResolutionContext,
): Promise<{ currency: string } | undefined> {
  for (const candidate of candidatesFor(context)) {
    const hit = await resolveTier(database, rateCardId, candidate, context.workDate);
    if (hit !== undefined) return { currency: hit.currency };
  }
  return undefined;
}

/**
 * The client a matter's time is priced for: the matter's client party, read from `matter_party`, the
 * one home for that link, ignoring a party since removed. The client-tier rate is scoped to this directory entity, so every capture
 * path passes it to `resolveRate`. A matter with two client parties takes the lowest identifier, the
 * same choice every report makes; a matter with none resolves no client tier.
 */
export async function readMatterClientId(
  database: SqlDatabase,
  matterId: string,
): Promise<string | null> {
  const { results } = await database
    .prepare(
      "SELECT MIN(entity_id) AS client_entity_id FROM matter_party WHERE matter_id = ?1 AND role = 'client' AND deleted_at IS NULL",
    )
    .bind(matterId)
    .all<{ client_entity_id: string | null }>();
  return results[0]?.client_entity_id ?? null;
}

/** The role a timekeeper's rate is priced by, and its parent where it is a sub-role. */
export interface TimekeeperRateRole {
  readonly roleId: string | null;
  readonly parentRoleId: string | null;
}

// Which of a timekeeper's roles prices their time. A member can hold several (Attorney and Admin,
// say), and the answer has to be the same on every read, so the order is fixed: a sub-role first,
// because it is the most specific thing the firm said about the person; then a role that has
// sub-roles, because that is a family of fee-earners; then by name. A per-timekeeper rate still
// outranks all of this, since the timekeeper tier sits above the role tier.
export async function readTimekeeperRateRole(
  database: SqlDatabase,
  timekeeperUserId: string,
): Promise<TimekeeperRateRole> {
  const { results } = await database
    .prepare(
      "SELECT role.id AS roleId, role.parent_role_id AS parentRoleId FROM member_role " +
        "JOIN role ON role.id = member_role.role_id WHERE member_role.member_user_id = ?1 " +
        "ORDER BY (role.parent_role_id IS NULL), " +
        "NOT EXISTS (SELECT 1 FROM role AS child WHERE child.parent_role_id = role.id), " +
        "role.name LIMIT 1",
    )
    .bind(timekeeperUserId)
    .all<{ roleId: string; parentRoleId: string | null }>();
  const row = results[0];
  return row === undefined
    ? { roleId: null, parentRoleId: null }
    : { roleId: row.roleId, parentRoleId: row.parentRoleId };
}

/** A matter-tier or client-tier rate version in force on one date, with the card it is on. */
export interface ScopedRateInForce {
  readonly rateId: string;
  readonly rateCardId: string;
  readonly rateCardName: string;
  readonly tier: "matter" | "client";
  readonly scopedId: string;
  readonly rateE4: number;
  readonly currency: string;
  readonly validFrom: string;
  readonly validTo: string | null;
}

// Every rate recorded against a particular matter or client and in force on one date, across the
// firm's cards that are not archived (an archived card is never the one capture falls back to).
// These are the two tiers that name a matter or its client; the timekeeper and role tiers price a
// person, not a matter, and are not here. Ordered so a reader's list is stable: card, tier, scope.
export async function readMatterAndClientRatesInForce(
  database: SqlDatabase,
  date: string,
): Promise<ScopedRateInForce[]> {
  const { results } = await database
    .prepare(
      `SELECT r.id, r.rate_card_id, c.name AS rate_card_name, r.tier, r.scoped_id, r.rate_e4, r.currency, r.valid_from, r.valid_to
         FROM ${RATE_TABLE} r JOIN ${RATE_CARD_TABLE} c ON c.id = r.rate_card_id
        WHERE r.tier IN ('matter', 'client') AND r.scoped_id IS NOT NULL AND c.archived_at IS NULL
          AND ${rateInForceOn("?1", "r.")}
        ORDER BY c.name, r.rate_card_id, r.tier, r.scoped_id`,
    )
    .bind(date)
    .all<{
      id: string;
      rate_card_id: string;
      rate_card_name: string;
      tier: "matter" | "client";
      scoped_id: string;
      rate_e4: number;
      currency: string;
      valid_from: string;
      valid_to: string | null;
    }>();
  return results.map((row) => ({
    rateId: row.id,
    rateCardId: row.rate_card_id,
    rateCardName: row.rate_card_name,
    tier: row.tier,
    scopedId: row.scoped_id,
    rateE4: row.rate_e4,
    currency: row.currency,
    validFrom: row.valid_from,
    validTo: row.valid_to,
  }));
}
