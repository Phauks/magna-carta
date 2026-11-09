// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
// Library-emission guardrails: the contract layer depends on @hono/zod-openapi emitting a handful
// of Zod shapes a particular way (named schemas as $ref components, branded handles as plain
// constrained strings, discriminated unions as a union schema, ISO datetimes with a date-time
// format). The real routes don't yet exercise every one of these shapes, so this minimal, inline
// app pins the emission contract directly — a library bump that changes any of it fails here, not
// silently in a generated client.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";

// A branded, pattern-constrained handle — brands are type-level only and must emit as a plain string.
const Handle = z
  .string()
  .regex(/^matter_[0-9a-zA-Z_-]+$/)
  .brand<"matter">()
  .openapi("Handle");

// A discriminated union — the library must emit it as a union schema (oneOf/anyOf), not flatten it.
const Side = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("debit"), accountId: z.string() }),
  z.object({ kind: z.literal("credit"), accountId: z.string() }),
]);

const Record_ = z
  .object({ id: Handle, openedAt: z.iso.datetime(), sides: z.array(Side) })
  .openapi("Record");

const route = createRoute({
  method: "get",
  path: "/api/v1/records",
  responses: {
    200: {
      description: "A record",
      content: { "application/json": { schema: Record_ } },
    },
  },
});

function emit(): Record<string, any> {
  const app = new OpenAPIHono();
  app.openapi(route, (c) =>
    c.json(
      { id: "matter_0001" as z.infer<typeof Handle>, openedAt: "2026-06-09T00:00:00Z", sides: [] },
      200,
    ),
  );
  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "emission guard", version: "0.0.0" },
  }) as Record<string, any>;
}

describe("@hono/zod-openapi emission contract", () => {
  it("emits a 3.1 document", () => {
    expect(emit().openapi).toMatch(/^3\.1/);
  });

  it("registers named schemas as components and $refs them, not inline copies", () => {
    const doc = emit();
    expect(doc.components.schemas).toHaveProperty("Record");
    expect(doc.components.schemas).toHaveProperty("Handle");
    const ok = doc.paths["/api/v1/records"].get.responses["200"];
    expect(JSON.stringify(ok)).toContain("#/components/schemas/Record");
  });

  it("emits branded identifier handles as plain constrained strings", () => {
    const schema = emit().components.schemas.Handle;
    expect(schema.type).toBe("string");
    expect(schema.pattern).toBeDefined();
  });

  it("emits a discriminated union as a union schema", () => {
    const sides = emit().components.schemas.Record.properties.sides.items;
    expect(sides.oneOf ?? sides.anyOf).toBeDefined();
  });

  it("emits ISO datetime fields with a date-time format", () => {
    expect(emit().components.schemas.Record.properties.openedAt.format).toBe("date-time");
  });
});
