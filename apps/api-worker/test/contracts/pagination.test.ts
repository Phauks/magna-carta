// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
// The cursor-paginated list envelope and cursor query fragment (@magna-carta/data-access/pagination-contract), as they emit into this worker's contract.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { cursorQuery, paginated } from "@magna-carta/data-access/pagination-contract";

const Widget = z.object({ id: z.string(), label: z.string() });

describe("paginated", () => {
  it("accepts a populated page with an opaque nextCursor", () => {
    const parsed = paginated(Widget).safeParse({
      data: [{ id: "wid_1", label: "first" }],
      nextCursor: "b3BhcXVlLWN1cnNvcg",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts the final page (empty data, nextCursor null)", () => {
    const parsed = paginated(Widget).safeParse({ data: [], nextCursor: null });
    expect(parsed.success).toBe(true);
  });

  it("rejects a page without nextCursor (null is explicit, never omitted)", () => {
    const parsed = paginated(Widget).safeParse({ data: [] });
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-string non-null nextCursor", () => {
    expect(paginated(Widget).safeParse({ data: [], nextCursor: 42 }).success).toBe(false);
    expect(paginated(Widget).safeParse({ data: [], nextCursor: undefined }).success).toBe(false);
  });

  it("validates each item against the item schema", () => {
    const parsed = paginated(Widget).safeParse({
      data: [{ id: "wid_1" }],
      nextCursor: null,
    });
    expect(parsed.success).toBe(false);
  });

  it("registers as a named component when the caller applies .openapi(name)", () => {
    const app = new OpenAPIHono();
    const listWidgetsRoute = createRoute({
      method: "get",
      path: "/api/v1/widgets",
      request: { query: cursorQuery },
      responses: {
        200: {
          description: "Widgets page",
          content: {
            "application/json": { schema: paginated(Widget).openapi("WidgetPage") },
          },
        },
      },
    });
    app.openapi(listWidgetsRoute, (c) => c.json({ data: [], nextCursor: null }, 200));
    const document = app.getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "test", version: "0.0.0" },
    }) as Record<string, any>;
    const component = document.components.schemas.WidgetPage;
    expect(component).toBeDefined();
    expect(Object.keys(component.properties).sort()).toEqual(["data", "nextCursor"]);
    expect(component.required).toEqual(expect.arrayContaining(["data", "nextCursor"]));
  });
});

describe("cursorQuery", () => {
  it("accepts an absent cursor (first page)", () => {
    expect(cursorQuery.safeParse({}).success).toBe(true);
  });

  it("accepts an opaque cursor string", () => {
    expect(cursorQuery.safeParse({ cursor: "b3BhcXVlLWN1cnNvcg" }).success).toBe(true);
  });

  it("exposes only the cursor key — never offset or page", () => {
    expect(Object.keys(cursorQuery.shape)).toEqual(["cursor"]);
  });

  it("emits as an optional query parameter (name cursor, in query, required false)", () => {
    const app = new OpenAPIHono();
    const listWidgetsRoute = createRoute({
      method: "get",
      path: "/api/v1/widgets",
      request: { query: cursorQuery },
      responses: {
        200: {
          description: "Widgets page",
          content: {
            "application/json": { schema: paginated(Widget) },
          },
        },
      },
    });
    app.openapi(listWidgetsRoute, (c) => c.json({ data: [], nextCursor: null }, 200));
    const document = app.getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "test", version: "0.0.0" },
    }) as Record<string, any>;
    const parameters = document.paths["/api/v1/widgets"].get.parameters;
    const cursorParameter = parameters.find(
      (parameter: { name: string }) => parameter.name === "cursor",
    );
    expect(cursorParameter).toBeDefined();
    expect(cursorParameter.in).toBe("query");
    expect(cursorParameter.required).toBe(false);
  });
});
