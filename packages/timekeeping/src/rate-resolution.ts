import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { RATE_TABLE, type RateTier } from "./rate-statements.ts";

// The capture-time inputs the rate engine needs. clientId is derived from the matter and roleId from
// the timekeeper's member record at the call site (re-derivable for an audit of rate_source, not
// snapshotted separately). rateCardId names which card resolves the rate (a matter may be on a capped
// card); overrideE4 is a per-entry manual rate that sits above every stored tier.
export interface RateResolutionContext {
  readonly matterId: string;
  readonly clientId: string | null;
  readonly timekeeperUserId: string;
  readonly roleId: string | null;
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
  candidates.push({ tier: "role", scopedId: null, source: "card_default" });
  return candidates;
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
      `SELECT rate_e4, currency FROM ${RATE_TABLE} WHERE rate_card_id = ?1 AND tier = ?2 AND scoped_id IS ?3 AND valid_from <= ?4 AND (valid_to IS NULL OR valid_to > ?4) LIMIT 1`,
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
