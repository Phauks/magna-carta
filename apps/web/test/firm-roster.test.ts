/*
 * The firm roster client: the read, the shared load, and what happens when it fails.
 *
 * The roster is never the subject of the screen that uses it — it names people on somebody else's
 * rows — so the failure behaviour is the part worth pinning. A roster that throws, or that leaves
 * `members` null forever, takes a docket down with it; a roster that settles empty with a sentence
 * leaves the docket readable and the empty column explained.
 */
import { describe, expect, it } from "vitest";
import { FirmRoster } from "../src/lib/members/firm-roster.svelte.ts";
import {
  listFirmMembers,
  memberRoleLine,
  type FirmMemberSummary,
} from "../src/lib/members/members-api.ts";

function member(overrides: Partial<FirmMemberSummary> = {}): FirmMemberSummary {
  return {
    userId: "user_chase",
    displayName: "Marguerite Chase",
    status: "active",
    roleNames: ["Attorney"],
    hasProfessionalProfile: true,
    ...overrides,
  };
}

/** A fetch that answers one canned response, and records how many times it was called. */
function stubFetch(response: () => Response): { fetchImpl: typeof fetch; calls: () => number } {
  let calls = 0;
  const fetchImpl = ((input: string) => {
    calls += 1;
    expect(input).toBe("/api/v1/members");
    return Promise.resolve(response());
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

function ok(members: readonly FirmMemberSummary[]): Response {
  return new Response(JSON.stringify({ data: members }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function problem(status: number): Response {
  return new Response(JSON.stringify({ status, title: "no" }), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

describe("the roster read", () => {
  it("asks the un-paged members endpoint", async () => {
    const stub = stubFetch(() => ok([member()]));
    const outcome = await listFirmMembers(stub.fetchImpl);
    expect(outcome.kind).toBe("ok");
  });

  it("reads several roles as one line, and no role as no line", () => {
    expect(memberRoleLine(member({ roleNames: ["Attorney", "Billing"] }))).toBe(
      "Attorney, Billing",
    );
    expect(memberRoleLine(member({ roleNames: [] }))).toBe("");
  });
});

describe("the shared roster", () => {
  it("reads once however many callers ask", async () => {
    const roster = new FirmRoster();
    const stub = stubFetch(() => ok([member()]));
    await Promise.all([
      roster.load(stub.fetchImpl),
      roster.load(stub.fetchImpl),
      roster.load(stub.fetchImpl),
    ]);
    await roster.load(stub.fetchImpl);
    expect(stub.calls()).toBe(1);
    expect(roster.members).toHaveLength(1);
  });

  it("offers only the colleagues who are still here, while keeping the departed on the record", async () => {
    const roster = new FirmRoster();
    const stub = stubFetch(() =>
      ok([
        member(),
        member({ userId: "user_gone", displayName: "C. Vale", status: "deactivated" }),
      ]),
    );
    await roster.load(stub.fetchImpl);
    // A picker addresses people who can read it; a listing still has to name whoever holds the row.
    expect(roster.active.map((row) => row.userId)).toEqual(["user_chase"]);
    expect(roster.members).toHaveLength(2);
  });

  it("settles empty with a sentence when the read is refused, rather than staying unresolved", async () => {
    const roster = new FirmRoster();
    const stub = stubFetch(() => problem(403));
    await roster.load(stub.fetchImpl);
    expect(roster.members).toEqual([]);
    expect(roster.failure).toContain("cannot read");
  });

  it("settles empty with a sentence when nothing answers at all", async () => {
    const roster = new FirmRoster();
    const stub = stubFetch(() => problem(500));
    await roster.load(stub.fetchImpl);
    expect(roster.members).toEqual([]);
    expect(roster.failure).toBe("The firm's member list could not be read.");
  });
});
