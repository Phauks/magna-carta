import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { describe, expect, it } from "vitest";
import { createConnectionStore } from "../src/integration-connection-store.ts";
import { insertConnectionStatement } from "../src/integration-connection-statements.ts";

const SNAPSHOT = JSON.stringify({
  adapterId: "easypost",
  category: "shipping",
  credential: { kind: "apiKey", scope: "firm" },
  operations: {},
  passthroughAvailable: true,
});

describe("ConnectionStore.getConnection", () => {
  it("returns a connected firm-scoped connection by (category, principal)", async () => {
    const database = createMigratedNodeDatabase("per-firm").database;
    await insertConnectionStatement(database, {
      id: newIdentifier("integrationConnection"),
      category: "shipping",
      adapterId: "easypost",
      scope: "firm",
      principalRef: "firm_1",
      credentialRef: "secret_ref_1",
      capabilitySnapshot: SNAPSHOT,
      createdAt: "2026-06-16T00:00:00.000Z",
    }).run();

    const store = createConnectionStore(database);
    const connection = await store.getConnection({ firmId: "firm_1", category: "shipping" });
    expect(connection).not.toBeNull();
    expect(connection?.credentialRef).toBe("secret_ref_1");
    expect(connection?.capabilitySnapshot.adapterId).toBe("easypost");
  });

  it("returns null when no connection exists for the principal", async () => {
    const database = createMigratedNodeDatabase("per-firm").database;
    const store = createConnectionStore(database);
    expect(await store.getConnection({ firmId: "firm_404", category: "shipping" })).toBeNull();
  });
});
