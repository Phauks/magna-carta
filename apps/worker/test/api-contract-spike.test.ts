// Phase 0 API spike (ADR-0066/ADR-0067): empirically validates the contract-layer claims the
// design spec makes about @hono/zod-openapi before slice 0·5 builds the real pipeline.
// Each describe block guards one claim; if a library bump breaks emission, this suite says so.
import { describe, expect, it } from "vitest";
import { createSpikeApp, emitSpikeDocument } from "./support/api-contract-spike-app";

describe("OpenAPI 3.1 emission (ADR-0066)", () => {
  it("emits a 3.1 document", () => {
    expect(emitSpikeDocument().openapi).toMatch(/^3\.1/);
  });

  it("registers named schemas as components and $refs them, not inline copies", () => {
    const doc = emitSpikeDocument();
    expect(doc.components.schemas).toHaveProperty("Problem");
    expect(doc.components.schemas).toHaveProperty("Matter");
    expect(doc.components.schemas).toHaveProperty("MatterIdentifier");
    const ok = doc.paths["/api/v1/matters"].get.responses["200"];
    expect(JSON.stringify(ok)).toContain("#/components/schemas/MatterPage");
    // Both routes' 422 responses point at the single Problem component.
    const get422 = doc.paths["/api/v1/matters"].get.responses["422"];
    const post422 = doc.paths["/api/v1/matters"].post.responses["422"];
    expect(JSON.stringify(get422)).toContain("#/components/schemas/Problem");
    expect(JSON.stringify(post422)).toContain("#/components/schemas/Problem");
  });

  it("emits branded identifier handles as plain constrained strings", () => {
    const schema = emitSpikeDocument().components.schemas.MatterIdentifier;
    expect(schema.type).toBe("string");
    expect(schema.pattern).toBeDefined();
  });

  it("emits the discriminated union as a union schema", () => {
    const matter = emitSpikeDocument().components.schemas.Matter;
    const sides = matter.properties.sides.items;
    expect(sides.oneOf ?? sides.anyOf).toBeDefined();
  });

  it("emits ISO datetime fields with a date-time format", () => {
    const matter = emitSpikeDocument().components.schemas.Matter;
    expect(matter.properties.openedAt.format).toBe("date-time");
  });
});

describe("x-mc-* route-metadata extensions (ADR-0067)", () => {
  it("passes x-mc-* fields through to the emitted operation objects", () => {
    const doc = emitSpikeDocument();
    const get = doc.paths["/api/v1/matters"].get;
    const post = doc.paths["/api/v1/matters"].post;
    expect(get["x-mc-operationId"]).toBe("matters.list");
    expect(get["x-mc-surface"]).toBe("app");
    expect(post["x-mc-audited"]).toBe(true);
    expect(post["x-mc-idempotency"]).toBe("required");
  });

  it("supports a conformance sweep over every emitted operation (the fitness-function shape)", () => {
    const doc = emitSpikeDocument();
    const mutating = ["post", "put", "patch", "delete"];
    for (const [path, item] of Object.entries<Record<string, any>>(doc.paths)) {
      for (const method of mutating) {
        const operation = item[method];
        if (!operation) continue;
        // The slice 0·5 fitness function: every mutating route declares audited metadata.
        expect(operation["x-mc-audited"], `${method.toUpperCase()} ${path}`).toBe(true);
      }
    }
  });
});

describe("RFC 9457 problem details via defaultHook", () => {
  it("maps a Zod validation failure to a 422 problem+json with field-level errors", async () => {
    const res = await createSpikeApp().request("/api/v1/matters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "" }),
    });
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = (await res.json()) as Record<string, any>;
    expect(body.errorId).toBeDefined();
    expect(body.errors[0].path).toBe("title");
  });

  it("serves the contract-conformant happy path", async () => {
    const res = await createSpikeApp().request("/api/v1/matters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Smith v. Jones" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, any>;
    expect(body.id).toMatch(/^mat_/);
  });
});
