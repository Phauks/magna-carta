/*
 * The five writes that run a meeting, as they actually reach the server.
 *
 * WHY THESE ARE WORTH A TEST OF THEIR OWN. Each one is the audited half of host controls — the acts
 * somebody could later ask "who did that" about — and each has exactly one thing a type cannot hold:
 * the address it is sent to, and the idempotency key every one of them requires. A wrapper that
 * addressed a removal by the member rather than by the STAY would put the wrong person out of the
 * room in a meeting somebody rejoined; one that dropped the key would let a retry write a second
 * grant. Both compile, and both are found in a meeting.
 *
 * The refusals are the other half: a surface in the middle of a meeting has to RENDER a refusal
 * rather than unwind, so nothing here is allowed to throw.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { client } from "@magna-carta/api-client/client";
import {
  grantMeetingHosting,
  meetingProblemType,
  readMeetingHosts,
  refusedAs,
  removeMeetingParticipant,
  revokeMeetingHosting,
  setMeetingLocked,
} from "../src/lib/meetings/meetings-api.ts";

/** An origin for the client's relative operation paths, which Node cannot resolve on its own. */
const ORIGIN = "https://app.example";

interface Sent {
  readonly method: string;
  readonly path: string;
  readonly idempotencyKey: string | null;
  readonly body: unknown;
}

let sent: Sent[] = [];

const GRANTS = {
  data: [
    { userId: "user_1", role: "host", grantedAt: "2026-09-20T10:00:00.000Z" },
    { userId: "user_2", role: "co-host", grantedAt: "2026-09-20T10:05:00.000Z" },
  ],
};

/** Answer every call one way, and record exactly what was asked for. */
function answerWith(status: number, body: unknown): void {
  const stub = (async (request: Request) => {
    sent.push({
      method: request.method,
      path: new URL(request.url).pathname,
      idempotencyKey: request.headers.get("idempotency-key"),
      body:
        request.method === "GET" || request.body === null
          ? null
          : await request
              .clone()
              .text()
              .then((text) => (text === "" ? null : JSON.parse(text))),
    });
    return new Response(body === null ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  client.setConfig({ baseUrl: ORIGIN, fetch: stub });
}

beforeEach(() => {
  sent = [];
});

afterEach(() => {
  client.setConfig({ baseUrl: "", fetch: globalThis.fetch });
});

describe("reading who is running a meeting", () => {
  it("asks the meeting's own address and hands back the grants themselves", async () => {
    answerWith(200, GRANTS);

    const outcome = await readMeetingHosts("meeting_1");

    expect(sent[0]?.method).toBe("GET");
    expect(sent[0]?.path).toBe("/api/v1/meetings/meeting_1/hosts");
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.value.map((grant) => grant.role)).toEqual(["host", "co-host"]);
  });

  it("renders a refusal rather than throwing, because the reader is in a meeting", async () => {
    answerWith(404, { type: meetingProblemType("not-found"), title: "No meeting", status: 404 });

    const outcome = await readMeetingHosts("meeting_1");

    expect(outcome.kind).toBe("failed");
  });
});

describe("writing a grant", () => {
  it("names the member and the role, and carries an idempotency key", async () => {
    answerWith(200, GRANTS);

    await grantMeetingHosting("meeting_1", "user_2", "co-host");

    expect(sent[0]?.method).toBe("POST");
    expect(sent[0]?.path).toBe("/api/v1/meetings/meeting_1/hosts");
    expect(sent[0]?.body).toEqual({ userId: "user_2", role: "co-host" });
    // A retry of THIS write has to be the same write: a grant written twice is a second row the
    // invariants then have to argue with.
    expect(sent[0]?.idempotencyKey).toMatch(/\S/u);
  });

  it("is the same route naming yourself, which is what claiming a hostless room is", async () => {
    answerWith(200, GRANTS);

    await grantMeetingHosting("meeting_1", "user_1", "host");

    expect(sent[0]?.body).toEqual({ userId: "user_1", role: "host" });
  });

  it("is refused as an authority answer, which a surface can tell from any other 403", async () => {
    answerWith(403, {
      type: meetingProblemType("meeting-not-host"),
      title: "You are not hosting this meeting",
      status: 403,
    });

    const outcome = await grantMeetingHosting("meeting_1", "user_2", "host");

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(refusedAs(outcome.failure, "meeting-not-host")).toBe(true);
    expect(refusedAs(outcome.failure, "meeting-locked")).toBe(false);
  });
});

describe("withdrawing a grant", () => {
  it("addresses the member whose grant is being closed", async () => {
    answerWith(200, GRANTS);

    await revokeMeetingHosting("meeting_1", "user_2");

    expect(sent[0]?.method).toBe("POST");
    expect(sent[0]?.path).toBe("/api/v1/meetings/meeting_1/hosts/user_2/revoke");
    expect(sent[0]?.idempotencyKey).toMatch(/\S/u);
  });
});

describe("putting somebody out of the room", () => {
  it("addresses the STAY and never the member", async () => {
    answerWith(200, { ok: true });

    await removeMeetingParticipant("meeting_1", "attendance_7");

    // A member handle would not distinguish two stays, and a removal addressed by one would reach
    // whichever of them the server picked.
    expect(sent[0]?.path).toBe("/api/v1/meetings/meeting_1/participants/attendance_7/remove");
    expect(sent[0]?.idempotencyKey).toMatch(/\S/u);
  });
});

describe("the door", () => {
  it("is shut and opened through one route, which says which it is", async () => {
    answerWith(200, { ok: true });

    await setMeetingLocked("meeting_1", true);
    await setMeetingLocked("meeting_1", false);

    expect(sent.map((call) => call.path)).toEqual([
      "/api/v1/meetings/meeting_1/lock",
      "/api/v1/meetings/meeting_1/lock",
    ]);
    expect(sent.map((call) => call.body)).toEqual([{ locked: true }, { locked: false }]);
  });
});
