/*
 * What the Time surface actually puts on the wire.
 *
 * THIS IS THE TEST THAT WAS MISSING. Every write against a time entry declares `Idempotency-Key`
 * REQUIRED in the contract, and the requirement is enforced at the HTTP boundary ahead of the
 * handler: a call without the header is answered 400 and never reaches the entry. The client sent
 * the header on capture and on nothing else, so a row could be created and then never changed
 * again — every autosave, every strike, every chain verb came back 400 — and a full suite passed
 * throughout, because no test anywhere asserted a request.
 *
 * So these assert the REQUEST: the method, the path, the header, the body. A test that asserts the
 * call resolved is the kind of test that let this survive, and there is deliberately none here.
 *
 * The bound is stated as a sweep rather than a list, so a NEW write cannot be added without either
 * carrying the header or failing this file.
 */
import { describe, expect, it } from "vitest";
import {
  approveTimeEntry,
  createTimeEntry,
  kickBackTimeEntry,
  patchTimeEntry,
  submitTimeEntry,
  voidTimeEntry,
  writeKey,
} from "../src/lib/time/time-operations.ts";
import { IDEMPOTENCY_HEADER, recordRequests } from "./time-request-recorder.ts";

const ENTRY = "time-entry-7";

const DRAFT = {
  matterId: "matter-1",
  timekeeperUserId: "member-1",
  workDate: "2026-08-30",
  rawDurationMinutes: 90,
  narrative: "Reviewed the discovery responses",
  billable: true,
} as const;

/**
 * Every write the module offers, each already bound to its arguments EXCEPT the key.
 *
 * Written as one table so the header assertion is made over the whole verb set rather than over
 * whichever calls somebody remembered: the defect was one verb having the key and five not.
 */
const EVERY_WRITE: readonly {
  name: string;
  method: string;
  path: string;
  call: (fetchImpl: typeof fetch, key: string) => Promise<unknown>;
}[] = [
  {
    name: "recording a draft",
    method: "POST",
    path: "/api/v1/time-entries",
    call: (fetchImpl, key) => createTimeEntry(fetchImpl, DRAFT, key),
  },
  {
    name: "changing an entry",
    method: "PATCH",
    path: `/api/v1/time-entries/${ENTRY}`,
    call: (fetchImpl, key) => patchTimeEntry(fetchImpl, ENTRY, { narrative: "Reworded" }, key),
  },
  {
    name: "submitting for review",
    method: "POST",
    path: `/api/v1/time-entries/${ENTRY}/submit`,
    call: (fetchImpl, key) => submitTimeEntry(fetchImpl, ENTRY, key),
  },
  {
    name: "approving",
    method: "POST",
    path: `/api/v1/time-entries/${ENTRY}/approve`,
    call: (fetchImpl, key) => approveTimeEntry(fetchImpl, ENTRY, key),
  },
  {
    name: "kicking back",
    method: "POST",
    path: `/api/v1/time-entries/${ENTRY}/kick-back`,
    call: (fetchImpl, key) => kickBackTimeEntry(fetchImpl, ENTRY, "wrong matter", key),
  },
  {
    name: "striking",
    method: "POST",
    path: `/api/v1/time-entries/${ENTRY}/void`,
    call: (fetchImpl, key) => voidTimeEntry(fetchImpl, ENTRY, key),
  },
];

describe("the header the contract requires on every time write", () => {
  it.each(EVERY_WRITE)("$name sends an Idempotency-Key", async ({ call }) => {
    const recorder = recordRequests();
    await call(recorder.fetch, "the-key-for-this-attempt");

    const sent = recorder.onlyCall();
    expect(sent.headers[IDEMPOTENCY_HEADER]).toBe("the-key-for-this-attempt");
  });

  it.each(EVERY_WRITE)("$name goes to its own route as $method", async ({ call, method, path }) => {
    const recorder = recordRequests();
    await call(recorder.fetch, writeKey());

    const sent = recorder.onlyCall();
    expect(sent.method).toBe(method);
    expect(sent.path).toBe(path);
  });

  it("sends a key on every one of them, with none left out", async () => {
    const recorder = recordRequests();
    for (const write of EVERY_WRITE) await write.call(recorder.fetch, writeKey());

    const keyless = recorder.writes.filter(
      (call) => call.headers[IDEMPOTENCY_HEADER] === undefined,
    );
    expect(keyless.map((call) => `${call.method} ${call.path}`)).toEqual([]);
    expect(recorder.writes).toHaveLength(EVERY_WRITE.length);
  });

  it("gives each attempt its own key, so two acts are never collapsed into one", async () => {
    const recorder = recordRequests();
    await voidTimeEntry(recorder.fetch, "entry-a", writeKey());
    await voidTimeEntry(recorder.fetch, "entry-b", writeKey());

    const [first, second] = recorder.writes;
    expect(first?.headers[IDEMPOTENCY_HEADER]).toBeDefined();
    expect(second?.headers[IDEMPOTENCY_HEADER]).toBeDefined();
    expect(first?.headers[IDEMPOTENCY_HEADER]).not.toBe(second?.headers[IDEMPOTENCY_HEADER]);
  });
});

describe("what each write carries in its body", () => {
  it("records a draft as the capture route reads it", async () => {
    const recorder = recordRequests();
    await createTimeEntry(recorder.fetch, DRAFT, writeKey());

    expect(recorder.onlyCall().body).toEqual({ ...DRAFT, source: "manual" });
  });

  it("sends only the fields being changed, so an untouched field is not overwritten", async () => {
    const recorder = recordRequests();
    await patchTimeEntry(recorder.fetch, ENTRY, { rawDurationMinutes: 45 }, writeKey());

    expect(recorder.onlyCall().body).toEqual({ rawDurationMinutes: 45 });
  });

  it("carries the kick-back reason the route requires", async () => {
    const recorder = recordRequests();
    await kickBackTimeEntry(recorder.fetch, ENTRY, "filed on the wrong matter", writeKey());

    expect(recorder.onlyCall().body).toEqual({ reason: "filed on the wrong matter" });
  });

  it("declares JSON on a write that carries a body", async () => {
    const recorder = recordRequests();
    await patchTimeEntry(recorder.fetch, ENTRY, { narrative: "Reworded" }, writeKey());

    expect(recorder.onlyCall().headers["content-type"]).toBe("application/json");
  });
});

describe("an entry identifier reaching the path", () => {
  it("is escaped, so an identifier can never rewrite the route it is going to", async () => {
    const recorder = recordRequests();
    await voidTimeEntry(recorder.fetch, "entry/../../elsewhere", writeKey());

    expect(recorder.onlyCall().path).toBe("/api/v1/time-entries/entry%2F..%2F..%2Felsewhere/void");
  });
});
