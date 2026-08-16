import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { MatterId, UserId } from "@magna-carta/identifiers/types";

// The audit events for natural-language search. Metadata is identifiers, version numbers, and closed
// labels — nothing else, ever.
//
// That is enforced STRUCTURALLY rather than by care: every builder below takes a typed input whose
// fields are identifiers, numbers, and booleans, so there is no field a member's question, a passage
// of a document, or a client's name could be passed in. Somebody who wanted to log what a member
// typed would have to change a type signature in this file, which is a visible act rather than an
// oversight at a call site.
//
// THE QUERY EVENT IS THE ONE TO READ CAREFULLY. A member's natural-language question about a client
// matter is privileged content. The row records WHO asked, WHICH matter, and HOW MANY results came
// back. It does not record the question, and there is no field here in which it could.

export const NATURAL_LANGUAGE_SEARCH_EVENTS = {
  firmOptedIn: "search.natural_language.firm_opted_in",
  firmOptedOut: "search.natural_language.firm_opted_out",
  disclosureAcknowledged: "search.natural_language.disclosure_acknowledged",
  matterExclusionSet: "search.natural_language.matter_exclusion_set",
  matterExclusionCleared: "search.natural_language.matter_exclusion_cleared",
  instanceProvisioned: "search.natural_language.instance_provisioned",
  instanceDestroyed: "search.natural_language.instance_destroyed",
  queried: "search.natural_language.queried",
} as const;

// What every write here needs from its caller: the clock and the acting member. This package reads
// no ambient clock and trusts no ambient identity. The optional seeded source lets fixtures mint
// byte-deterministic identifiers.
export interface NaturalLanguageWriteContext {
  readonly clock: { now(): string };
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

function auditStatement(
  database: SqlDatabase,
  context: NaturalLanguageWriteContext,
  event: string,
  subjectId: string,
  metadata?: Record<string, string | number | boolean | null>,
): SqlStatement {
  return domainAuditStatement(database, {
    event,
    subjectId,
    actorUserId: context.actorUserId,
    clock: context.clock,
    ...(context.randomSource !== undefined && { randomSource: context.randomSource }),
    ...(metadata !== undefined && { metadata }),
  });
}

// The firm turned it on. The subject is the setting key rather than an entity handle: the thing that
// changed is a firm-level policy, and the per-firm database is already the firm.
export function firmOptedInAudit(
  database: SqlDatabase,
  context: NaturalLanguageWriteContext,
  input: { readonly settingKey: string; readonly disclosureVersion: number },
): SqlStatement {
  return auditStatement(
    database,
    context,
    NATURAL_LANGUAGE_SEARCH_EVENTS.firmOptedIn,
    input.settingKey,
    {
      disclosureVersion: input.disclosureVersion,
    },
  );
}

export function firmOptedOutAudit(
  database: SqlDatabase,
  context: NaturalLanguageWriteContext,
  input: { readonly settingKey: string; readonly disclosureVersion: number },
): SqlStatement {
  return auditStatement(
    database,
    context,
    NATURAL_LANGUAGE_SEARCH_EVENTS.firmOptedOut,
    input.settingKey,
    { disclosureVersion: input.disclosureVersion },
  );
}

// Which version of the statement was accepted, and by whom. The version is the load-bearing field:
// an acknowledgement without one is an acknowledgement of an unknown thing, and it is what makes the
// firm get asked again when the statement changes.
export function disclosureAcknowledgedAudit(
  database: SqlDatabase,
  context: NaturalLanguageWriteContext,
  input: { readonly disclosureVersion: number },
): SqlStatement {
  return auditStatement(
    database,
    context,
    NATURAL_LANGUAGE_SEARCH_EVENTS.disclosureAcknowledged,
    "firm",
    { disclosureVersion: input.disclosureVersion },
  );
}

export function matterExclusionSetAudit(
  database: SqlDatabase,
  context: NaturalLanguageWriteContext,
  input: { readonly matterId: MatterId },
): SqlStatement {
  return auditStatement(
    database,
    context,
    NATURAL_LANGUAGE_SEARCH_EVENTS.matterExclusionSet,
    input.matterId,
  );
}

export function matterExclusionClearedAudit(
  database: SqlDatabase,
  context: NaturalLanguageWriteContext,
  input: { readonly matterId: MatterId },
): SqlStatement {
  return auditStatement(
    database,
    context,
    NATURAL_LANGUAGE_SEARCH_EVENTS.matterExclusionCleared,
    input.matterId,
  );
}

// The instance exists. The subject is the derived instance name, which is opaque and carries no firm
// or client text — recording it is what lets an operator match an audit row against an account-level
// surface without either side naming the firm.
export function instanceProvisionedAudit(
  database: SqlDatabase,
  context: NaturalLanguageWriteContext,
  input: { readonly instanceName: string; readonly configurationGeneration: number },
): SqlStatement {
  return auditStatement(
    database,
    context,
    NATURAL_LANGUAGE_SEARCH_EVENTS.instanceProvisioned,
    input.instanceName,
    { configurationGeneration: input.configurationGeneration },
  );
}

// The instance was ASKED to be destroyed, and what could be demonstrated alongside. `acknowledged`
// says the service accepted the request and nothing more — the platform can demonstrate deletion of
// the text it wrote into its own storage, which is what `feedObjectsRemoved` counts, and cannot
// demonstrate anything about the managed index.
export function instanceDestroyedAudit(
  database: SqlDatabase,
  context: NaturalLanguageWriteContext,
  input: {
    readonly instanceName: string;
    readonly acknowledged: boolean;
    readonly feedObjectsRemoved: number;
  },
): SqlStatement {
  return auditStatement(
    database,
    context,
    NATURAL_LANGUAGE_SEARCH_EVENTS.instanceDestroyed,
    input.instanceName,
    { acknowledged: input.acknowledged, feedObjectsRemoved: input.feedObjectsRemoved },
  );
}

// One query. WHO, WHICH MATTER, HOW MANY RESULTS — and there is no fourth field, because the fourth
// field anyone would reach for is the question itself.
//
// The count is the count the member SAW. The number of hits dropped by re-authorization is
// deliberately not here and is deliberately never returned to the caller either: "your query matched
// fourteen passages you are not permitted to see" is itself a disclosure, and a measurable one. That
// number goes to the error pipeline, where the people who can act on a filter defect will see it.
export function queriedAudit(
  database: SqlDatabase,
  context: NaturalLanguageWriteContext,
  input: { readonly matterId: MatterId; readonly resultCount: number },
): SqlStatement {
  return auditStatement(database, context, NATURAL_LANGUAGE_SEARCH_EVENTS.queried, input.matterId, {
    resultCount: input.resultCount,
  });
}
