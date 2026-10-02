import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { NumberingSchemeId, UserId } from "@magna-carta/identifiers/types";
import { z } from "zod";
import { schemePurposeOf, type SchemeNumberingPurpose } from "./purposes.ts";
import {
  deactivateActiveSchemeStatement,
  insertNumberingSchemeStatement,
  selectActiveSchemeStatement,
} from "./scheme-statements.ts";
import { numberingSchemeSchema, type NumberSegment } from "./segments.ts";

// The numbering-scheme configuration service. setActiveNumberingScheme is the one write path the
// "exactly one active scheme per purpose" invariant flows through; it validates the segments through
// numberingSchemeSchema (the single home for the exactly-one-counter and URL-safe-literal rules) and
// against the purpose's own vocabulary, so a scheme that reaches a draw is always renderable. A
// number, once drawn, is frozen — a new scheme changes only the records numbered after it.

// The minimum the write needs to audit itself — the clock and actor arrive from the caller (the
// service reads no clock and trusts no ambient identity).
export interface SchemeServiceOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

// Parse the stored JSON back through the schema so a corrupt or hand-edited row surfaces as a parse
// error rather than a malformed render at draw time. Undefined when the firm has configured nothing
// for the purpose; whether a default then applies is the purpose register's answer, not this read's.
export async function readActiveScheme(
  database: SqlDatabase,
  purpose: SchemeNumberingPurpose = "matter",
): Promise<readonly NumberSegment[] | undefined> {
  const { results } = await selectActiveSchemeStatement(database, purpose).all<{
    segments: string;
  }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return numberingSchemeSchema.parse(JSON.parse(row.segments));
}

// The active scheme, or the purpose's built-in default, or undefined for a purpose that refuses to
// default (the matter run). What every read surface shows as "in force".
export async function readSchemeInForce(
  database: SqlDatabase,
  purpose: SchemeNumberingPurpose,
): Promise<
  { readonly segments: readonly NumberSegment[]; readonly usingDefault: boolean } | undefined
> {
  const configured = await readActiveScheme(database, purpose);
  if (configured !== undefined) return { segments: configured, usingDefault: false };
  const fallback = schemePurposeOf(purpose).fallbackScheme;
  return fallback === null ? undefined : { segments: fallback, usingDefault: true };
}

// A scheme is validated against its purpose as well as against the shape rules, and every one of
// these refusals belongs at the SAVE, where the person who wrote the scheme is looking, rather than
// on the first draw under it — which is a record somebody was trying to create.
export function schemeSchemaFor(
  purpose: SchemeNumberingPurpose,
): z.ZodType<readonly NumberSegment[]> {
  const definition = schemePurposeOf(purpose);
  const allowed = new Set<string>(definition.segmentKinds);
  return numberingSchemeSchema.superRefine((segments, ctx) => {
    const refuse = (message: string): void => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    };
    for (const segment of segments) {
      // A conflicts check has no client code to render, and a matter number built from a matter
      // number is a definition that eats itself.
      if (!allowed.has(segment.kind)) {
        refuse(`a ${purpose} numbering scheme cannot use a ${segment.kind} part`);
      }
      // On a run whose count is scoped by the domain rather than by the template, a part marked as
      // restarting the count restarts nothing: the scope is the matter or the letterhead either
      // way. A switch that does nothing is worse than one that is not offered.
      if (definition.scopeSource === "owner" && "scoping" in segment && segment.scoping === true) {
        refuse(
          `a ${purpose} number already counts within its own scope, so no part of it restarts the count`,
        );
      }
    }
    // An owner-scoped run gets no uniqueness from its template for free: two matters both count
    // 0001, so the part that names the scope is what keeps their numbers apart, and a scheme
    // without it would render the same number on two records.
    const distinguisher = definition.scopeDistinguishedBy;
    if (distinguisher !== null && !segments.some((segment) => segment.kind === distinguisher)) {
      refuse(
        `a ${purpose} numbering scheme needs its ${distinguisher} part to tell one run from another`,
      );
    }
  });
}

export interface SetSchemeResult {
  readonly schemeId: NumberingSchemeId;
  readonly effect: EffectWrite;
}

// Validates the segments (throws ZodError on an invalid scheme — the route maps it to a 422) and
// returns the deactivate-then-insert batch plus an audit row. Caller commits through composeEffectBatch.
export function setActiveNumberingScheme(
  database: SqlDatabase,
  segments: readonly NumberSegment[],
  options: SchemeServiceOptions,
  purpose: SchemeNumberingPurpose = "matter",
): SetSchemeResult {
  const validated = schemeSchemaFor(purpose).parse(segments);
  const schemeId = newIdentifier("numberingScheme", options.randomSource);
  const now = options.clock.now();
  return {
    schemeId,
    effect: {
      statements: [
        deactivateActiveSchemeStatement(database, purpose, now),
        insertNumberingSchemeStatement(database, {
          id: schemeId,
          segments: JSON.stringify(validated),
          purpose,
          createdAt: now,
        }),
        domainAuditStatement(database, {
          event: "numberingScheme.updated",
          subjectId: schemeId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
        }),
      ],
      outboxMessages: [],
    },
  };
}
