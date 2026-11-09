// Slice 0·5: shared contract fragments — the idempotency-key header and identifier path params.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { describe, expect, it } from "vitest";
import { identifierPathParam, idempotencyKeyHeader } from "../../src/http/contracts/common";
import { defaultHook } from "../../src/http/contracts/problem";

describe("idempotencyKeyHeader", () => {
  it("declares the header under the lowercase key (library matches header schema keys case-sensitively against the lowercase incoming header map)", () => {
    expect(Object.keys(idempotencyKeyHeader.shape)).toEqual(["idempotency-key"]);
  });

  function appWithHeaderRoute() {
    const app = new OpenAPIHono();
    const echoRoute = createRoute({
      method: "post",
      path: "/api/v1/echo",
      request: { headers: idempotencyKeyHeader },
      responses: {
        200: {
          description: "Echoes the validated header",
          content: {
            "application/json": {
              schema: z.object({ received: z.string().nullable() }),
            },
          },
        },
      },
    });
    app.openapi(echoRoute, (c) =>
      c.json({ received: c.req.valid("header")["idempotency-key"] ?? null }, 200),
    );
    return app;
  }

  it("matches the header however the client capitalizes it (HTTP header names are case-insensitive)", async () => {
    const response = await appWithHeaderRoute().request("/api/v1/echo", {
      method: "POST",
      headers: { "Idempotency-Key": "client-key-1" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: "client-key-1" });
  });

  it("passes validation when the header is absent (presence is enforced by the chokepoint idempotency middleware, not the schema)", async () => {
    const response = await appWithHeaderRoute().request("/api/v1/echo", { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: null });
  });

  it("rejects an empty header value", () => {
    expect(idempotencyKeyHeader.safeParse({ "idempotency-key": "" }).success).toBe(false);
  });

  it("emits as a header parameter with required: false (the schema-layer truth; defineOpenAPIRoute flips it to true on idempotency-required routes — Task 4)", () => {
    const document = appWithHeaderRoute().getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "test", version: "0.0.0" },
    }) as Record<string, any>;
    const parameters = document.paths["/api/v1/echo"].post.parameters;
    const headerParameter = parameters.find(
      (parameter: { name: string }) => parameter.name === "idempotency-key",
    );
    expect(headerParameter).toBeDefined();
    expect(headerParameter.in).toBe("header");
    expect(headerParameter.required).toBe(false);
  });
});

describe("identifierPathParam", () => {
  it("accepts a well-formed handle for the entity type, including freshly generated ones", () => {
    const schema = identifierPathParam("matter", "matterId");
    expect(schema.safeParse("matter_V1StGXR8_Z5jdHi6B-myT").success).toBe(true);
    expect(schema.safeParse(newIdentifier("matter")).success).toBe(true);
  });

  it("rejects a handle with the wrong entity prefix", () => {
    const schema = identifierPathParam("matter", "matterId");
    expect(schema.safeParse("document_V1StGXR8_Z5jdHi6B-myT").success).toBe(false);
  });

  it("rejects a malformed handle (short token, no prefix)", () => {
    const schema = identifierPathParam("matter", "matterId");
    expect(schema.safeParse("matter_short").success).toBe(false);
    expect(schema.safeParse("not-an-identifier").success).toBe(false);
  });

  function appWithMatterRoute() {
    const app = new OpenAPIHono({ defaultHook });
    const getMatterRoute = createRoute({
      method: "get",
      path: "/api/v1/matters/{matterId}",
      request: {
        params: z.object({ matterId: identifierPathParam("matter", "matterId") }),
      },
      responses: {
        200: {
          description: "The matter id, validated",
          content: {
            "application/json": { schema: z.object({ matterId: z.string() }) },
          },
        },
      },
    });
    app.openapi(getMatterRoute, (c) => c.json({ matterId: c.req.valid("param").matterId }, 200));
    return app;
  }

  it("admits a well-formed handle through route validation", async () => {
    const response = await appWithMatterRoute().request(
      "/api/v1/matters/matter_V1StGXR8_Z5jdHi6B-myT",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ matterId: "matter_V1StGXR8_Z5jdHi6B-myT" });
  });

  it("rejects a malformed handle with the 422 validation problem", async () => {
    const response = await appWithMatterRoute().request("/api/v1/matters/not-a-handle");
    expect(response.status).toBe(422);
    const body = (await response.json()) as Record<string, any>;
    expect(body.type).toBe("https://api.magnacarta.esq/problems/validation");
    const paths = body.errors.map((error: { path: string }) => error.path);
    expect(paths).toContain("matterId");
  });

  it("fails loud at document-emission time when the schema-level param name and the binding key mismatch (zod-to-openapi ConflictError)", () => {
    const app = new OpenAPIHono();
    const mismatchedRoute = createRoute({
      method: "get",
      path: "/api/v1/matters/{matterIdentifier}",
      request: {
        // Binding key `matterIdentifier` disagrees with the schema-level name `matterId`.
        params: z.object({ matterIdentifier: identifierPathParam("matter", "matterId") }),
      },
      responses: { 200: { description: "Never emitted — the document throws first" } },
    });
    app.openapi(mismatchedRoute, (c) => c.body(null, 200));
    expect(() =>
      app.getOpenAPI31Document({ openapi: "3.1.0", info: { title: "test", version: "0.0.0" } }),
    ).toThrowError(/[Cc]onflict/);
  });

  it("emits the path parameter into the OpenAPI document with the handle pattern", () => {
    const document = appWithMatterRoute().getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "test", version: "0.0.0" },
    }) as Record<string, any>;
    const parameters = document.paths["/api/v1/matters/{matterId}"].get.parameters;
    const matterIdParameter = parameters.find(
      (parameter: { name: string }) => parameter.name === "matterId",
    );
    expect(matterIdParameter).toBeDefined();
    expect(matterIdParameter.in).toBe("path");
    expect(matterIdParameter.required).toBe(true);
    expect(matterIdParameter.schema.pattern).toContain("matter_");
  });
});
