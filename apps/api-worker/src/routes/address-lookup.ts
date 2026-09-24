/*
 * Address autocomplete: offer real addresses as a person types one, and turn a chosen offer into the
 * parts a record stores.
 *
 * READ-SHAPED POSTS, AND THE REASON IS THE LOG. Both operations read and write nothing, and would be
 * GETs anywhere else. But this Worker's invocation logging records every request's full URL, query
 * string included, and what is being sent is a client's address — typed a few characters at a time,
 * so a GET would leave a trail of every client address anybody entered, fragment by fragment. A body
 * is not in that log. The same reason keeps the offer identifier out of the path: it can carry an
 * address too. (This Worker's own telemetry records route templates, never concrete paths, so the
 * exposure a GET creates is in the platform's log rather than ours — which is exactly why it cannot
 * be redacted afterwards.)
 *
 * GATED ON `directory:edit`, WHICH COVERS BOTH FORMS THAT ASK. The Directory's Address pane needs
 * `directory:edit` and the office window needs `locations:manage`; a route takes one permission, and
 * every role that holds `locations:manage` holds `directory:edit` as well — today that is Owner/Admin
 * alone, and a firm cannot define roles of its own. If that ever stops being true, this wants a
 * permission of its own rather than a second copy of the route.
 *
 * NOTHING HERE LOGS WHAT WAS TYPED. What is counted is which operation ran, which engine served it and
 * how it came out — enough for an operator to watch the volume that drives the provider's bill and to
 * see failures begin, and nothing that could carry an address.
 */
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { AddressSuggestion as PortSuggestion } from "@magna-carta/address-lookup/port";
import type { Context } from "hono";
import { resolveAddressLookupPort } from "../address-lookup/address-lookup-engine.ts";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

// ── Contract ────────────────────────────────────────────────────────────────

const AddressLookupParts = z
  .object({
    street: z.string().optional(),
    streetTwo: z.string().optional(),
    dependentLocality: z.string().optional(),
    city: z.string().optional(),
    region: z.string().optional(),
    postal: z.string().optional(),
    sortingCode: z.string().optional(),
    country: z.string().optional().openapi({ description: "ISO 3166-1 alpha-2." }),
  })
  .openapi("AddressLookupParts", {
    description:
      "An address as the parts a record stores, named for their position in an address rather than " +
      "for what any one country calls them.",
  });

const AddressSuggestion = z
  .object({
    suggestionId: z.string().openapi({
      description:
        "Opaque. Meaningful only to the resolution operation, short-lived, and able to carry an " +
        "address — so it is sent back in a request body, never a URL.",
    }),
    label: z.string().openapi({ description: "The whole offer on one line, for a list." }),
    parts: AddressLookupParts,
    kind: z.enum(["address", "group"]).openapi({
      description:
        "A group is a building whose units share one street line. It is not an address a record " +
        "can hold: resolving it answers the addresses inside it.",
    }),
    count: z
      .number()
      .int()
      .positive()
      .optional()
      .openapi({ description: "For a group, how many addresses it holds." }),
  })
  .openapi("AddressSuggestion");

const SuggestionsRequest = z
  .object({
    country: z
      .string()
      .regex(/^[A-Za-z]{2}$/)
      .openapi({ description: "ISO 3166-1 alpha-2: the country the address is in." }),
    query: z.string().max(200).openapi({ description: "What has been typed so far." }),
    limit: z.number().int().min(1).max(10).optional(),
  })
  .openapi("AddressSuggestionsRequest");

const SuggestionsResponse = z
  .discriminatedUnion("outcome", [
    z.object({ outcome: z.literal("suggestions"), suggestions: z.array(AddressSuggestion) }),
    z.object({ outcome: z.literal("no-coverage") }),
    z.object({ outcome: z.literal("unavailable") }),
  ])
  .openapi("AddressSuggestionsResponse", {
    description:
      "`suggestions` may be empty, which means the country is covered and nothing matched. " +
      "`no-coverage` means the service holds no addresses for that country, which is not the same " +
      "thing and must not be shown as though it were. `unavailable` means no address service is " +
      "provisioned: a person types the address themselves, exactly as before.",
  });

const ResolutionRequest = z
  .object({ suggestionId: z.string().min(1).max(2048) })
  .openapi("AddressResolutionRequest");

const ResolutionResponse = z
  .discriminatedUnion("outcome", [
    z.object({ outcome: z.literal("address"), parts: AddressLookupParts }),
    z.object({ outcome: z.literal("group"), suggestions: z.array(AddressSuggestion) }),
    z.object({ outcome: z.literal("expired") }),
    z.object({ outcome: z.literal("no-coverage") }),
    z.object({ outcome: z.literal("unavailable") }),
  ])
  .openapi("AddressResolutionResponse", {
    description:
      "`address` is the parts a record stores. `group` is the addresses inside a group, offered in " +
      "turn. `expired` is an offer the service no longer knows — nothing went wrong, and the caller " +
      "asks again.",
  });

const problemResponse = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: Problem } },
});

