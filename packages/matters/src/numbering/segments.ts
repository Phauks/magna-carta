import { z } from "zod";

// The matter-number scheme is an ordered template of segments; rendered values join in order and
// separators are just literal segments. Counter scope is derived from the template — any segment may
// be marked `scoping`, and the counter resets per distinct combination of rendered scoping values.
export type NumberSegment =
  | { kind: "literal"; text: string }
  | { kind: "counter"; padWidth: number; start?: number }
  | { kind: "year"; digits: 2 | 4; scoping?: boolean }
  | { kind: "date_opened"; scoping?: boolean } // YYYYMMDD
  | { kind: "location_code"; scoping?: boolean }
  | { kind: "matter_type_code"; scoping?: boolean }
  | { kind: "client_code"; scoping?: boolean }
  | { kind: "staff_initials"; scoping?: boolean }
  | { kind: "client_name"; scoping?: boolean };

// The rendered number must be URL-safe (it is both primary key and public id, and rides in URLs).
// RFC 3986 unreserved characters only — a literal authored in the settings UI is validated here.
export const URL_SAFE_PATTERN = /^[A-Za-z0-9._~-]+$/;

const scoping = z.boolean().optional();

const segmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("literal"), text: z.string().regex(URL_SAFE_PATTERN) }),
  z.object({
    kind: z.literal("counter"),
    padWidth: z.number().int().positive(),
    start: z.number().int().positive().optional(),
  }),
  z.object({ kind: z.literal("year"), digits: z.union([z.literal(2), z.literal(4)]), scoping }),
  z.object({ kind: z.literal("date_opened"), scoping }),
  z.object({ kind: z.literal("location_code"), scoping }),
  z.object({ kind: z.literal("matter_type_code"), scoping }),
  z.object({ kind: z.literal("client_code"), scoping }),
  z.object({ kind: z.literal("staff_initials"), scoping }),
  z.object({ kind: z.literal("client_name"), scoping }),
]);

// Exactly one counter: a scheme with none has nothing to increment; two would race for one counter
// row. The renderer trusts this invariant, so the schema is the one place it is enforced.
export const numberingSchemeSchema: z.ZodType<readonly NumberSegment[]> = z
  .array(segmentSchema)
  .superRefine((segments, ctx) => {
    const counters = segments.filter((segment) => segment.kind === "counter").length;
    if (counters !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a numbering scheme needs exactly one counter segment (found ${counters})`,
      });
    }
  });
