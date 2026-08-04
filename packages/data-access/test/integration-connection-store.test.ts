import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { describe, expect, it } from "vitest";
import { createConnectionStore } from "../src/integration-connection-store.ts";
import {
  deleteConnectionStatement,
  updateConnectionStatusStatement,
  upsertConnectionStatement,
} from "../src/integration-connection-statements.ts";

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
    await upsertConnectionStatement(database, {
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

  it("re-connecting rotates the credential in place and re-arms a parked connection", async () => {
    const database = createMigratedNodeDatabase("per-firm").database;
    const connectionId = newIdentifier("integrationConnection");
    const row = {
      id: connectionId,
      category: "shipping" as const,
      adapterId: "easypost",
      scope: "firm" as const,
      principalRef: "firm_rotate",
      credentialRef: "secret_ref_old",
      capabilitySnapshot: SNAPSHOT,
      createdAt: "2026-06-16T00:00:00.000Z",
    };
    await upsertConnectionStatement(database, row).run();
    // The health model parked it — the firm's answer is to supply credentials again.
    await updateConnectionStatusStatement(
      database,
      connectionId,
      "needs_reauth",
      "2026-06-17T00:00:00.000Z",
    ).run();
    expect(
      await createConnectionStore(database).getConnection({
        firmId: "firm_rotate",
        category: "shipping",
      }),
    ).toMatchObject({ status: "needs_reauth" });

    // A second connect must land on the SAME row (the unique index would otherwise reject it),
    // point at the new credential, and clear the parked status.
    await upsertConnectionStatement(database, {
      ...row,
      id: newIdentifier("integrationConnection"),
      credentialRef: "secret_ref_new",
      createdAt: "2026-06-18T00:00:00.000Z",
    }).run();

    const connection = await createConnectionStore(database).getConnection({
      firmId: "firm_rotate",
      category: "shipping",
    });
    expect(connection).toMatchObject({
      id: connectionId, // the row id is stable across a reconnect
      credentialRef: "secret_ref_new",
      status: "connected",
    });
    const { results } = await database
      .prepare("SELECT count(*) AS count FROM integration_connection WHERE principal_ref = ?1")
      .bind("firm_rotate")
      .all<{ count: number }>();
    expect(results[0]?.count).toBe(1);
  });

  it("deleting the connection makes the principal look unconnected again", async () => {
    const database = createMigratedNodeDatabase("per-firm").database;
    const connectionId = newIdentifier("integrationConnection");
    await upsertConnectionStatement(database, {
      id: connectionId,
      category: "shipping",
      adapterId: "easypost",
      scope: "firm",
      principalRef: "firm_disconnect",
      credentialRef: "secret_ref_1",
      capabilitySnapshot: SNAPSHOT,
      createdAt: "2026-06-16T00:00:00.000Z",
    }).run();
    await deleteConnectionStatement(database, connectionId).run();
    expect(
      await createConnectionStore(database).getConnection({
        firmId: "firm_disconnect",
        category: "shipping",
      }),
    ).toBeNull();
  });
});
