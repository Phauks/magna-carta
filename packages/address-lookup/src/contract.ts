import { z } from "zod";

// What the address lookup's API accepts and answers, as plain zod. Each component is named with zod's
// own metadata (`.meta({ id })`), which the contract emitter reads as the component's name, so the
// route module in apps/api-worker declares its routes over these without restating a field. The rule
// is in docs/conventions/api.md (_Where a contract shape lives_).
//
// THE QUERY AND THE OFFER IDENTIFIER TRAVEL IN A BODY, never a path or a query string: both can carry
// a client's address, and a URL is what request logs, proxies and browser history keep.

export const AddressLookupParts = z
  .object({
    street: z.string().optional(),
    streetTwo: z.string().optional(),
    dependentLocality: z.string().optional(),
    city: z.string().optional(),
    region: z.string().optional(),
    postal: z.string().optional(),
    sortingCode: z.string().optional(),
    country: z.string().optional().meta({ description: "ISO 3166-1 alpha-2." }),
  })
  .meta({
    id: "AddressLookupParts",
    description:
      "An address as the parts a record stores, named for their position in an address rather than " +
      "for what any one country calls them.",
  });

export const AddressSuggestion = z
  .object({
    suggestionId: z.string().meta({
      description:
        "Opaque. Meaningful only to the resolution operation, short-lived, and able to carry an " +
        "address — so it is sent back in a request body, never a URL.",
    }),
    label: z.string().meta({ description: "The whole offer on one line, for a list." }),
    parts: AddressLookupParts,
    kind: z.enum(["address", "group"]).meta({
      description:
        "A group is a building whose units share one street line. It is not an address a record " +
        "can hold: resolving it answers the addresses inside it.",
    }),
    count: z
      .number()
      .int()
      .positive()
      .optional()
      .meta({ description: "For a group, how many addresses it holds." }),
  })
  .meta({ id: "AddressSuggestion" });

export const SuggestionsRequest = z
  .object({
    country: z
      .string()
      .regex(/^[A-Za-z]{2}$/)
      .meta({ description: "ISO 3166-1 alpha-2: the country the address is in." }),
    query: z.string().max(200).meta({ description: "What has been typed so far." }),
    limit: z.number().int().min(1).max(10).optional(),
    near: z
      .string()
      .regex(/^[A-Za-z0-9]{1,3}$/)
      .optional()
      .meta({
        description:
          "The region the address is probably in — the subdivision part of an ISO 3166-2 code, " +
          "without the country (`NC`, not `US-NC`). Ranks nearby addresses first and never hides " +
          "the rest. Absent, the caller's primary office stands in for it.",
      }),
  })
  .meta({ id: "AddressSuggestionsRequest" });

export const AddressLocation = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .meta({
    id: "AddressLocation",
    description:
      "Where the address is, as the open address data records it. For a map or a distance; not a " +
      "postal fact.",
  });

export const SuggestionsResponse = z
  .discriminatedUnion("outcome", [
    z.object({
      outcome: z.literal("suggestions"),
      suggestions: z.array(AddressSuggestion),
      attribution: z
        .enum(["google-maps"])
        .optional()
        .meta({
          description:
            "Whose data the offers are, when its terms require the list to say so. `google-maps`: " +
            "the list shows the words Google Maps in the same container as the offers.",
        }),
    }),
    z.object({ outcome: z.literal("no-coverage") }),
    z.object({ outcome: z.literal("unavailable") }),
  ])
  .meta({
    id: "AddressSuggestionsResponse",
    description:
      "`suggestions` may be empty, which means the country is covered and nothing matched. " +
      "`no-coverage` means the service holds no addresses for that country, which is not the same " +
      "thing and must not be shown as though it were. `unavailable` means no address service is " +
      "provisioned: a person types the address themselves, exactly as before.",
  });

export const ResolutionRequest = z
  .object({ suggestionId: z.string().min(1).max(2048) })
  .meta({ id: "AddressResolutionRequest" });

export const ResolutionResponse = z
  .discriminatedUnion("outcome", [
    z.object({
      outcome: z.literal("address"),
      parts: AddressLookupParts,
      location: AddressLocation.optional(),
    }),
    z.object({ outcome: z.literal("group"), suggestions: z.array(AddressSuggestion) }),
    z.object({ outcome: z.literal("expired") }),
    z.object({ outcome: z.literal("no-coverage") }),
    z.object({ outcome: z.literal("unavailable") }),
  ])
  .meta({
    id: "AddressResolutionResponse",
    description:
      "`address` is the parts a record stores. `group` is the addresses inside a group, offered in " +
      "turn. `expired` is an offer the service no longer knows — nothing went wrong, and the caller " +
      "asks again.",
  });

/** One offer as the API answers it. */
export type AddressSuggestionBody = z.infer<typeof AddressSuggestion>;
