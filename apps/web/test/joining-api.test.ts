/*
 * The joining transport seam, pinned against a scripted fetch.
 *
 * What matters on this surface is not that a happy path parses. It is that the three ways a call
 * can end stay three different things — the server answered, the server refused, nothing answered
 * at all — because a front door that reports an outage as a rejection tells somebody they typed
 * their own name wrong. The budget fields matter for the same reason: an invented count is worse
 * than no count, so a refusal that carried none must produce none.
 */
import { describe, expect, it } from "vitest";
import {
  confirmRegistration,
  redeemInvitation,
  startRegistration,
} from "../src/lib/auth/joining-api.ts";

interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

function scriptedFetch(respond: (call: RecordedCall) => Response | Promise<Response>): {
  fetchImplementation: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchImplementation = (async (input: string | URL, init?: RequestInit) => {
    const call: RecordedCall = {
      url: input instanceof URL ? input.href : input,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
    };
    calls.push(call);
    return await respond(call);
  }) as typeof fetch;
  return { fetchImplementation, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function problem(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

const deadTransport = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;

describe("startRegistration", () => {
  it("posts the door, the person and the firm to the registrations route", async () => {
    const { fetchImplementation, calls } = scriptedFetch(() => json({ next: "checkEmail" }, 202));
    const outcome = await startRegistration(fetchImplementation, {
      role: "foundFirm",
      name: "Trevor Goldsmith",
      email: "trevor@goldsmith.example",
      firmName: "Goldsmith and Associates",
    });

    expect(calls[0]?.url).toBe("/api/v1/registrations");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toEqual({
      role: "foundFirm",
      name: "Trevor Goldsmith",
      email: "trevor@goldsmith.example",
      firmName: "Goldsmith and Associates",
    });
    expect(outcome).toEqual({ kind: "ok", value: { next: "checkEmail" } });
  });

  it("reports a dead transport as its own outcome, never as a refusal", async () => {
    const outcome = await startRegistration(deadTransport, {
      role: "foundFirm",
      name: "Trevor Goldsmith",
      email: "trevor@goldsmith.example",
    });
    expect(outcome).toMatchObject({ kind: "transport" });
  });
});

describe("redeemInvitation", () => {
  it("sends the three facts together and returns where the redeemer goes next", async () => {
    const { fetchImplementation, calls } = scriptedFetch(() =>
      json({ email: "joan@example.test", kind: "clientOfFirm", next: "checkEmail" }),
    );
    const outcome = await redeemInvitation(fetchImplementation, {
      code: "ABCD-2345-EFGH",
      lastName: "O'Brien-Walsh",
      dateOfBirth: "1974-03-19",
    });

    expect(calls[0]?.url).toBe("/api/v1/invitations/redemptions");
    expect(calls[0]?.body).toEqual({
      code: "ABCD-2345-EFGH",
      lastName: "O'Brien-Walsh",
      dateOfBirth: "1974-03-19",
    });
    expect(outcome).toEqual({
      kind: "ok",
      value: { email: "joan@example.test", kind: "clientOfFirm", next: "checkEmail" },
    });
  });

  it("carries the attempt budget and the lockout off a refusal", async () => {
    const { fetchImplementation } = scriptedFetch(() =>
      problem(
        {
          type: "invitation-not-redeemable",
          title: "That invitation could not be redeemed",
          detail: "…",
          attemptsRemaining: 0,
          retryAfterSeconds: 900,
          errorId: "err-1",
        },
        422,
      ),
    );
    const outcome = await redeemInvitation(fetchImplementation, {
      code: "ABCD-2345-EFGH",
      lastName: "Wrong",
      dateOfBirth: "1974-03-19",
    });

    expect(outcome).toMatchObject({
      kind: "problem",
      problem: {
        status: 422,
        type: "invitation-not-redeemable",
        detail: "…",
        errorId: "err-1",
        attemptsRemaining: 0,
        retryAfterSeconds: 900,
      },
    });
    // The refusal also carries the two facts only the transport knows, so the screen can say what
    // failed and when without the caller reassembling either.
    if (outcome.kind !== "problem") throw new Error("expected a refusal");
    expect(outcome.failure.request).toBe("POST /invitations/redemptions");
    expect(outcome.failure.problem).toBe(outcome.problem);
  });

  it("leaves the budget absent when the refusal carried none", async () => {
    // Absent must stay absent: rendering a full budget the server never published is exactly the
    // invented count the ladder was left unwired to avoid.
    const { fetchImplementation } = scriptedFetch(() =>
      problem({ type: "invitation-not-redeemable", title: "no" }, 422),
    );
    const outcome = await redeemInvitation(fetchImplementation, {
      code: "ABCD-2345-EFGH",
      lastName: "Wrong",
      dateOfBirth: "1974-03-19",
    });

    expect(outcome.kind).toBe("problem");
    if (outcome.kind !== "problem") return;
    expect(outcome.problem.attemptsRemaining).toBeUndefined();
    expect(outcome.problem.retryAfterSeconds).toBeUndefined();
  });

  it("still yields a usable problem when the body is not JSON at all", async () => {
    const { fetchImplementation } = scriptedFetch(() => new Response("<html>", { status: 502 }));
    const outcome = await redeemInvitation(fetchImplementation, {
      code: "ABCD-2345-EFGH",
      lastName: "Wrong",
      dateOfBirth: "1974-03-19",
    });
    expect(outcome).toMatchObject({ kind: "problem", problem: { status: 502 } });
  });
});

describe("confirmRegistration", () => {
  it("trims the token and changes nothing else about it", async () => {
    // The server does NOT normalize this one — it hashes the trimmed string exactly as given.
    const { fetchImplementation, calls } = scriptedFetch(() =>
      json({ email: "trevor@goldsmith.example", status: "provisioning" }),
    );
    await confirmRegistration(fetchImplementation, "  AbCd2345EfGh  ");

    expect(calls[0]?.url).toBe("/api/v1/registrations/confirmations");
    expect(calls[0]?.body).toEqual({ token: "AbCd2345EfGh" });
  });
});
