import { z } from "zod";

// A numbering scheme is an ordered template of segments; rendered values join in order and
// separators are just literal segments. Counter scope is derived from the template — any valued
// segment may be marked `scoping`, and the counter resets per distinct combination of rendered
// scoping values. The same template shapes every sequence the firm configures (matter numbers,
// consultation and intake numbers, conflicts check numbers, custody numbers); which segment kinds a
// given sequence may use is the purpose registry's answer (purposes.ts), not this file's.
export type NumberSegment =
  | { kind: "literal"; text: string }
  | { kind: "counter"; padWidth: number; start?: number }
  | { kind: "year"; digits: 2 | 4; scoping?: boolean }
  | { kind: "month"; scoping?: boolean } // two digits
  | { kind: "day"; scoping?: boolean } // two digits
  | { kind: "date_opened"; separator?: NumberPartSeparator; scoping?: boolean } // YYYY?MM?DD
  | { kind: "matter_number"; scoping?: boolean }
  | { kind: "location_code"; scoping?: boolean }
  | { kind: "matter_type_code"; scoping?: boolean }
  | { kind: "client_code"; scoping?: boolean }
  | { kind: "staff_initials"; scoping?: boolean }
  | { kind: "client_name"; separator?: NumberPartSeparator; scoping?: boolean };

/**
 * What stands between the pieces of a part that has more than one: the year, month and day of the
 * date numbered, the words of a client's name. Only the URL-safe punctuation — a number rides in
 * links, so a slash or a space can never be one — plus nothing at all. ABSENT means nothing: that is
 * how both parts rendered before a firm could choose (20261111, AshcombeMercantile), and a scheme
 * saved before the choice existed must keep drawing the numbers it always drew.
 */
export type NumberPartSeparator = "-" | "." | "_" | "~" | "";

export const NUMBER_PART_SEPARATORS: readonly NumberPartSeparator[] = ["-", ".", "_", "~", ""];

export type NumberSegmentKind = NumberSegment["kind"];

// Every kind, in the order an editor offers them: the two structural parts, then the dates, then
// what the record carries.
export const NUMBER_SEGMENT_KINDS: readonly NumberSegmentKind[] = [
  "literal",
  "counter",
  "year",
  "month",
  "day",
  "date_opened",
  "matter_number",
  "location_code",
  "matter_type_code",
  "client_code",
  "staff_initials",
  "client_name",
];

// The rendered number must be URL-safe (it is both primary key and public id, and rides in URLs).
// RFC 3986 unreserved characters only — a literal authored in the settings UI is validated here.
export const URL_SAFE_PATTERN = /^[A-Za-z0-9._~-]+$/;

const scoping = z.boolean().optional();
const separator = z.enum(["-", ".", "_", "~", ""]).optional();

const segmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("literal"), text: z.string().regex(URL_SAFE_PATTERN) }),
  z.object({
    kind: z.literal("counter"),
    padWidth: z.number().int().positive(),
    start: z.number().int().positive().optional(),
  }),
  z.object({ kind: z.literal("year"), digits: z.union([z.literal(2), z.literal(4)]), scoping }),
  z.object({ kind: z.literal("month"), scoping }),
  z.object({ kind: z.literal("day"), scoping }),
  z.object({ kind: z.literal("date_opened"), separator, scoping }),
  z.object({ kind: z.literal("matter_number"), scoping }),
  z.object({ kind: z.literal("location_code"), scoping }),
  z.object({ kind: z.literal("matter_type_code"), scoping }),
  z.object({ kind: z.literal("client_code"), scoping }),
  z.object({ kind: z.literal("staff_initials"), scoping }),
  z.object({ kind: z.literal("client_name"), separator, scoping }),
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

// numberingSchemeSchema guarantees exactly one counter; the start defaults to 1.
export function startValueOf(segments: readonly NumberSegment[]): number {
  return segments.find((segment) => segment.kind === "counter")?.start ?? 1;
}
