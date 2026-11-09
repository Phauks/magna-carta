import { env } from "cloudflare:test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { HttpClient } from "@magna-carta/integrations/http";
import { createApp } from "../src/http/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  seedFirmKey,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The postage key is a bearer credential for the firm's account with a carrier. Anyone holding it can
// spend the firm's money, so it belongs on no path anybody can read back: not a response body, not a
// log line, not an audit row's metadata, and not the database in plaintext.
//
// This is a sentinel test rather than a source scan on purpose. A scan asserts that today's code does
// not name the value; a sentinel asserts that the value does not ESCAPE, which keeps holding when a
// future change routes the credential through something nobody thought to scan.
//
// The sentinel is deliberately a readable phrase rather than a random-looking token. It has to be
// unique enough that finding it in captured output means this value and nothing else, and it must not
// read as a credential to anybody — human or the secret gate — because a test fixture that looks like
// a live key is indistinguishable from one until somebody spends an afternoon proving otherwise.
const REDACTION_SENTINEL = "ezk-not-a-real-key-this-string-must-never-be-logged";

const ROUTE_BASE = "https://example.com/api/v1";

// Everything the worker wrote to stdout/stderr while the requests ran. The telemetry pipeline emits
// its events as JSON lines through console, so capturing console is what puts every emitted event,
// and every incidental log, inside the assertion.
const captured: string[] = [];
const realConsole = { log: console.log, error: console.error, warn: console.warn };

function captureConsole(): void {
  const record =
    (original: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      captured.push(
        args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "),
      );
      original(...args);
    };
  console.log = record(realConsole.log);
  console.error = record(realConsole.error);
  console.warn = record(realConsole.warn);
}

function fakeEasyPost(): HttpClient {
  return {
    async request(request) {
      // The carrier is the ONE place the key legitimately goes. Whatever the adapter sends here is
      // outside the worker's own surfaces, so it is deliberately not part of the capture.
      if (request.url.endsWith("/shipments") && request.method === "POST") {
        return {
          status: 200,
          json: async () => ({
            id: "shp_fake",
            rates: [
              {
                id: "rate_fake",
                carrier: "USPS",
                service: "Priority",
                rate: "7.50",
                currency: "USD",
                delivery_days: 2,
                est_delivery_date: null,
              },
            ],
          }),
        };
      }
      return { status: 404, json: async () => ({}) };
    },
  };
}

const app = createApp({ pluginRuntime: { httpClient: fakeEasyPost() } });

let firmId: FirmId;
let cookie: string;
let keyCounter = 0;
// Every response body the suite read back, so the assertion covers what a caller could actually see.
const responseBodies: string[] = [];

function authedJson(withIdempotencyKey: boolean): Record<string, string> {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(withIdempotencyKey ? { "Idempotency-Key": `ship-redact-${keyCounter++}` } : {}),
  };
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Redaction Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  await seedFirmKey(firmId);
  const { userId } = await seedCredentialedUser("redact@example.com", {
    userName: "Redaction User",
    firmId,
  });
  await mirrorMemberWithOwnerRole(userId, "Redaction User", firmId);
  cookie = await signInForSessionCookie("redact@example.com");

  captureConsole();

  const connect = await app.request(
    `${ROUTE_BASE}/integrations/shipping/connection`,
    {
      method: "POST",
      headers: authedJson(true),
      body: JSON.stringify({ apiKey: REDACTION_SENTINEL }),
    },
    env,
  );
  responseBodies.push(await connect.text());
  expect(connect.status).toBe(201);

  const address = {
    name: "Jane",
    street1: "1 Main St",
    city: "Reno",
    state: "NV",
    zip: "89501",
    country: "US",
  };
  const create = await app.request(
    `${ROUTE_BASE}/shipments`,
    {
      method: "POST",
      headers: authedJson(true),
      body: JSON.stringify({ from: address, to: address, parcel: { weightOz: 8 } }),
    },
    env,
  );
  const createBody = await create.text();
  responseBodies.push(createBody);
  const { id } = JSON.parse(createBody) as { id: string };

  // A rate-shop is the shortest path that decrypts the credential and hands it to the adapter, so it
  // is the request most likely to carry the value somewhere it should not go.
  const rates = await app.request(
    `${ROUTE_BASE}/shipments/${id}/rates`,
    { method: "POST", headers: authedJson(true), body: "{}" },
    env,
  );
  responseBodies.push(await rates.text());
  expect(rates.status).toBe(200);
});

afterAll(() => {
  console.log = realConsole.log;
  console.error = realConsole.error;
  console.warn = realConsole.warn;
});

describe("the postage credential never escapes", () => {
  it("appears in no response body", () => {
    for (const body of responseBodies) {
      expect(body).not.toContain(REDACTION_SENTINEL);
    }
  });

  it("appears on no log or telemetry line", () => {
    // Proves the capture is live rather than passing because nothing was recorded at all: the worker
    // emits a request.completed event per request, so an empty capture would mean the hook missed.
    expect(captured.length).toBeGreaterThan(0);
    for (const line of captured) {
      expect(line).not.toContain(REDACTION_SENTINEL);
    }
  });

  it("is stored as ciphertext, and the row holds no plaintext copy", async () => {
    const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
    const { results } = await firmDatabase.prepare("SELECT * FROM integration_credential").all();
    expect(results).toHaveLength(1);
    // Every column, not just the one we expect to hold it — a future column carrying a plaintext copy
    // is exactly the regression this catches.
    expect(JSON.stringify(results[0])).not.toContain(REDACTION_SENTINEL);
  });

  it("appears in no audit row, including the decrypt records the read writes", async () => {
    const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
    const { results } = await firmDatabase.prepare("SELECT * FROM audit_log").all();
    // The decrypt audit is the subtle one: it fires on every credential read, and its metadata is
    // written right beside the value it is about.
    expect(results.length).toBeGreaterThan(0);
    expect(JSON.stringify(results)).not.toContain(REDACTION_SENTINEL);
  });
});
