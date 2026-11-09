import { z } from "zod";
import { CALLER_LINE_TYPES } from "./port.ts";

// What the caller lookup's API accepts and answers, as plain zod. Each component is named with zod's
// own metadata (`.meta({ id })`), which the contract emitter reads as the component's name, so the
// route module in apps/api-worker declares its routes over these without restating a field. The rule
// is in docs/conventions/api.md (_Where a contract shape lives_).
//
// THE NUMBER TRAVELS IN A BODY, never a path or a query: it is a client's, and a URL is what request
// logs, proxies and browser history keep.

export const CallerLookupRequest = z
  .object({
    number: z
      .string()
      .regex(/^\+[1-9][0-9]{6,14}$/)
      .meta({
        description:
          "The number in E.164 — a plus, the country calling code and the national number, digits " +
          "only. The form builds it from the number field and its country.",
        example: "+17025550142",
      }),
  })
  .meta({ id: "CallerLookupRequest" });

export const CallerDirectoryMatch = z
  .object({
    entityId: z.string(),
    entityKind: z.enum(["person", "organization"]),
    displayName: z.string().nullable().meta({
      description: "Null when the record holds no name at all; a reader shows the gap.",
    }),
  })
  .meta({ id: "CallerDirectoryMatch" });

export const CallerAreaCode = z
  .object({
    areaCode: z.string(),
    region: z.string().meta({
      description:
        "Where the area code was issued — a state, a province or a city. Where the number was " +
        "issued, never where the caller is.",
    }),
  })
  .meta({ id: "CallerAreaCode" });

export const KeptCallerIdentity = z
  .object({
    callerName: z.string().nullable().meta({
      description:
        "The name the carriers' caller-name database holds, as it holds it. Null when it holds none.",
    }),
    lineType: z.enum(CALLER_LINE_TYPES).nullable(),
    carrierName: z.string().nullable(),
    lookedUpAt: z.iso.datetime(),
  })
  .meta({ id: "CallerIdentity", description: "A caller ID the firm already paid for, or null." });

export const CallerLookup = z
  .object({
    directoryMatches: z.array(CallerDirectoryMatch),
    areaCode: CallerAreaCode.nullable(),
    callerIdentity: KeptCallerIdentity.nullable(),
    paidLookup: z.enum(["available", "unavailable", "not-covered"]).meta({
      description:
        "Whether a caller-ID lookup may be asked for. `unavailable` means none is provisioned; " +
        "`not-covered` means no caller-name data exists for numbers in this country.",
    }),
  })
  .meta({ id: "CallerLookup" });

export const CallerIdentityLookup = z
  .discriminatedUnion("outcome", [
    z.object({ outcome: z.literal("found"), callerIdentity: KeptCallerIdentity }),
    z.object({ outcome: z.literal("not-covered") }),
    z.object({ outcome: z.literal("unavailable") }),
  ])
  .meta({
    id: "CallerIdentityLookup",
    description:
      "`found` is the kept answer, which may hold no name. `not-covered` and `unavailable` are " +
      "answers, not failures: nothing was asked and nothing was charged.",
  });
