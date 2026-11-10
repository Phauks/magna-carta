import { describe, expect, it } from "vitest";
import {
  answerApplicationFile,
  IMMUTABLE_CACHE_CONTROL,
  type Bindings,
} from "../src/answer-application-file.ts";

const ASSET_SERVER_DEFAULT = "public, max-age=0, must-revalidate";

/** An asset server that answers every request with one prepared response. */
const assetsAnswering = (response: Response): Bindings["ASSETS"] => ({
  fetch: () => Promise.resolve(response),
});

const script = (status = 200): Response =>
  new Response(status === 304 ? null : "export const answer = 42;", {
    status,
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": ASSET_SERVER_DEFAULT,
      ETag: '"abc"',
    },
  });

/** What the asset server sends for a path that matches no file: the application shell, with a 200. */
const shell = (): Response =>
  new Response("<!doctype html><html></html>", {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": ASSET_SERVER_DEFAULT },
  });

const request = (path: string): Request => new Request(`https://app.example${path}`);

describe("a file under /_app/immutable/", () => {
  it("is kept for a year, with its body and its other headers untouched", async () => {
    const response = await answerApplicationFile(
      request("/_app/immutable/chunks/abc.js"),
      assetsAnswering(script()),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(IMMUTABLE_CACHE_CONTROL);
    expect(response.headers.get("ETag")).toBe('"abc"');
    expect(response.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(await response.text()).toBe("export const answer = 42;");
  });

  it("carries the same lifetime on a 304, which is what refreshes a stored copy", async () => {
    const response = await answerApplicationFile(
      request("/_app/immutable/chunks/abc.js"),
      assetsAnswering(script(304)),
    );
    expect(response.status).toBe(304);
    expect(response.headers.get("Cache-Control")).toBe(IMMUTABLE_CACHE_CONTROL);
  });

  it("is a 404 nothing may store when the file does not exist, never the shell with a 200", async () => {
    const response = await answerApplicationFile(
      request("/_app/immutable/chunks/gone.js"),
      assetsAnswering(shell()),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).not.toContain("<html");
  });

  it("does not extend an error or a redirect", async () => {
    const failure = new Response("unavailable", {
      status: 503,
      headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
    });
    const response = await answerApplicationFile(
      request("/_app/immutable/chunks/abc.js"),
      assetsAnswering(failure),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("a file under /_app/ whose name carries no hash", () => {
  it("keeps the asset server's own lifetime, so the version poll still sees a new deploy", async () => {
    const version = new Response('{"version":"abc"}', {
      headers: { "Content-Type": "application/json", "Cache-Control": ASSET_SERVER_DEFAULT },
    });
    const response = await answerApplicationFile(
      request("/_app/version.json"),
      assetsAnswering(version),
    );
    expect(response.headers.get("Cache-Control")).toBe(ASSET_SERVER_DEFAULT);
  });

  it("is still a 404 when it does not exist", async () => {
    const response = await answerApplicationFile(
      request("/_app/nothing.json"),
      assetsAnswering(shell()),
    );
    expect(response.status).toBe(404);
  });
});

describe("a path outside /_app/", () => {
  it("is handed back exactly as the asset server answered it, shell included", async () => {
    const answered = shell();
    const response = await answerApplicationFile(
      request("/matters/123"),
      assetsAnswering(answered),
    );
    expect(response).toBe(answered);
  });
});
