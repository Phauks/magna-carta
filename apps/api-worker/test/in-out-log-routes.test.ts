import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  readJson,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The In/Out Log's HTTP surface end to end: a Drop Off draws the next number, the waiting list
// shows it, a Pick Up takes it off that list, a second Pick Up of the same entry is refused, and a
// picked-up entry cannot be deleted.

let ownerCookie: string;
let ownerUserId: UserId;

interface Entry {
  id: string;
  number: string;
  status: string;
  to: { id: string; name: string }[];
  pickedUp: { by: { name: string }; identityChecked: boolean } | null;
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  return SELF.fetch(`https://example.test${path}`, {
    method,
    headers: {
      cookie: ownerCookie,
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function get<T>(path: string): Promise<T> {
  const response = await SELF.fetch(`https://example.test${path}`, { headers: { cookie: ownerCookie } });
  expect(response.status).toBe(200);
  return readJson<T>(response);
}

async function dropOff(): Promise<{ id: string; number: string }> {
  const response = await send("POST", "/api/v1/in-out-entries", {
    description: "Copies of the closing binder",
    from: { kind: "external", name: "Rapid Legal courier" },
    to: [
      { kind: "member", userId: ownerUserId, name: "In Out Owner" },
      { kind: "external", name: "Maria Lopez" },
    ],
    keptAt: "Front desk tray",
  });
  expect(response.status).toBe(201);
  return readJson<{ id: string; number: string }>(response);
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  const firmId: FirmId = (await seedFirm({ name: "In Out Firm" })).firmId;
  const owner = await seedCredentialedUser("in-out-owner@example.com", {
    userName: "In Out Owner",
    firmId,
  });
  ownerUserId = owner.userId as UserId;
  await mirrorMemberWithOwnerRole(owner.userId, "In Out Owner", firmId);
  ownerCookie = await signInForSessionCookie("in-out-owner@example.com");
});

describe("the In/Out Log routes", () => {
  it("drops off, lists, picks up, and refuses a second pick up and a late delete", async () => {
    const first = await dropOff();
    const second = await dropOff();
    expect(first.number).toMatch(/^IO-\d{4}$/u);
    expect(second.number).not.toBe(first.number);

    const waiting = await get<{ data: Entry[] }>("/api/v1/in-out-entries?status=waiting");
    expect(waiting.data.map((entry) => entry.id)).toEqual([first.id, second.id]);
    const entry = await get<Entry>(`/api/v1/in-out-entries/${first.id}`);
    expect(entry.to.map((person) => person.name)).toEqual(["In Out Owner", "Maria Lopez"]);

    const maria = entry.to[1];
    const pickUp = await send("POST", `/api/v1/in-out-entries/${first.id}/pick-up`, {
      recipientId: maria?.id,
      identityChecked: true,
    });
    expect(pickUp.status).toBe(200);
    const after = await get<Entry>(`/api/v1/in-out-entries/${first.id}`);
    expect(after.status).toBe("picked_up");
    expect(after.pickedUp?.by.name).toBe("Maria Lopez");
    expect(after.pickedUp?.identityChecked).toBe(true);

    const again = await send("POST", `/api/v1/in-out-entries/${first.id}/pick-up`, {
      collector: { kind: "external", name: "Somebody Else" },
      identityChecked: false,
    });
    expect(again.status).toBe(409);
    expect((await send("DELETE", `/api/v1/in-out-entries/${first.id}`)).status).toBe(409);

    const stillWaiting = await get<{ data: Entry[] }>("/api/v1/in-out-entries?status=waiting");
    expect(stillWaiting.data.map((row) => row.id)).toEqual([second.id]);
    const found = await get<{ data: Entry[] }>("/api/v1/in-out-entries?search=Maria");
    expect(found.data).toHaveLength(2);
  });

  it("deletes a waiting entry recorded by mistake", async () => {
    const created = await dropOff();
    expect((await send("DELETE", `/api/v1/in-out-entries/${created.id}`)).status).toBe(200);
    const response = await SELF.fetch(`https://example.test/api/v1/in-out-entries/${created.id}`, {
      headers: { cookie: ownerCookie },
    });
    expect(response.status).toBe(404);
  });

  it("refuses an entry nobody may collect", async () => {
    const response = await send("POST", "/api/v1/in-out-entries", {
      description: "Envelope",
      from: { kind: "external", name: "Walk-in" },
      to: [],
    });
    expect(response.status).toBe(422);
  });
});
