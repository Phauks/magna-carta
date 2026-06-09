// Phase 0 API spike (ADR-0066/ADR-0067): a representative contract app exercising the claims
// the design spec makes about @hono/zod-openapi. Imported by the spike test suite, and by the
// spike's emit script so the same document feeds Hey API / Spectral. Spike-only — the real
// contract modules live in contracts/common when slice 0·5 builds the pipeline.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

// RFC 9457 Problem Details, extended with the observability Error ID (design spec, error model).
export const Problem = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    errorId: z.string(),
    instance: z.string().optional(),
    errors: z
      .array(z.object({ path: z.string(), code: z.string(), detail: z.string() }))
      .optional(),
  })
  .openapi("Problem");

// Identifier handles are branded strings (ADR-0062); brands are type-level only and must
// emit as plain strings.
export const MatterIdentifier = z
  .string()
  .regex(/^mat_[0-9a-zA-Z_-]+$/)
  .brand<"matter">()
  .openapi("MatterIdentifier");

// The uniform cursor-paginated list envelope (design spec, pagination).
export function paginated<Item extends z.ZodType>(item: Item) {
  return z.object({ data: z.array(item), nextCursor: z.string().nullable() });
}

// A discriminated union — the spec calls for spot-checking complex Zod emission.
export const LedgerSide = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("debit"), accountId: z.string() }),
  z.object({ kind: z.literal("credit"), accountId: z.string() }),
]);

export const Matter = z
  .object({
    id: MatterIdentifier,
    title: z.string(),
    openedAt: z.iso.datetime(),
    sides: z.array(LedgerSide),
  })
  .openapi("Matter");

// Route metadata emitted as x-mc-* extensions so conformance fitness functions can assert
// over the contract (ADR-0067). The spike proves extension passthrough.
const listMattersRoute = createRoute({
  method: "get",
  path: "/api/v1/matters",
  request: {
    query: z.object({ cursor: z.string().optional() }),
  },
  responses: {
    200: {
      description: "Matters page",
      content: { "application/json": { schema: paginated(Matter).openapi("MatterPage") } },
    },
    422: {
      description: "Validation failure",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
  "x-mc-operationId": "matters.list",
  "x-mc-surface": "app",
  "x-mc-authenticated": true,
  "x-mc-audited": false,
  "x-mc-idempotency": "optional",
});

const createMatterRoute = createRoute({
  method: "post",
  path: "/api/v1/matters",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ title: z.string().min(1) }) },
      },
    },
  },
  responses: {
    201: {
      description: "Created",
      content: { "application/json": { schema: Matter } },
    },
    422: {
      description: "Validation failure",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
  "x-mc-operationId": "matters.create",
  "x-mc-surface": "app",
  "x-mc-authenticated": true,
  "x-mc-audited": true,
  "x-mc-idempotency": "required",
});

export function createSpikeApp() {
  // defaultHook maps Zod validation failures to the RFC 9457 problem shape platform-wide.
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          {
            type: "https://api.magnacarta.esq/problems/validation",
            title: "Validation failed",
            status: 422,
            errorId: "err_spike0000",
            errors: result.error.issues.map((issue) => ({
              path: issue.path.join("."),
              code: issue.code,
              detail: issue.message,
            })),
          },
          422,
          { "content-type": "application/problem+json" },
        );
      }
    },
  });

  app.openapi(listMattersRoute, (c) => c.json({ data: [], nextCursor: null }, 200));
  app.openapi(createMatterRoute, (c) =>
    c.json(
      {
        id: "mat_spike0001" as z.infer<typeof MatterIdentifier>,
        title: c.req.valid("json").title,
        openedAt: "2026-06-09T00:00:00Z",
        sides: [],
      },
      201,
    ),
  );
  return app;
}

export function emitSpikeDocument(): Record<string, any> {
  return createSpikeApp().getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "Magna Carta API spike", version: "0.0.0" },
  }) as Record<string, any>;
}
