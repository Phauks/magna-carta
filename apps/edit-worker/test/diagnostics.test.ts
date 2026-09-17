import { createMemoryLogger } from "@magna-carta/telemetry/logger";
import { describe, expect, it } from "vitest";
import { isUpgrade, routeOf, withEditorDiagnostics } from "../src/diagnostics.ts";

// A document key exactly as the launch mints it, and a token in the shape the editor carries: the URL
// under test is the real shape of the request the browser makes for a document's WebSocket.
const DOCUMENT_LABEL = "286b0ecd5380489120b8c0f96e26476bad69f2897c22af02d7d6";
const TOKEN =
  "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJmaXh0dXJlIiwiZmlybUlkIjoiZmlybV9maXh0dXJlIiwiY2FwYWJpbGl0eSI6ImVkaXQifQ.fixture-signature-not-a-real-mac-0000000000";
const ORIGIN = `https://${DOCUMENT_LABEL}.magnacartausercontent.com`;
const WOPI_SOURCE = "http%3A%2F%2Fwopi.magna-carta.internal%2Fwopi%2Ffiles%2Ffile_abc";

function socketRequest(): Request {
  return new Request(`${ORIGIN}/cool/ws?WOPISrc=${WOPI_SOURCE}&access_token=${TOKEN}`, {
    headers: { upgrade: "websocket", connection: "Upgrade" },
  });
}

function pageRequest(): Request {
  return new Request(`${ORIGIN}/browser/dist/cool.html?WOPISrc=${WOPI_SOURCE}`);
}

function deps() {
  return { logger: createMemoryLogger(), now: () => "2026-09-16T21:00:00.000Z" };
}

describe("routeOf", () => {
  it("is the pathname and never the query, because the query carries the access token", () => {
    const route = routeOf(socketRequest());
    expect(route).toBe("/cool/ws");
    expect(route).not.toContain(TOKEN);
    expect(route).not.toContain("access_token");
  });
});

describe("isUpgrade", () => {
  it("recognises the socket request whatever case the header arrives in", () => {
    expect(isUpgrade(socketRequest())).toBe(true);
    expect(isUpgrade(new Request(`${ORIGIN}/cool/ws`, { headers: { upgrade: "WebSocket" } }))).toBe(
      true,
    );
  });

  it("is false for the page and its assets", () => {
    expect(isUpgrade(pageRequest())).toBe(false);
  });
});

describe("withEditorDiagnostics", () => {
  it("passes an ordinary answer through by identity and logs nothing", async () => {
    const d = deps();
    const answer = new Response("<html>", { status: 200 });
    const response = await withEditorDiagnostics(pageRequest(), d, () => Promise.resolve(answer));
    expect(response).toBe(answer);
    expect(d.logger.events).toEqual([]);
  });

  it("turns a throw into a 500 carrying an Error ID, and records it with the route as a shape", async () => {
    const d = deps();
    const response = await withEditorDiagnostics(socketRequest(), d, () =>
      Promise.reject(new RangeError("Responses may not have a status code of 101")),
    );

    expect(response.status).toBe(500);
    const errorId = response.headers.get("X-MC-Error-Id");
    expect(errorId).toMatch(/^error_/);

    expect(d.logger.events).toHaveLength(1);
    const [event] = d.logger.events;
    expect(event?.name).toBe("error.captured");
    expect(event?.fields).toMatchObject({
      errorId,
      route: "/cool/ws",
      method: "GET",
      errorName: "RangeError",
      messageHead: "Responses may not have a status code of 101",
    });
    // The whole event, serialised — no field, declared or otherwise, may carry the token or the query.
    const serialised = JSON.stringify(event);
    expect(serialised).not.toContain(TOKEN);
    expect(serialised).not.toContain("access_token");
  });

  it("records the container's real answer when it declines an upgrade, which the browser can never see", async () => {
    const d = deps();
    const declined = new Response("bad gateway", { status: 502 });
    const response = await withEditorDiagnostics(socketRequest(), d, () =>
      Promise.resolve(declined),
    );

    // Passed through as answered: this boundary records, it does not rewrite.
    expect(response).toBe(declined);
    expect(d.logger.events).toHaveLength(1);
    const [event] = d.logger.events;
    expect(event?.name).toBe("operation.failed");
    expect(event?.fields).toMatchObject({
      operation: "editor.upgrade",
      errorName: "UpgradeRefused",
      messageHead: "container answered 502 on /cool/ws",
    });
    expect(event?.fields.errorId).toMatch(/^error_/);
    expect(JSON.stringify(event)).not.toContain(TOKEN);
  });

  it("logs nothing for an upgrade the container accepted", async () => {
    const d = deps();
    // A 101 cannot be constructed here, so the accepted upgrade is stood in for by its two marks.
    const accepted = { status: 101, webSocket: {}, headers: new Headers() } as unknown as Response;
    const response = await withEditorDiagnostics(socketRequest(), d, () =>
      Promise.resolve(accepted),
    );
    expect(response).toBe(accepted);
    expect(d.logger.events).toEqual([]);
  });

  it("does not read an ordinary request's non-101 answer as a declined upgrade", async () => {
    const d = deps();
    const response = await withEditorDiagnostics(pageRequest(), d, () =>
      Promise.resolve(new Response("gone", { status: 404 })),
    );
    expect(response.status).toBe(404);
    expect(d.logger.events).toEqual([]);
  });

  it("records a non-Error throw without losing it", async () => {
    const d = deps();
    const response = await withEditorDiagnostics(pageRequest(), d, () => Promise.reject("boom"));
    expect(response.status).toBe(500);
    expect(d.logger.events[0]?.fields).toMatchObject({ errorName: "Error", messageHead: "boom" });
  });

  it("mints a fresh correlation id per request, so two failures never share one", async () => {
    const d = deps();
    await withEditorDiagnostics(pageRequest(), d, () => Promise.reject(new Error("one")));
    await withEditorDiagnostics(pageRequest(), d, () => Promise.reject(new Error("two")));
    const [first, second] = d.logger.events;
    expect(first?.correlationId).toMatch(/^correlation_/);
    expect(first?.correlationId).not.toBe(second?.correlationId);
    expect(first?.fields.errorId).not.toBe(second?.fields.errorId);
  });
});