const commonResponses = {
  401: problemResponse("No valid session"),
  403: problemResponse("Authenticated, but the member lacks directory:edit"),
  404: problemResponse("Not found"),
  422: problemResponse("The request body failed validation"),
  429: problemResponse("Rate limit exceeded"),
  502: problemResponse(
    "The address service did not answer, or refused. Transient and retryable; the address can " +
      "always be typed by hand.",
  ),
};

function lookupMeta(action: string): RouteMeta {
  return {
    operationId: `addressLookup.${action}`,
    surface: "app",
    authenticated: true,
    permission: "directory:edit",
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

export const addressSuggestionsRoute = defineOpenAPIRoute(lookupMeta("suggest"), {
  method: "post",
  path: "/api/v1/address-lookup/suggestions",
  description:
    "Offers real addresses for what has been typed so far, in the country the address is in. A " +
    "read-shaped POST: it reads and writes nothing, and takes a body rather than a query string " +
    "because what it is sent is a client's address.",
  request: {
    body: { content: { "application/json": { schema: SuggestionsRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The offers, or why there are none",
      content: { "application/json": { schema: SuggestionsResponse } },
    },
    ...commonResponses,
  },
});

export const addressResolutionRoute = defineOpenAPIRoute(lookupMeta("resolve"), {
  method: "post",
  path: "/api/v1/address-lookup/resolutions",
  description:
    "Turns a chosen offer into the parts a record stores, or opens a group into the addresses " +
    "inside it. A read-shaped POST, for the same reason as the suggestions operation.",
  request: {
    body: { content: { "application/json": { schema: ResolutionRequest } }, required: true },
  },
  responses: {
    200: {
      description: "What the chosen offer comes to",
      content: { "application/json": { schema: ResolutionResponse } },
    },
    ...commonResponses,
  },
});

// ── Handlers ────────────────────────────────────────────────────────────────

type ContractSuggestion = z.infer<typeof AddressSuggestion>;

/** The port's readonly shapes, copied into the contract's plain ones. */
function toContract(suggestion: PortSuggestion): ContractSuggestion {
  return {
    suggestionId: suggestion.suggestionId,
    label: suggestion.label,
    parts: { ...suggestion.parts },
    kind: suggestion.kind,
    ...(suggestion.count !== undefined && { count: suggestion.count }),
  };
}

/**
 * An adapter error: the one outcome the caller hears about as a failure, because `engine-not-implemented`
 * and `no-coverage` are answers rather than failures and never reach here. It is a 502 answered here
 * rather than thrown into the error pipeline — the WHOIS route's reading of the same situation: a
 * transient fault in somebody else's service, which a retry resolves and a support ticket does not.
 * The `addresses.lookup` count with `outcome: failed` is what tells an operator it has begun.
 */
function lookupFailed(c: Context) {
  return problemJson(c, {
    type: "service-unavailable",
    status: 502,
    title: "Address suggestions are unavailable",
    detail: "The address service did not answer. The address can be typed by hand.",
  });
}

export function registerAddressLookupRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...addressSuggestionsRoute,
      middleware: chokepointMiddleware(chokepoint, addressSuggestionsRoute),
    },
    async (c) => {
      const { country, query, limit } = c.req.valid("json");
      const { port, engine } = resolveAddressLookupPort(c.env);
      const answer = await port.suggest({
        country: country.toUpperCase(),
        query,
        ...(limit !== undefined && { limit }),
      });
      const count = (outcome: string) =>
        c.get("logger")?.count("addresses.lookup", { operation: "suggest", engine, outcome });

      if (answer.ok) {
        count("suggestions");
        return c.json(
          { outcome: "suggestions" as const, suggestions: answer.suggestions.map(toContract) },
          200,
        );
      }
      if (answer.reason === "engine-not-implemented") {
        count("unavailable");
        return c.json({ outcome: "unavailable" as const }, 200);
      }
      if (answer.reason === "no-coverage") {
        count("no-coverage");
        return c.json({ outcome: "no-coverage" as const }, 200);
      }
      count("failed");
      return lookupFailed(c);
    },
  );

  app.openapi(
    {
      ...addressResolutionRoute,
      middleware: chokepointMiddleware(chokepoint, addressResolutionRoute),
    },
    async (c) => {
      const { suggestionId } = c.req.valid("json");
      const { port, engine } = resolveAddressLookupPort(c.env);
      const answer = await port.resolve({ suggestionId });
      const count = (outcome: string) =>
        c.get("logger")?.count("addresses.lookup", { operation: "resolve", engine, outcome });

      if (answer.ok) {
        count(answer.resolution);
        switch (answer.resolution) {
          case "address":
            return c.json({ outcome: "address" as const, parts: { ...answer.parts } }, 200);
          case "group":
            return c.json(
              { outcome: "group" as const, suggestions: answer.suggestions.map(toContract) },
              200,
            );
          case "expired":
            return c.json({ outcome: "expired" as const }, 200);
        }
      }
      if (answer.reason === "engine-not-implemented") {
        count("unavailable");
        return c.json({ outcome: "unavailable" as const }, 200);
      }
      if (answer.reason === "no-coverage") {
        count("no-coverage");
        return c.json({ outcome: "no-coverage" as const }, 200);
      }
      count("failed");
      return lookupFailed(c);
    },
  );
}
