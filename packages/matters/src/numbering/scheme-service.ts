import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { NumberingSchemeId } from "@magna-carta/identifiers/types";
import { matterAuditStatement, type AuditContext } from "../audit.ts";
import {
  deactivateActiveSchemeStatement,
  insertNumberingSchemeStatement,
  selectActiveSchemeSegmentsStatement,
} from "./scheme-statements.ts";
import { numberingSchemeSchema, type NumberSegment } from "./segments.ts";

// The numbering-scheme configuration service. setActiveNumberingScheme is the one write path the
// "exactly one active scheme" invariant flows through; it validates the segments through
// numberingSchemeSchema (the single home for the exactly-one-counter and URL-safe-literal rules), so
// a scheme that reaches the matter draw is always renderable. A number, once drawn, is frozen — a new
// scheme changes only matters numbered after it.

export type SchemeServiceOptions = AuditContext;

// Parse the stored JSON back through the schema so a corrupt or hand-edited row surfaces as a parse
// error rather than a malformed render at draw time.
export async function readActiveScheme(
  database: SqlDatabase,
): Promise<readonly NumberSegment[] | undefined> {
  const { results } = await selectActiveSchemeSegmentsStatement(database).all<{
    segments: string;
  }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return numberingSchemeSchema.parse(JSON.parse(row.segments));
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
): SetSchemeResult {
  const validated = numberingSchemeSchema.parse(segments);
  const schemeId = newIdentifier("numberingScheme", options.randomSource);
  const now = options.clock.now();
  return {
    schemeId,
    effect: {
      statements: [
        deactivateActiveSchemeStatement(database, now),
        insertNumberingSchemeStatement(database, {
          id: schemeId,
          segments: JSON.stringify(validated),
          createdAt: now,
        }),
        matterAuditStatement(database, options, "numberingScheme.updated", schemeId),
      ],
      outboxMessages: [],
    },
  };
}
