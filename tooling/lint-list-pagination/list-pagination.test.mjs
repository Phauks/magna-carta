import { describe, expect, it } from "vitest";
import { listOperations } from "./list-operations.mjs";

const envelope = (properties) => ({
  responses: {
    200: { content: { "application/json": { schema: { type: "object", properties } } } },
  },
});

describe("finding the list endpoints in an emitted contract", () => {
  it("counts a GET answering with a bare data array as unpaged", () => {
    const document = {
      paths: {
        "/api/v1/things": {
          get: { operationId: "things.list", ...envelope({ data: { type: "array" } }) },
        },
      },
    };
    expect(listOperations(document)).toEqual([
      { operationId: "things.list", route: "/api/v1/things", paged: false },
    ]);
  });

  it("counts one carrying nextCursor as paged", () => {
    const document = {
      paths: {
        "/api/v1/things": {
          get: {
            operationId: "things.list",
            ...envelope({ data: { type: "array" }, nextCursor: { type: "string" } }),
          },
        },
      },
    };
    expect(listOperations(document)[0]?.paged).toBe(true);
  });

  it("follows a component reference, because most responses are registered rather than inline", () => {
    const document = {
      components: {
        schemas: {
          ThingPage: { properties: { data: { type: "array" }, nextCursor: { type: "string" } } },
        },
      },
      paths: {
        "/api/v1/things": {
          get: {
            operationId: "things.list",
            responses: {
              200: {
                content: {
                  "application/json": { schema: { $ref: "#/components/schemas/ThingPage" } },
                },
              },
            },
          },
        },
      },
    };
    expect(listOperations(document)[0]?.paged).toBe(true);
  });

  it("ignores a GET that does not answer with a list at all", () => {
    const document = {
      paths: {
        "/api/v1/things/{id}": {
          get: { operationId: "things.get", ...envelope({ id: { type: "string" } }) },
        },
        "/api/v1/things": { post: { operationId: "things.create" } },
      },
    };
    expect(listOperations(document)).toEqual([]);
  });
});
